"""Test-only probe: zoomed lower face with a pixel-coordinate grid.

Lets a human (or me) read exact original-image coordinates off a blemish so a
manual repair mask can be authored precisely.  Not part of the product.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import common
import masks

SRC = sys.argv[1]
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

rgb = common.to_np(common.load_image(SRC))
print("image:", rgb.shape)

skin = masks.get_mask(rgb, "face-skin")
ys, xs = np.where(skin > 0.5)
fx0, fy0, fx1, fy1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
fw, fh = fx1 - fx0, fy1 - fy0
print(f"face bbox: x {fx0}..{fx1}  y {fy0}..{fy1}  ({fw}x{fh})")

# Lower face only — that is where the marks the user objects to live.
x0 = max(0, fx0 - int(fw * 0.05))
x1 = min(rgb.shape[1], fx1 + int(fw * 0.05))
y0 = fy0 + int(fh * 0.42)
y1 = min(rgb.shape[0], fy1 + int(fh * 0.08))
print(f"crop: x {x0}..{x1}  y {y0}..{y1}")

zoom = 4
panel = Image.fromarray(rgb[y0:y1, x0:x1])
panel = panel.resize((panel.width * zoom, panel.height * zoom), Image.LANCZOS)
draw = ImageDraw.Draw(panel, "RGBA")

step = 50  # original pixels between grid lines
for gx in range(int(np.ceil(x0 / step)) * step, x1, step):
    px = (gx - x0) * zoom
    major = gx % 200 == 0
    draw.line([(px, 0), (px, panel.height)], fill=(0, 255, 255, 150 if major else 60), width=2 if major else 1)
    if major:
        draw.text((px + 4, 4), str(gx), fill=(0, 255, 255, 255))
for gy in range(int(np.ceil(y0 / step)) * step, y1, step):
    py = (gy - y0) * zoom
    major = gy % 200 == 0
    draw.line([(0, py), (panel.width, py)], fill=(255, 255, 0, 150 if major else 60), width=2 if major else 1)
    if major:
        draw.text((4, py + 4), str(gy), fill=(255, 255, 0, 255))

panel.save(OUT / "probe-grid.jpg", quality=95)
print("->", OUT / "probe-grid.jpg", panel.size)
