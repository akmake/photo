"""Read a designer's album PDF (InDesign export): per spread, every photo's
frame, the Vault page it matches (as designed or mirrored), the background,
the words. Writes spreads.json + one PNG per spread + every photo."""
import json, os, re, sys
import fitz  # PyMuPDF (system Python)

pdf, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(out, "spreads"), exist_ok=True)
os.makedirs(os.path.join(out, "photos"), exist_ok=True)
src = open(os.path.join(os.path.dirname(__file__), "..", "..", "src", "album", "templates", "vaultLibrary.ts"), encoding="utf-8").read()
vault = json.loads(json.loads(re.search(r'JSON\.parse\((".*?")\);', src, re.S).group(1)))

def boxes_of(t, mirror=False):
    out = []
    for l in t["layers"]:
        if l["type"] != "photo":
            continue
        b = dict(l["box"])
        if mirror:
            b["x"] = 1 - b["x"] - b["width"]
        out.append(b)
    return out

def dist(a, b):
    """Mean edge distance between two sets of boxes (best one-to-one, greedy)."""
    if len(a) != len(b):
        return 9
    rest, total = list(b), 0
    for p in sorted(a, key=lambda p: -p["width"] * p["height"]):
        q = min(rest, key=lambda q: abs(p["x"] - q["x"]) + abs(p["y"] - q["y"]) + abs(p["width"] - q["width"]) + abs(p["height"] - q["height"]))
        rest.remove(q)
        total += abs(p["x"] - q["x"]) + abs(p["y"] - q["y"]) + abs(p["width"] - q["width"]) + abs(p["height"] - q["height"])
    return total / len(a) / 4

doc = fitz.open(pdf)
spreads = []
for i, page in enumerate(doc):
    W, H = page.rect.width, page.rect.height
    pix = page.get_pixmap(dpi=40)
    pix.save(os.path.join(out, "spreads", f"{i:02d}.png"))
    frames = []
    for k, inf in enumerate(page.get_image_info(xrefs=True)):
        x0, y0, x1, y1 = inf["bbox"]
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
        name = f"{i:02d}_{k}.jpg"
        img = fitz.Pixmap(doc, inf["xref"])
        if img.n - img.alpha >= 4:
            img = fitz.Pixmap(fitz.csRGB, img)
        img.save(os.path.join(out, "photos", name.replace(".jpg", ".png")))
        frames.append({"photo": name.replace(".jpg", ".png"), "px": [inf["width"], inf["height"]],
                       "box": {"x": x0 / W, "y": y0 / H, "width": (x1 - x0) / W, "height": (y1 - y0) / H}})
    best = min(((dist(frames and [f["box"] for f in frames], boxes_of(t, m)), t["id"] + ("~m" if m else ""))
                for t in vault for m in (False, True) if t["photoCount"] == len(frames)), default=(9, None))
    # background: the page pixels outside every frame
    full = page.get_pixmap(dpi=20)
    bg = []
    for y in range(0, full.height, 2):
        for x in range(0, full.width, 2):
            fx, fy = x / full.width, y / full.height
            if not any(f["box"]["x"] - .01 <= fx <= f["box"]["x"] + f["box"]["width"] + .01 and
                       f["box"]["y"] - .01 <= fy <= f["box"]["y"] + f["box"]["height"] + .01 for f in frames):
                bg.append(full.pixel(x, y)[:3])
    bgc = None
    if bg:
        bg.sort(key=lambda c: sum(c))
        m = bg[len(bg) // 2]
        bgc = "#%02x%02x%02x" % tuple(m)
    spreads.append({"spread": i, "frames": frames, "vault": best[1], "vault_distance": round(best[0], 4),
                    "background": bgc, "background_share": round(len(bg) / max(1, (full.width // 2) * (full.height // 2)), 2),
                    "text": page.get_text().strip().replace("\n", " ")})
json.dump(spreads, open(os.path.join(out, "spreads.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for s in spreads:
    print(s["spread"], len(s["frames"]), s["vault"], s["vault_distance"], s["background"], s["background_share"], s["text"][:30])
