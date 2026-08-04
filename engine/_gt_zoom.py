"""Native-resolution zoom tiles, so the referee's read is not a read of an upscale.

The overview crop in `_gt_bench` is resampled to a fixed 1150px height, which is
right for locating things and wrong for judging them: on a big frame it throws
detail away, and on a small one it invents the appearance of detail. This cuts
four tiles per face at 1:1 — forehead, each cheek, mouth-and-chin — and lays
them out as one sheet, labelled, so a face costs one look instead of four.

A tile is only worth cutting when there is something under it: below
MIN_NATIVE the overview already shows every pixel that exists, and a zoom sheet
would be an upscale of an upscale.

    python _gt_zoom.py <folder> <outdir>
"""

from __future__ import annotations

import os
import sys
import traceback

import cv2
import numpy as np
from PIL import Image, ImageDraw

import common
import masks

MIN_NATIVE = 420  # face width in px below which a 1:1 tile adds nothing
TILE_H = 560      # each tile is drawn at this height in the sheet


def tiles_for(lm, w, h, face_d):
    """(label, x0, y0, x1, y1) per region, in frame pixels."""
    def pt(i):
        return lm[i].x * w, lm[i].y * h

    bx, by = pt(masks.NOSE_TIP)
    lx, ly = pt(masks.LEFT_CHEEK_CENTER)
    rx, ry = pt(masks.RIGHT_CHEEK_CENTER)
    fx, fy = pt(9)     # glabella, between the brows
    mx, my = pt(17)    # lower lip centre
    r = face_d * 0.34

    def box(cx, cy, scale=1.0):
        rr = r * scale
        return (
            max(0, int(cx - rr)), max(0, int(cy - rr)),
            min(w, int(cx + rr)), min(h, int(cy + rr)),
        )

    return [
        ("forehead", box(fx, fy - face_d * 0.28, 1.15)),
        ("cheek-L", box(lx, ly)),
        ("cheek-R", box(rx, ry)),
        ("mouth-chin", box(mx, my + face_d * 0.10)),
    ]


def sheet_for(rgb, lm, w, h, face_d):
    cells = []
    for label, (x0, y0, x1, y1) in tiles_for(lm, w, h, face_d):
        if x1 - x0 < 20 or y1 - y0 < 20:
            continue
        tile = rgb[y0:y1, x0:x1]
        scale = TILE_H / tile.shape[0]
        tile = cv2.resize(
            tile,
            (int(tile.shape[1] * scale), TILE_H),
            interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4,
        )
        cell = Image.new("RGB", (tile.shape[1], TILE_H + 20), (16, 16, 20))
        cell.paste(Image.fromarray(tile), (0, 20))
        ImageDraw.Draw(cell).text(
            (5, 4), f"{label}  1:{scale:.2f}", fill=(230, 230, 230)
        )
        cells.append(cell)
    if not cells:
        return None
    cols = 2
    rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
    width = max(sum(c.width + 4 for c in r) for r in rows)
    sheet = Image.new("RGB", (width, sum(r[0].height + 4 for r in rows)),
                      (16, 16, 20))
    y = 0
    for row in rows:
        x = 0
        for c in row:
            sheet.paste(c, (x, y))
            x += c.width + 4
        y += row[0].height + 4
    return sheet


def run(path, out):
    name = os.path.splitext(os.path.basename(path))[0]
    tag = f"{os.path.basename(os.path.dirname(path))}_{name}"
    rgb = common.to_np(common.load_image(path))
    masks.set_source(rgb)
    h, w = rgb.shape[:2]
    made = 0
    for index, lm in enumerate(masks._face_landmarks(rgb) or []):
        face_d = float(np.hypot(
            (lm[masks.FACE_RIGHT].x - lm[masks.FACE_LEFT].x) * w,
            (lm[masks.FACE_RIGHT].y - lm[masks.FACE_LEFT].y) * h))
        if face_d < MIN_NATIVE:
            continue
        sheet = sheet_for(rgb, lm, w, h, face_d)
        if sheet is not None:
            sheet.save(os.path.join(out, f"{tag}_f{index}.jpg"), quality=95)
            made += 1
    print(f"{tag:24s} zoom sheets={made}")


def main():
    folder, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    paths = []
    if os.path.isfile(folder):
        paths.append(folder)
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                paths.append(os.path.join(root, f))
    for p in paths:
        try:
            run(p, out)
        except Exception as exc:  # noqa: BLE001
            print(f"{os.path.basename(p):24s} FAILED: {exc}")
            traceback.print_exc()


if __name__ == "__main__":
    main()
