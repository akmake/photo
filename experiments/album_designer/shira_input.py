"""The designer's album as input for my builder: same photos, reading order,
the designer's own chapters (where the background colour changes)."""
import json, os, sys
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", "engine"))
from PIL import Image
import album_analysis

out = sys.argv[1]
spreads = json.load(open(os.path.join(out, "spreads.json"), encoding="utf-8"))
photos, chapters, last_bg, faces_fold = [], [], object(), []
for s in spreads:
    bg = s["background"] or last_bg  # a full-bleed spread keeps its chapter
    if bg != last_bg:
        chapters.append({"id": f"c{len(chapters)}", "label": bg, "photoIds": []})
        last_bg = bg
    for f in sorted(s["frames"], key=lambda f: f["box"]["x"]):
        p = os.path.join(out, "photos", f["photo"])
        a = album_analysis.analyze(Image.open(p).convert("RGB"))
        o = "portrait" if a["heightPx"] > a["widthPx"] * 1.05 else ("landscape" if a["widthPx"] > a["heightPx"] * 1.05 else "square")
        photos.append({"id": f["photo"], "name": f["photo"], "url": "", "orientation": o,
                       "widthPx": a["widthPx"], "heightPx": a["heightPx"],
                       "analysis": {"status": "ready", "faces": a["faces"], "focalPoint": a["focalPoint"], "subject": a["subject"],
                                    "sharpnessScore": a["sharpnessScore"], "qualityScore": a["qualityScore"],
                                    "palette": a["palette"], "analyzedBy": a["analyzedBy"]}, "sourcePath": p})
        chapters[-1]["photoIds"].append(f["photo"])
        b = f["box"]
        for face in a["faces"]:  # the designer's frames hold the photo exactly as cropped
            x0, x1 = b["x"] + face["x"] * b["width"], b["x"] + (face["x"] + face["width"]) * b["width"]
            gap = 0 if x0 < 0.5 < x1 else min(abs(x0 - 0.5), abs(x1 - 0.5))
            faces_fold.append((s["spread"], f["photo"], round(gap * 560, 1)))
json.dump({"photos": photos, "sessions": chapters}, open(os.path.join(out, "album_input.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("chapters", [len(c["photoIds"]) for c in chapters])
print("faces", len(faces_fold), "closest to the fold (mm on a 56cm spread):", sorted(faces_fold, key=lambda t: t[2])[:6])
