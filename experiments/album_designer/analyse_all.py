"""Analyse every photo of a shoot the way the album does (faces, focal,
palette, quality) + DINOv2 sets, and write album_input.json for measure.ts."""
import json, os, re, sys
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "..", "engine"))
import numpy as np
from PIL import Image
import album_analysis, embed

folder, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(out), exist_ok=True)
nat = lambda n: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", n)]
files = sorted((f for f in os.listdir(folder) if f.lower().endswith((".jpg", ".jpeg"))), key=nat)
sess = embed._session_instance()
photos, V = [], []
for i, f in enumerate(files):
    p = os.path.join(folder, f)
    img = Image.open(p).convert("RGB")
    a = album_analysis.analyze(img)
    o = "portrait" if a["heightPx"] > a["widthPx"] * 1.05 else ("landscape" if a["widthPx"] > a["heightPx"] * 1.05 else "square")
    photos.append({"id": f, "name": f, "url": "", "orientation": o, "widthPx": a["widthPx"], "heightPx": a["heightPx"],
                   "analysis": {"status": "ready", "faces": a["faces"], "focalPoint": a["focalPoint"], "subject": a["subject"],
                                "sharpnessScore": a["sharpnessScore"], "qualityScore": a["qualityScore"],
                                "palette": a["palette"], "analyzedBy": a["analyzedBy"]},
                   "sourcePath": p})
    V.append(embed._infer(sess, embed._preprocess(p)))
    if i % 50 == 0:
        print(i, flush=True)
V = np.stack(V)
sets = [[0]]
for i in range(1, len(files)):
    (sets.append([i]) if float(V[i] @ V[i - 1]) < 0.6 else sets[-1].append(i))
sessions = [{"id": f"s{k}", "label": f"s{k}", "photoIds": [files[i] for i in s]} for k, s in enumerate(sets)]
json.dump({"photos": photos, "sessions": sessions}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print("done", len(photos), "sets", len(sessions))
