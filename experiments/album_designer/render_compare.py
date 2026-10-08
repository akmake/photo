"""Draw every spread of the old and the new automatic build, from measure.ts
output, into one review page. Uses the exact crop the program computes."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
import vault_draw

def main(compare, inp, out_html):
    c = json.load(open(compare, encoding="utf-8"))
    photos = {p["id"]: p for p in json.load(open(inp, encoding="utf-8"))["photos"]}
    lib = {t["id"]: t for t in vault_draw.load_library()}
    out_dir = os.path.dirname(out_html)
    cache = {}
    rows = []
    for side in ("old", "new"):
        files = []
        for i, r in enumerate(c[side]["rows"]):
            t = lib[r["template"]]
            args = []
            for pl in r["placed"]:
                if pl["id"] not in cache:
                    im = Image.open(photos[pl["id"]]["sourcePath"]).convert("RGB")
                    im.thumbnail((1400, 1400))
                    cache[pl["id"]] = im
                im = cache[pl["id"]]
                w, h = im.size
                cr = pl["crop"]
                args.append({"image": im.crop((int(cr["x"] * w), int(cr["y"] * h),
                                               int((cr["x"] + cr["width"]) * w), int((cr["y"] + cr["height"]) * h))),
                             "focal": {"x": .5, "y": .5}})
            img = vault_draw.render(t, args, r["colors"], height=420)
            d = ImageDraw.Draw(img)
            x = img.width // 2
            d.line([(x, 0), (x, img.height)], fill=(255, 0, 0), width=1)  # the fold
            name = f"{side}_{i:02d}.jpg"
            img.save(os.path.join(out_dir, name), quality=88)
            flags = [p for p in r["placed"] if p["fold"] or p["cut"]]
            files.append((name, r["template"], len(r["placed"]), flags))
        rows.append((side, c[side]["summary"], files))
    html = ["<!doctype html><meta charset=utf-8><title>בנייה אוטומטית: לפני ואחרי</title>",
            "<style>body{font-family:system-ui;background:#1b1b1b;color:#eee;margin:16px}"
            ".cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{width:100%;display:block}"
            ".s{margin:0 0 14px}.m{font-size:12px;color:#aaa;margin:3px 0}.bad{color:#ff6b6b}</style>",
            "<h2 dir=rtl>בנייה אוטומטית — ישן (ימין) מול חדש (שמאל) · 35 תמונות ניו בורן</h2>",
            "<p dir=rtl class=m>ציור של הבדיקה שלי, לא התוכנה עצמה. הקו האדום = הקפל.</p><div class=cols dir=rtl>"]
    for side, summary, files in rows:
        html.append(f"<div><h3>{'ישן' if side=='old' else 'חדש'}</h3><p class=m>{summary}</p>")
        for name, tid, n, flags in files:
            bad = f" <span class=bad>פנים על הקפל</span>" if any(f['fold'] for f in flags) else ""
            html.append(f"<div class=s><img src='{name}'><p class=m>{tid} · {n} תמונות{bad}</p></div>")
        html.append("</div>")
    html.append("</div>")
    open(out_html, "w", encoding="utf-8").write("\n".join(html))

main(*sys.argv[1:])
