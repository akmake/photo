"""Test-only: tight side-by-side of healing outputs at 1:1 and at high zoom."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import common

OUT = Path(sys.argv[1])
x0, y0, x1, y1 = (int(v) for v in sys.argv[2:6])
zoom = int(sys.argv[6]) if len(sys.argv) > 6 else 12

SRC = "C:/Users/yosef dahan/Downloads/321A4093.JPG"
files = [
    ("original", SRC),
    ("Telea", OUT / "full-telea.jpg"),
    ("Navier-Stokes", OUT / "full-navier-stokes.jpg"),
    ("inpaint-texture", OUT / "full-inpaint-texture.jpg"),
]

panels = []
for label, path in files:
    rgb = common.to_np(common.load_image(str(path)))
    panel = Image.fromarray(rgb[y0:y1, x0:x1])
    panel = panel.resize((panel.width * zoom, panel.height * zoom), Image.NEAREST)
    canvas = Image.new("RGB", (panel.width, panel.height + 32), (18, 18, 22))
    canvas.paste(panel, (0, 32))
    ImageDraw.Draw(canvas).text((10, 9), label, fill=(240, 240, 240))
    panels.append(canvas)

gap = 8
sheet = Image.new(
    "RGB",
    (panels[0].width * len(panels) + gap * (len(panels) - 1), panels[0].height),
    (18, 18, 22),
)
for i, p in enumerate(panels):
    sheet.paste(p, (i * (p.width + gap), 0))
sheet.save(OUT / "heal-zoom.jpg", quality=97)
print("->", OUT / "heal-zoom.jpg", sheet.size)
