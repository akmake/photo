"""Look at what a change DROPPED, at the coordinates it used to be found.

A candidate that disappears cannot be probed through the detector any more — it
is not in the list. So the region is taken from the earlier run's `bboxFrame`
and cut out of the original frame directly: BEFORE, and what each tool does
there now. The question this answers is the only one that matters after a
precision fix — was the thing it stopped finding real?

    python _gt_lost.py <beforeJson> <afterJson> <tag> [spots]
"""

from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

import abpn
import cleanup
import common
import masks

PAD = 3.5
OUT_H = 380


def heals(path, tag, spots):
    for r in json.load(open(path, encoding="utf-8")):
        if r["image"] == tag:
            return r, [x for x in r["candidates"]
                       if x["spots"] == spots and x["verdict"] == "heal"]
    return None, []


def panel(img, box, label):
    x0, y0, x1, y1 = box
    crop = img[y0:y1, x0:x1]
    scale = OUT_H / max(1, crop.shape[0])
    crop = cv2.resize(crop, (int(crop.shape[1] * scale), OUT_H),
                      interpolation=cv2.INTER_NEAREST)
    cell = Image.new("RGB", (crop.shape[1], OUT_H + 20), (16, 16, 20))
    cell.paste(Image.fromarray(crop), (0, 20))
    ImageDraw.Draw(cell).text((5, 4), label, fill=(235, 235, 235))
    return cell


def main():
    before, after, tag = sys.argv[1], sys.argv[2], sys.argv[3]
    spots = float(sys.argv[4]) if len(sys.argv) > 4 else 25.0
    rec, was = heals(before, tag, spots)
    _, now = heals(after, tag, spots)
    kept = [tuple(x["bboxFrame"]) for x in now]

    def survived(b):
        return any(abs(b[0] - k[0]) < 0.004 and abs(b[1] - k[1]) < 0.004
                   for k in kept)

    lost = [x for x in was if not survived(tuple(x["bboxFrame"]))]
    print(f"{tag}: {len(was)} heals before, {len(now)} after, {len(lost)} dropped")
    if not lost:
        return

    rgb = common.to_np(common.load_image(rec["path"]))
    masks.set_source(rgb)
    h, w = rgb.shape[:2]
    cleaned, _ = cleanup.apply(rgb, {"redness": 90, "spots": 25})
    retouched, _ = abpn.apply(rgb, {"strength": 70})

    rows = []
    for x in lost:
        bx0, by0, bx1, by1 = x["bboxFrame"]
        cx, cy = (bx0 + bx1) / 2 * w, (by0 + by1) / 2 * h
        r = max(max((bx1 - bx0) * w, (by1 - by0) * h) * PAD / 2, 45)
        box = (max(0, int(cx - r)), max(0, int(cy - r)),
               min(w, int(cx + r)), min(h, int(cy + r)))
        cells = [
            panel(rgb, box, f"n{x['n']} {x['kind']} near={x['nearest']} d={x['distFaceD']}"),
            panel(cleaned, box, "now: skin-cleanup"),
            panel(retouched, box, "face-retouch"),
        ]
        row = Image.new("RGB", (sum(c.width + 4 for c in cells), cells[0].height),
                        (16, 16, 20))
        px = 0
        for c in cells:
            row.paste(c, (px, 0))
            px += c.width + 4
        rows.append(row)

    sheet = Image.new("RGB", (max(r.width for r in rows),
                              sum(r.height + 6 for r in rows)), (16, 16, 20))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 6
    out = os.path.join(os.path.dirname(after), "lost")
    os.makedirs(out, exist_ok=True)
    dest = os.path.join(out, f"{tag}.jpg")
    sheet.save(dest, quality=95)
    print(dest)


if __name__ == "__main__":
    main()
