"""Zoom one candidate to the point where the verdict is not a matter of opinion.

The montage sheet is for locating; this is for deciding. Given an image and a
candidate number it emits BEFORE | outlined | AFTER-cleanup | AFTER-retouch for
that candidate alone, magnified, with the outline still a 1px hairline so the
pixels under it are visible — the whole question is what is under it.

    python _gt_probe.py <benchdir> <folder> <tag> <face> <spots> <n>[,<n>...]

    _gt_probe.py ../test-results/gt-bench "<photos>" 33_321A4934 0 25 4
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

PAD = 3.0     # how much context around the candidate, in bbox widths
OUT_H = 420   # height of each panel


def panel(img, box, label, contour=None, colour=(60, 230, 120)):
    x0, y0, x1, y1 = box
    crop = img[y0:y1, x0:x1].copy()
    scale = OUT_H / max(1, crop.shape[0])
    crop = cv2.resize(crop, (int(crop.shape[1] * scale), OUT_H),
                      interpolation=cv2.INTER_NEAREST)
    if contour is not None:
        pts = np.array([[int((px - x0) * scale), int((py - y0) * scale)]
                        for px, py in contour], np.int32)
        if len(pts) >= 2:
            cv2.polylines(crop, [pts], True, colour, 1, cv2.LINE_AA)
    cell = Image.new("RGB", (crop.shape[1], OUT_H + 20), (16, 16, 20))
    cell.paste(Image.fromarray(crop), (0, 20))
    ImageDraw.Draw(cell).text((5, 4), label, fill=(235, 235, 235))
    return cell


def main():
    base, folder, tag, face, spots, ns = sys.argv[1:7]
    face, spots = int(face), float(spots)
    wanted = [int(x) for x in ns.split(",")]

    recs = json.load(open(os.path.join(base, "bench.json"), encoding="utf-8"))
    rec = next(r for r in recs if r["image"] == tag)
    path = rec["path"]
    if not os.path.exists(path):  # folder may have been renamed since the run
        path = os.path.join(folder, tag.split("_")[0],
                            tag.split("_", 1)[1] + ".JPG")

    rgb = common.to_np(common.load_image(path))
    masks.set_source(rgb)
    h, w = rgb.shape[:2]
    det = cleanup.detect(rgb, {"strength": spots})
    cleaned, _ = cleanup.apply(rgb, {"redness": 90, "spots": 25})
    retouched, _ = abpn.apply(rgb, {"strength": 70})

    items = [it for it in det["items"] if it["face"] == face or det["faces"] < 2]
    rows = []
    for n in wanted:
        item = items[n - 1]
        bx0, by0, bx1, by1 = item["bbox"]
        cx, cy = (bx0 + bx1) / 2 * w, (by0 + by1) / 2 * h
        r = max((bx1 - bx0) * w, (by1 - by0) * h) * PAD / 2
        r = max(r, 40)
        box = (max(0, int(cx - r)), max(0, int(cy - r)),
               min(w, int(cx + r)), min(h, int(cy + r)))
        contour = [(px * w, py * h) for px, py in item["contours"][0]]
        cells = [
            panel(rgb, box, f"#{n} BEFORE"),
            panel(rgb, box, f"{item['kind']}/{item['verdict']}", contour),
            panel(cleaned, box, "AFTER skin-cleanup"),
            panel(retouched, box, "AFTER face-retouch"),
        ]
        row = Image.new("RGB", (sum(c.width + 4 for c in cells), cells[0].height),
                        (16, 16, 20))
        x = 0
        for c in cells:
            row.paste(c, (x, 0))
            x += c.width + 4
        rows.append(row)

    sheet = Image.new("RGB", (max(r.width for r in rows),
                              sum(r.height + 6 for r in rows)), (16, 16, 20))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 6
    out = os.path.join(base, "probe")
    os.makedirs(out, exist_ok=True)
    name = f"{tag}_f{face}_s{int(spots)}_{'-'.join(str(n) for n in wanted)}.jpg"
    sheet.save(os.path.join(out, name), quality=95)
    print(os.path.join(out, name))
    for n in wanted:
        it = items[n - 1]
        print(f"  #{n} {it['kind']}/{it['verdict']} {it['facts']}")


if __name__ == "__main__":
    main()
