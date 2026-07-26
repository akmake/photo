"""Test-only: full-face before/after for the 'remove everything' pass.

Deliberately shows the WHOLE face at a size a person can judge, plus a map of
what was detected.  A tight crop of one lesion is not evidence.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import masks

SRC = sys.argv[1]
OUT = Path(sys.argv[2])
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 100
MODE = sys.argv[4] if len(sys.argv) > 4 else "reconstruct"
OUT.mkdir(parents=True, exist_ok=True)

rgb = common.to_np(common.load_image(SRC))
masks.set_source(rgb)

started = time.perf_counter()
out, meta = cleanup.apply(rgb, {"strength": STRENGTH, "mode": MODE})
print(f"{MODE} strength={STRENGTH}: {(time.perf_counter() - started):.2f}s  {meta}")

# What did the detector actually decide?  Shown so misses and false hits are
# both visible instead of being inferred from the result.
skin = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin.sum()))
box = common.region_box(skin, int(face_d * 0.25), rgb.shape)
x0, y0, x1, y1 = box
got = cleanup.confidence(rgb[y0:y1, x0:x1], {"strength": STRENGTH})
detected = rgb.copy()
if got is not None:
    conf = got[0]
    tint = detected[y0:y1, x0:x1].astype(np.float32)
    a = np.clip(conf, 0, 1)[..., None]
    detected[y0:y1, x0:x1] = np.clip(
        tint * (1 - a) + np.array([0.0, 255.0, 255.0]) * a, 0, 255
    ).astype(np.uint8)

# Whole face, generous margin.
pad = int(face_d * 0.55)
vx0, vy0 = max(0, x0 - pad), max(0, y0 - pad)
vx1, vy1 = min(rgb.shape[1], x1 + pad), min(rgb.shape[0], y1 + pad)

panels = [("BEFORE", rgb), ("detected", detected), ("AFTER", out)]
target_h = 900
crops = []
for label, image in panels:
    panel = Image.fromarray(image[vy0:vy1, vx0:vx1])
    scale = target_h / panel.height
    panel = panel.resize((int(panel.width * scale), target_h), Image.LANCZOS)
    canvas = Image.new("RGB", (panel.width, panel.height + 34), (18, 18, 22))
    canvas.paste(panel, (0, 34))
    ImageDraw.Draw(canvas).text((10, 10), label, fill=(240, 240, 240))
    crops.append(canvas)

gap = 10
sheet = Image.new(
    "RGB",
    (sum(c.width for c in crops) + gap * (len(crops) - 1), crops[0].height),
    (18, 18, 22),
)
x = 0
for c in crops:
    sheet.paste(c, (x, 0))
    x += c.width + gap
name = f"removeall-{MODE}-s{int(STRENGTH)}"
sheet.save(OUT / f"{name}.jpg", quality=96)
Image.fromarray(out).save(OUT / f"{name}-full.jpg", quality=97)
print("->", OUT / f"{name}.jpg", sheet.size)
