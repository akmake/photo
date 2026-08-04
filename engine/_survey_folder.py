"""Survey a folder: what the machine found, per face, with evidence to judge it.

This is the test bench the project has been missing. Every tuning decision so far
was made on one or two frames, and the architecture notes say plainly that
"validation on a single image is not validation". This runs the real pipeline
over a whole folder and emits, for each face:

    BEFORE | candidates outlined | AFTER

with accepted candidates in green and rejected ones in red, so a miss and a
false positive are both visible in the same picture. The numbers go to JSON so
runs can be diffed after a change.

It deliberately does NOT score anything. The independent read is a person
looking at the sheet; a detector cannot be its own referee — that was the
mistake that made every earlier round agree with itself.

    python _survey_folder.py <folder> <outdir> [strength]
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback

import cv2
import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import masks

FOLDER = sys.argv[1]
OUT = sys.argv[2]
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 100.0
os.makedirs(OUT, exist_ok=True)

ACCEPT = (60, 230, 120)
REJECT = (255, 90, 90)


def face_panels(rgb, out, det, lm, index, w, h):
    xs = np.array([p.x * w for p in lm])
    ys = np.array([p.y * h for p in lm])
    fw = float(np.hypot(
        (lm[masks.FACE_RIGHT].x - lm[masks.FACE_LEFT].x) * w,
        (lm[masks.FACE_RIGHT].y - lm[masks.FACE_LEFT].y) * h))
    pad = int(fw * 0.42)
    x0 = max(0, int(xs.min() - pad)); x1 = min(w, int(xs.max() + pad))
    y0 = max(0, int(ys.min() - pad)); y1 = min(h, int(ys.max() + fw * 0.60))
    if x1 - x0 < 40 or y1 - y0 < 40:
        return None, 0, 0

    marked = rgb.copy()
    acc = rej = 0
    for item in det["items"]:
        if item["face"] != index and det["faces"] > 1:
            continue
        good = item["verdict"] in ("accept", "accepted", "heal", "ok", True)
        colour = ACCEPT if good else REJECT
        acc, rej = (acc + 1, rej) if good else (acc, rej + 1)
        for contour in item["contours"]:
            pts = np.array([[int(px * w), int(py * h)] for px, py in contour], np.int32)
            if len(pts) >= 2:
                cv2.polylines(marked, [pts], True, colour, 1)

    tiles = []
    for label, img in (("BEFORE", rgb), ("candidates", marked), ("AFTER", out)):
        crop = img[y0:y1, x0:x1]
        p = Image.fromarray(crop)
        p = p.resize((int(p.width * 430 / p.height), 430), Image.LANCZOS)
        c = Image.new("RGB", (p.width, p.height + 22), (18, 18, 22))
        c.paste(p, (0, 22))
        ImageDraw.Draw(c).text((6, 5), f"{label}  face{index} {int(fw)}px",
                               fill=(235, 235, 235))
        tiles.append(c)
    row = Image.new("RGB", (sum(t.width for t in tiles) + 12, tiles[0].height),
                    (18, 18, 22))
    x = 0
    for t in tiles:
        row.paste(t, (x, 0)); x += t.width + 6
    return row, acc, rej


def survey(path: str) -> dict:
    name = os.path.splitext(os.path.basename(path))[0]
    rgb = common.to_np(common.load_image(path))
    masks.set_source(rgb)
    h, w = rgb.shape[:2]
    t0 = time.time()
    det = cleanup.detect(rgb, {"strength": STRENGTH})
    out, meta = cleanup.apply(rgb, {"redness": 90, "spots": 25, "gloss": 90})
    elapsed = time.time() - t0

    verdicts: dict = {}
    kinds: dict = {}
    for item in det["items"]:
        verdicts[str(item["verdict"])] = verdicts.get(str(item["verdict"]), 0) + 1
        kinds[str(item["kind"])] = kinds.get(str(item["kind"]), 0) + 1

    rows = []
    for index, lm in enumerate(masks._face_landmarks(rgb) or []):
        row, acc, rej = face_panels(rgb, out, det, lm, index, w, h)
        if row is not None:
            rows.append(row)
    if rows:
        sheet = Image.new("RGB", (max(r.width for r in rows),
                                  sum(r.height + 6 for r in rows)), (18, 18, 22))
        y = 0
        for r in rows:
            sheet.paste(r, (0, y)); y += r.height + 6
        sheet.save(os.path.join(OUT, f"{name}.jpg"), quality=92)

    diff = np.abs(out.astype(np.float32) - rgb.astype(np.float32)).mean(axis=2)
    record = {
        "image": name,
        "faces": det["faces"],
        "seconds": round(elapsed, 1),
        "candidates": len(det["items"]),
        "verdicts": verdicts,
        "kinds": kinds,
        "notes": det["notes"],
        "changedPx": int((diff > 1.0).sum()),
        "meta": {k: v for k, v in meta.items() if k != "colorHarmonization"},
    }
    print(f"{name:22s} faces={det['faces']} cand={len(det['items']):4d} "
          f"{verdicts}  notes={det['notes']}  {elapsed:.0f}s")
    return record


records = []
paths = []
for root, _, files in os.walk(FOLDER):
    for f in sorted(files):
        if f.lower().endswith((".jpg", ".jpeg", ".png")):
            paths.append(os.path.join(root, f))
print(f"{len(paths)} images\n")
for p in paths:
    try:
        records.append(survey(p))
    except Exception as exc:  # one bad frame must not lose the whole survey
        print(f"{os.path.basename(p):22s} FAILED: {exc}")
        traceback.print_exc()
        records.append({"image": os.path.basename(p), "error": str(exc)})

with open(os.path.join(OUT, "survey.json"), "w", encoding="utf-8") as fh:
    json.dump(records, fh, indent=1)
print(f"\nwrote {OUT}/survey.json  and {len(records)} sheets")
