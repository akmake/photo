"""Test-only: plain before/after of the face region at a judgeable size."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import common
import masks

SRC = sys.argv[1]
AFTER = sys.argv[2]
OUT = Path(sys.argv[3])
NAME = sys.argv[4] if len(sys.argv) > 4 else "face-ba"
TARGET_H = int(sys.argv[5]) if len(sys.argv) > 5 else 1000

rgb = common.to_np(common.load_image(SRC))
out = common.to_np(common.load_image(AFTER))

skin = masks.get_mask(rgb, "face-skin")
ys, xs = np.where(skin > 0.5)
fx0, fy0, fx1, fy1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
pad = int(max(fx1 - fx0, fy1 - fy0) * 0.28)
x0, y0 = max(0, fx0 - pad), max(0, fy0 - pad)
x1, y1 = min(rgb.shape[1], fx1 + pad), min(rgb.shape[0], fy1 + pad)

panels = []
for label, image in [("BEFORE", rgb), ("AFTER", out)]:
    panel = Image.fromarray(image[y0:y1, x0:x1])
    scale = TARGET_H / panel.height
    panel = panel.resize((int(panel.width * scale), TARGET_H), Image.LANCZOS)
    canvas = Image.new("RGB", (panel.width, panel.height + 34), (18, 18, 22))
    canvas.paste(panel, (0, 34))
    ImageDraw.Draw(canvas).text((10, 10), label, fill=(240, 240, 240))
    panels.append(canvas)

gap = 10
sheet = Image.new(
    "RGB", (sum(p.width for p in panels) + gap, panels[0].height), (18, 18, 22)
)
sheet.paste(panels[0], (0, 0))
sheet.paste(panels[1], (panels[0].width + gap, 0))
sheet.save(OUT / f"{NAME}.jpg", quality=96)
print("->", OUT / f"{NAME}.jpg", sheet.size)
