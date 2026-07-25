"""Test-only probe: arbitrary rect at high zoom with a pixel-coordinate grid."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import common

SRC = sys.argv[1]
OUT = Path(sys.argv[2])
x0, y0, x1, y1 = (int(v) for v in sys.argv[3:7])
zoom = int(sys.argv[7]) if len(sys.argv) > 7 else 10
step = int(sys.argv[8]) if len(sys.argv) > 8 else 10
name = sys.argv[9] if len(sys.argv) > 9 else "probe-rect"
OUT.mkdir(parents=True, exist_ok=True)

rgb = common.to_np(common.load_image(SRC))
panel = Image.fromarray(rgb[y0:y1, x0:x1])
panel = panel.resize((panel.width * zoom, panel.height * zoom), Image.LANCZOS)
draw = ImageDraw.Draw(panel, "RGBA")

for gx in range(int(np.ceil(x0 / step)) * step, x1, step):
    px = (gx - x0) * zoom
    major = gx % (step * 5) == 0
    draw.line([(px, 0), (px, panel.height)], fill=(0, 255, 255, 170 if major else 45), width=1)
    if major:
        draw.text((px + 3, 3), str(gx), fill=(0, 255, 255, 255))
for gy in range(int(np.ceil(y0 / step)) * step, y1, step):
    py = (gy - y0) * zoom
    major = gy % (step * 5) == 0
    draw.line([(0, py), (panel.width, py)], fill=(255, 255, 0, 170 if major else 45), width=1)
    if major:
        draw.text((3, py + 3), str(gy), fill=(255, 255, 0, 255))

panel.save(OUT / f"{name}.jpg", quality=95)
print("->", OUT / f"{name}.jpg", panel.size)
