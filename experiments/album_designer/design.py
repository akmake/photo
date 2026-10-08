"""Album designer experiment — the model decides, the Vault executes.

  1. understand  — the model describes every photo (setup, who, shot, strength)
  2. plan        — the model groups the photos into spreads, in story order,
                   and names each spread's hero
  3. page        — the Vault pages that can hold each group are ranked by how
                   whole the photos stay; the model LOOKS at the best four,
                   drawn with the real photos, and picks one
  4. colour      — four colourings of that page, drawn from the photos' own
                   palette; the model looks and picks one

Usage: python design.py <photo folder> <out folder> [every_nth]
Everything is written to <out>: per-stage JSON, every sheet the model saw,
the final spreads and timings.
"""
import itertools
import json
import math
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(os.path.join(HERE, "..", "..", "engine"))

from PIL import Image  # noqa: E402

import numpy as np  # noqa: E402

import album_analysis  # noqa: E402
import embed  # noqa: E402
import vault_draw as render  # noqa: E402
import vlm  # noqa: E402

LOG = []


def log(stage, seconds, **kw):
    LOG.append({"stage": stage, "seconds": round(seconds, 1), **kw})
    print(f"[{stage}] {seconds:.1f}s {kw}", flush=True)


def natural(name):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name)]


# ---------------------------------------------------------------- 1 understand
UNDERSTAND = """You are a senior wedding/newborn album designer looking at one photo from a shoot.
Answer ONLY with JSON, short values:
{"setup": "<the set/scene in 2-5 words, e.g. 'white blanket basket', 'family by window'>",
 "who": "<baby alone | baby with mother | baby with father | family | siblings | detail/no person>",
 "shot": "<close | medium | wide | detail>",
 "strength": <1-10, how strong this frame is for an album: expression, light, composition>}"""


def understand(paths, out):
    cache = os.path.join(out, "1_understand.json")
    done = json.load(open(cache, encoding="utf-8")) if os.path.exists(cache) else {}
    for p in paths:
        key = os.path.basename(p)
        if key in done:
            continue
        img = Image.open(p).convert("RGB")
        t = time.time()
        a = album_analysis.analyze(img)
        geo = time.time() - t
        text, s = vlm.ask(UNDERSTAND, [img], max_new_tokens=70)
        try:
            d = vlm.json_of(text)
        except Exception:  # noqa: BLE001
            d = {"setup": "?", "who": "?", "shot": "?", "strength": 5, "raw": text}
        d.update({
            "path": p, "w": a["widthPx"], "h": a["heightPx"],
            "focal": a["focalPoint"], "faces": a["faces"],
            "palette": a["palette"], "quality": a["qualityScore"],
        })
        done[key] = d
        log("understand", s, photo=key, geometry_s=round(geo, 1))
        json.dump(done, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return done


# ---------------------------------------------------------------- 2 plan
# v1 asked the model to plan the whole album in one answer: it put 6 and 10
# photos on a spread, mixed sets and dropped 9 photos (timeline 08.10). So the
# plan is decomposed: sets come from how alike the frames LOOK (DINOv2, already
# in the engine), the pace is a rule, and the model only answers what it is
# good at — looking at a few photos side by side and naming the strongest.
SET_BREAK = 0.6      # cosine between neighbours below this starts a new set
PACE = [3, 2, 4, 2, 3, 1]

PICK_HERO = """You are a senior album designer. These {n} photos will share one album spread; the strongest one will be printed largest.
Which photo is the strongest: best expression, light and composition?
Answer ONLY with JSON: {{"pick": <number>, "why": "<10 words>"}}"""


def _vectors(info, out):
    cache = os.path.join(out, "dino.npy")
    if os.path.exists(cache):
        return np.load(cache)
    s = embed._session_instance()
    v = np.stack([embed._infer(s, embed._preprocess(d["path"])) for d in info.values()])
    np.save(cache, v)
    return v


def sets_of(ids, V):
    sets = [[0]]
    for i in range(1, len(ids)):
        if float(V[i] @ V[i - 1]) < SET_BREAK:
            sets.append([i])
        else:
            sets[-1].append(i)
    # a set of one joins the neighbour it looks most like
    j = 0
    while j < len(sets):
        if len(sets[j]) == 1 and len(sets) > 1:
            i = sets[j][0]
            left = float(V[i] @ V[i - 1]) if j > 0 else -1
            right = float(V[i] @ V[i + 1]) if j + 1 < len(sets) else -1
            if left >= right:
                sets[j - 1].extend(sets.pop(j))
            else:
                sets[j + 1][:0] = sets.pop(j)
            continue
        j += 1
    return [[ids[i] for i in s] for s in sets]


def paced(group, step):
    """Split one set into spreads of 1-4, never leaving a lone photo behind."""
    out, rest = [], list(group)
    while rest:
        take = PACE[step % len(PACE)]
        step += 1
        if len(rest) - take == 1:
            take += 1 if take < 4 else -1
        out.append(rest[:take])
        rest = rest[take:]
    return out, step


def plan(info, out, kind):
    cache = os.path.join(out, "2_plan.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    ids = list(info)
    V = _vectors(info, out)
    sets = sets_of(ids, V)
    spreads, step = [], 0
    for si, group in enumerate(sets):
        if si == 0 and len(group) > 1:
            # the opening spread is one photo: the strongest of the first set
            hero = pick_hero(group, info)
            spreads.append({"photos": [hero], "hero": hero, "set": si})
            group = [k for k in group if k != hero]
        chunks, step = paced(group, step)
        for ch in chunks:
            spreads.append({"photos": ch, "hero": pick_hero(ch, info) if len(ch) > 1 else ch[0], "set": si})
    log("plan", 0, sets=[len(s) for s in sets], spreads=[len(s["photos"]) for s in spreads])
    json.dump({"sets": sets, "spreads": spreads}, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return {"spreads": spreads}


def pick_hero(group, info):
    ims = []
    for k in group:
        im = Image.open(info[k]["path"]).convert("RGB")
        im.thumbnail((420, 420))
        ims.append(im)
    side = max(i.height for i in ims)
    ims = [i.resize((int(i.width * side / i.height), side)) for i in ims]
    sh = render.sheet(ims, range(1, len(ims) + 1), cols=len(ims)) if len(set(i.size for i in ims)) == 1         else render.strip(ims)
    text, s = vlm.ask(PICK_HERO.format(n=len(group)), [sh], max_new_tokens=40, image_px=1024)
    try:
        k = group[int(vlm.json_of(text)["pick"]) - 1]
    except Exception:  # noqa: BLE001
        k = max(group, key=lambda g: info[g]["quality"])
    log("hero", s, of=len(group), pick=k, answer=text)
    return k


# ---------------------------------------------------------------- 3 page
def kept(pa, sa):
    r = pa / sa
    return min(r, 1 / r)


def rank_pages(library, group, hero, info, recent):
    """Same rule as src/album/templates/choose.ts: area-weighted share of each
    photo that survives its place; the hero takes the largest place."""
    aspects = [info[k]["w"] / info[k]["h"] for k in group]
    out = []
    for t in library:
        if t["photoCount"] != len(group):
            continue
        places = [(l["box"]["width"] * t["nativeAspect"] / max(1e-6, l["box"]["height"]),
                   l["box"]["width"] * l["box"]["height"]) for l in render.photo_layers(t)]
        total = sum(a for _, a in places) or 1
        largest = max(range(len(places)), key=lambda i: places[i][1])
        orders = itertools.permutations(range(len(group))) if len(group) <= 6 else [tuple(range(len(group)))]
        best, best_score = None, -1
        for order in orders:
            if group[order[largest]] != hero:
                continue
            sc = sum(places[pi][1] / total * kept(aspects[order[pi]], places[pi][0]) for pi in range(len(places)))
            if sc > best_score:
                best, best_score = order, sc
        if best is None:
            continue
        worst = min(kept(aspects[best[pi]], places[pi][0]) for pi in range(len(places)))
        out.append({"template": t, "photos": [group[i] for i in best], "score": best_score - (0.35 if t["id"] in recent else 0),
                    "kept": round(best_score, 3), "worst_kept": round(worst, 3)})
    return sorted(out, key=lambda c: -c["score"])


PICK_PAGE = """You are a senior album designer. These are {n} candidate designs for one album spread, numbered, all with the same photos.
Pick the design that presents these photos best: the strongest photo big, faces not cut, clean balance, feels like a premium printed album.
Answer ONLY with JSON: {{"pick": <number>, "why": "<10 words>"}}"""

PICK_COLOR = """You are a senior album designer. These are {n} colourings of the same album spread, numbered.
Pick the background colour that lifts the photos best: the photos stand out, skin looks good, the page feels calm and premium, it does not compete with the photos.
Answer ONLY with JSON: {{"pick": <number>, "why": "<10 words>"}}"""


def photo_args(cand, info, cache):
    out = []
    for k in cand["photos"]:
        if k not in cache:
            im = Image.open(info[k]["path"]).convert("RGB")
            im.thumbnail((1800, 1800))
            cache[k] = im
        out.append({"image": cache[k], "focal": info[k]["focal"], "faces": info[k]["faces"]})
    return out


# ---------------------------------------------------------------- 4 colour
def _lab_to_hex(L, C, h):
    import colorsys  # noqa: F401
    a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200
    g = lambda t: t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787  # noqa: E731
    X, Y, Z = 0.95047 * g(fx), g(fy), 1.08883 * g(fz)
    r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z
    gg = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z
    bb = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z
    f = lambda c: 255 * min(1, max(0, 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055))  # noqa: E731
    return "#%02x%02x%02x" % tuple(int(round(f(c))) for c in (r, gg, bb))


def _lum(hexv):
    r, g, b = (int(hexv.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def colourings(template, group, info):
    """Designed colours + three backgrounds from the photos' own hue."""
    hs, ws = [], []
    for k in group:
        for c in info[k]["palette"]["colors"]:
            if c["c"] >= 6:
                hs.append(c["h"])
                ws.append(c["weight"] * c["c"])
    if ws:
        x = sum(w * math.cos(math.radians(h)) for h, w in zip(hs, ws))
        y = sum(w * math.sin(math.radians(h)) for h, w in zip(hs, ws))
        hue = math.degrees(math.atan2(y, x)) % 360
    else:
        hue = 60.0
    designed = {c["id"]: c["value"] for c in template["colors"]}
    bg = template["backgroundToken"]
    variants = [("designed", {})]
    # colour fields (bands, panels) are elements too: they take a tone of the
    # photos' own hue, a step away from the new background
    fills = {l["fillToken"] for l in template["layers"]
             if l["type"] == "shape" and l.get("fillToken") and l["fillToken"] != bg}
    for name, L, C, FL, FC in (("light", 93, 5, 80, 12), ("mid", 70, 10, 88, 6), ("dark", 17, 7, 34, 12)):
        cols = {bg: _lab_to_hex(L, C, hue)}
        cols.update({tok: _lab_to_hex(FL, FC, hue) for tok in fills})
        dark_bg = L < 50
        for tok, v in designed.items():
            if tok == bg or tok in fills:
                continue
            # a line or word must stay visible on the new page
            if dark_bg and _lum(v) < 0.45:
                cols[tok] = "#f4efe8"
            elif not dark_bg and _lum(v) > 0.6:
                cols[tok] = _lab_to_hex(32, 8, hue)
        variants.append((name, cols))
    return variants


# ---------------------------------------------------------------- run
def main(folder, out, every=12, kind="newborn"):
    os.makedirs(out, exist_ok=True)
    os.makedirs(os.path.join(out, "sheets"), exist_ok=True)
    os.makedirs(os.path.join(out, "spreads"), exist_ok=True)
    files = sorted((f for f in os.listdir(folder) if f.lower().endswith((".jpg", ".jpeg"))), key=natural)
    chosen = files[::every]
    t0 = time.time()
    vlm.load()
    log("load", time.time() - t0)
    info = understand([os.path.join(folder, f) for f in chosen], out)
    spreads = plan(info, out, kind)["spreads"]
    library = render.load_library()
    images, recent, result = {}, [], []
    for i, sp in enumerate(spreads):
        cands = rank_pages(library, sp["photos"], sp["hero"], info, recent[-4:])
        if not cands:
            log("page", 0, spread=i, error=f"no Vault page for {len(sp['photos'])} photos")
            continue
        top = cands[:4]
        drawn = [render.render(c["template"], photo_args(c, info, images), height=300) for c in top]
        if len(top) > 1:
            sh = render.sheet(drawn, range(1, len(top) + 1))
            sh.save(os.path.join(out, "sheets", f"{i:02d}_page.jpg"), quality=85)
            text, s = vlm.ask(PICK_PAGE.format(n=len(top)), [sh], max_new_tokens=40, image_px=1024)
            try:
                pick = int(vlm.json_of(text)["pick"]) - 1
                assert 0 <= pick < len(top)
            except Exception:  # noqa: BLE001
                pick = 0
            log("page", s, spread=i, pick=pick + 1, of=len(top), answer=text)
        else:
            pick, text = 0, "only one page fits"
        chosen_c = top[pick]
        variants = colourings(chosen_c["template"], chosen_c["photos"], info)
        drawn = [render.render(chosen_c["template"], photo_args(chosen_c, info, images), cols, height=300)
                 for _, cols in variants]
        sh = render.sheet(drawn, range(1, len(variants) + 1))
        sh.save(os.path.join(out, "sheets", f"{i:02d}_colour.jpg"), quality=85)
        ctext, s = vlm.ask(PICK_COLOR.format(n=len(variants)), [sh], max_new_tokens=40, image_px=1024)
        try:
            cpick = int(vlm.json_of(ctext)["pick"]) - 1
            assert 0 <= cpick < len(variants)
        except Exception:  # noqa: BLE001
            cpick = 0
        log("colour", s, spread=i, pick=variants[cpick][0], answer=ctext)
        final = render.render(chosen_c["template"], photo_args(chosen_c, info, images), variants[cpick][1], height=600)
        final.save(os.path.join(out, "spreads", f"{i:02d}.jpg"), quality=90)
        recent.append(chosen_c["template"]["id"])
        result.append({"spread": i, "photos": chosen_c["photos"], "hero": sp["hero"], "set": sp["set"],
                       "template": chosen_c["template"]["id"], "kept": chosen_c["kept"],
                       "worst_kept": chosen_c["worst_kept"], "colour": variants[cpick][0],
                       "colours": variants[cpick][1], "page_answer": text, "colour_answer": ctext})
        json.dump({"result": result, "log": LOG, "total_s": round(time.time() - t0, 1)},
                  open(os.path.join(out, "3_result.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log("total", time.time() - t0, photos=len(chosen), spreads=len(result))
    json.dump({"result": result, "log": LOG, "total_s": round(time.time() - t0, 1)},
              open(os.path.join(out, "3_result.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 12)
