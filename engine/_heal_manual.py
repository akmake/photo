"""Test-only: heal a HAND-AUTHORED mask, to isolate healing from detection.

Every previous retouch attempt failed at *detection*.  This script hands
healing.py a mask a human drew, so the only question left is whether the
existing healing engine is good enough once the mask is right.

Strokes are polylines in ORIGINAL image pixels — the same thing a brush in the
UI would produce.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

import common
import healing
import masks

# (points, radius) — hand-read off _probe_rect.py output.
STROKES = [
    # the healing scratch beside the mouth: a curved streak
    ([(2172, 2299), (2176, 2303), (2180, 2307), (2184, 2311), (2185, 2316), (2185, 2320)], 6),
    # small pale flakes on the same cheek
    ([(2175, 2271)], 3),
    ([(2186, 2284)], 3),
    ([(2179, 2325)], 3),
    ([(2173, 2333)], 3),
]

# The window we inspect afterwards.
VIEW = (2130, 2255, 2240, 2365)

SRC = sys.argv[1]
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

rgb = common.to_np(common.load_image(SRC))
h, w = rgb.shape[:2]

repair = np.zeros((h, w), np.uint8)
for points, radius in STROKES:
    if len(points) == 1:
        cv2.circle(repair, points[0], radius, 255, -1, lineType=cv2.LINE_AA)
    else:
        for a, b in zip(points, points[1:]):
            cv2.line(repair, a, b, 255, radius * 2, lineType=cv2.LINE_AA)
        for p in points:
            cv2.circle(repair, p, radius, 255, -1, lineType=cv2.LINE_AA)
repair = (repair > 127).astype(np.uint8) * 255
print("mask pixels:", int((repair > 0).sum()))
Image.fromarray(repair).save(OUT / "repair-mask.png")

# Donors: skin only, never a facial feature — exactly what the brush would pass.
skin = masks.get_mask(rgb, "face-skin")
features = masks.get_mask(rgb, "face-features")
allowed = ((skin > 0.35) & (features < 0.15)).astype(np.uint8)
print("allowed skin pixels:", int(allowed.sum()))

overlay = rgb.copy()
tint = overlay[repair > 0].astype(np.float32)
overlay[repair > 0] = np.clip(tint * 0.45 + np.array([0, 255, 255]) * 0.55, 0, 255).astype(np.uint8)

results: list[tuple[str, np.ndarray]] = [("original", rgb), ("mask", overlay)]
for label, method in [
    ("Telea", "telea"),
    ("Navier-Stokes", "navier-stokes"),
    ("patch-frequency", "patch-frequency"),
    ("inpaint-texture", "inpaint-texture"),
]:
    started = time.perf_counter()
    out = healing.apply(rgb, repair, allowed, method)
    print(f"{label}: {(time.perf_counter() - started) * 1000:.1f}ms")
    results.append((label, out))
    Image.fromarray(out).save(OUT / f"full-{method}.jpg", quality=97)

x0, y0, x1, y1 = VIEW
zoom = 8
panels = []
for label, image in results:
    panel = Image.fromarray(image[y0:y1, x0:x1])
    panel = panel.resize((panel.width * zoom, panel.height * zoom), Image.LANCZOS)
    canvas = Image.new("RGB", (panel.width, panel.height + 34), (18, 18, 22))
    canvas.paste(panel, (0, 34))
    ImageDraw.Draw(canvas).text((10, 10), label, fill=(240, 240, 240))
    panels.append(canvas)

gap = 10
cols = 3
rows = (len(panels) + cols - 1) // cols
sheet = Image.new(
    "RGB",
    (panels[0].width * cols + gap * (cols - 1), panels[0].height * rows + gap * (rows - 1)),
    (18, 18, 22),
)
for i, panel in enumerate(panels):
    sheet.paste(panel, ((i % cols) * (panel.width + gap), (i // cols) * (panel.height + gap)))
sheet.save(OUT / "manual-heal-comparison.jpg", quality=96)
print("->", OUT / "manual-heal-comparison.jpg", sheet.size)
