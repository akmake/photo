"""Controlled healing comparison on 321A4093.

The circles below are test-only ground truth.  The healing algorithms do not
receive their coordinates or any colour-specific blemish rules.
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


SRC = sys.argv[1]
OUT_DIR = Path(sys.argv[2])
OUT_DIR.mkdir(parents=True, exist_ok=True)

rgb = common.to_np(common.load_image(SRC))
skin = masks.get_mask(rgb, "face-skin")
features = masks.get_mask(rgb, "face-features")
ys, xs = np.where(skin > 0.5)
fx0, fy0, fx1, fy1 = xs.min(), ys.min(), xs.max(), ys.max()
fw, fh = fx1 - fx0, fy1 - fy0

# Normalised positions make the test annotation readable and resilient to the
# original image's EXIF orientation.  These values are not used by healing.py.
marks = [
    (0.80, 0.55, 0.040),  # bright residue beside the nose
    (0.74, 0.63, 0.060),  # inflamed/raised cheek blemish and its halo
    (0.83, 0.70, 0.050),  # pale residue toward the mouth corner
    (0.58, 0.86, 0.050),  # lower-face blemish and its halo
]

repair_mask = np.zeros(rgb.shape[:2], np.uint8)
for nx, ny, nr in marks:
    center = (int(fx0 + nx * fw), int(fy0 + ny * fh))
    radius = max(3, int(nr * max(fw, fh)))
    cv2.circle(repair_mask, center, radius, 255, -1, lineType=cv2.LINE_AA)

allowed = ((skin > 0.35) & (features < 0.15)).astype(np.uint8)

results = [("original", rgb)]
marked = Image.fromarray(rgb.copy())
draw = ImageDraw.Draw(marked)
for nx, ny, nr in marks:
    center = (int(fx0 + nx * fw), int(fy0 + ny * fh))
    radius = max(3, int(nr * max(fw, fh)))
    draw.ellipse(
        (
            center[0] - radius,
            center[1] - radius,
            center[0] + radius,
            center[1] + radius,
        ),
        outline=(0, 255, 255),
        width=2,
    )
results.append(("manual mask", np.asarray(marked)))

for label, method in [
    ("Telea", "telea"),
    ("Navier-Stokes", "navier-stokes"),
    ("patch-frequency", "patch-frequency"),
    ("patch-Poisson", "patch-poisson"),
]:
    started = time.perf_counter()
    result = healing.apply(rgb, repair_mask, allowed, method)
    elapsed = (time.perf_counter() - started) * 1000
    print(f"{label}: {elapsed:.1f}ms")
    results.append((label, result))

pad = int(max(fw, fh) * 0.20)
x0, x1 = max(0, fx0 - pad), min(rgb.shape[1], fx1 + pad)
y0 = fy0 + int(fh * 0.35)
y1 = min(rgb.shape[0], fy1 + pad)
zoom = 4

panels = []
for label, image in results:
    panel = Image.fromarray(image[y0:y1, x0:x1])
    panel = panel.resize((panel.width * zoom, panel.height * zoom), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (panel.width, panel.height + 38), (18, 18, 22))
    canvas.paste(panel, (0, 38))
    ImageDraw.Draw(canvas).text((12, 11), label, fill=(240, 240, 240))
    panels.append(canvas)
    safe_label = label.lower().replace(" ", "-")
    canvas.save(OUT_DIR / f"{safe_label}-zoom.jpg", quality=97)

gap = 12
cols = 2
rows = (len(panels) + cols - 1) // cols
comparison = Image.new("RGB", (
    panels[0].width * cols + gap * (cols - 1),
    panels[0].height * rows + gap * (rows - 1),
), (18, 18, 22))
for index, panel in enumerate(panels):
    x = (index % cols) * (panel.width + gap)
    y = (index // cols) * (panel.height + gap)
    comparison.paste(panel, (x, y))

comparison.save(OUT_DIR / "healing-comparison.jpg", quality=97)
Image.fromarray(results[-1][1]).save(OUT_DIR / "patch-frequency-full.jpg", quality=96)
Image.fromarray(repair_mask).save(OUT_DIR / "manual-mask.png")
print(f"wrote {OUT_DIR / 'healing-comparison.jpg'}")
