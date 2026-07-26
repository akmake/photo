"""Test-only: render each anatomy protection region in its own colour.

A protection region that is misplaced is invisible in the final image — it just
silently blocks a repair. This makes it visible, and specifically checks that
the scratch beside the mouth is NOT swallowed by the nasolabial band.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

import common
import masks

SRC = sys.argv[1]
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

COLOURS = {
    "eye-l": (80, 160, 255),
    "eye-r": (80, 160, 255),
    "brow-l": (140, 110, 255),
    "brow-r": (140, 110, 255),
    "eyelid-crease-l": (255, 255, 120),
    "eyelid-crease-r": (255, 255, 120),
    "infraorbital-l": (0, 220, 220),
    "infraorbital-r": (0, 220, 220),
    "nose": (255, 200, 60),
    "lips": (255, 80, 140),
    "nasolabial": (60, 255, 120),
    "chin-crease": (200, 120, 255),
    "contour": (255, 255, 255),
}

# The lesion we must NOT protect (from _heal_manual.py).
SCRATCH = ((2172, 2299), (2185, 2320))

rgb = common.to_np(common.load_image(SRC))
masks.set_source(rgb)

small = common.downscale(rgb)
faces = masks._face_landmarks(small)
print("faces:", len(faces))
if not faces:
    raise SystemExit("no face")

overlay = rgb.astype(np.float32)
combined_small = np.zeros(small.shape[:2], np.uint8)
for lm in faces:
    for name, part in masks.anatomy_parts(small, lm).items():
        combined_small = np.maximum(combined_small, part)
        big = common.upscale_to(part.astype(np.float32) / 255.0, rgb.shape)
        a = np.clip(big, 0, 1)[..., None] * 0.55
        overlay = overlay * (1 - a) + np.array(COLOURS[name], np.float32) * a
        print(f"  {name:12s} {int((part > 0).sum()):7d} px (at proc scale)")

# Does the protection swallow the mark we need to remove?
protect = common.upscale_to(combined_small.astype(np.float32) / 255.0, rgb.shape)
(sx0, sy0), (sx1, sy1) = SCRATCH
patch = protect[sy0 - 6 : sy1 + 6, sx0 - 6 : sx1 + 6]
print(f"\nscratch region protected: {float(patch.mean()) * 100:.1f}% of pixels")
if patch.mean() > 0.25:
    print("  !! the protection band is eating the lesion — band is too wide")

overlay = np.clip(overlay, 0, 255).astype(np.uint8)
draw_full = Image.fromarray(overlay)
d = ImageDraw.Draw(draw_full)
d.rectangle((sx0 - 8, sy0 - 8, sx1 + 8, sy1 + 8), outline=(255, 0, 0), width=3)
overlay = np.asarray(draw_full)

skin = masks.get_mask(rgb, "face-skin")
ys, xs = np.where(skin > 0.5)
fx0, fy0, fx1, fy1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
pad = int(max(fx1 - fx0, fy1 - fy0) * 0.30)
x0, y0 = max(0, fx0 - pad), max(0, fy0 - pad)
x1, y1 = min(rgb.shape[1], fx1 + pad), min(rgb.shape[0], fy1 + pad)

panels = []
for label, image in [("BEFORE", rgb), ("anatomy protected", overlay)]:
    panel = Image.fromarray(image[y0:y1, x0:x1])
    scale = 1000 / panel.height
    panel = panel.resize((int(panel.width * scale), 1000), Image.LANCZOS)
    canvas = Image.new("RGB", (panel.width, panel.height + 34), (18, 18, 22))
    canvas.paste(panel, (0, 34))
    ImageDraw.Draw(canvas).text((10, 10), label, fill=(240, 240, 240))
    panels.append(canvas)

sheet = Image.new(
    "RGB", (sum(p.width for p in panels) + 10, panels[0].height), (18, 18, 22)
)
sheet.paste(panels[0], (0, 0))
sheet.paste(panels[1], (panels[0].width + 10, 0))
sheet.save(OUT / "diag-anatomy.jpg", quality=96)
print("->", OUT / "diag-anatomy.jpg", sheet.size)
