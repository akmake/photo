"""Test-only: what did the detector actually mark, on the marks that matter?"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import masks

SRC = sys.argv[1]
OUT = Path(sys.argv[2])
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 100
VIEW = (2120, 2250, 2250, 2380)

rgb = common.to_np(common.load_image(SRC))
masks.set_source(rgb)
skin = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin.sum()))
print("face_d:", face_d, " max_side gate:", max(8, int(face_d * 0.16)))

x0, y0, x1, y1 = common.region_box(skin, int(face_d * 0.25), rgb.shape)
got = cleanup.confidence(rgb[y0:y1, x0:x1], {"strength": STRENGTH})
conf, _region, face_c, _model = got
repair = cleanup.decide(conf, face_c)
full = np.zeros(rgb.shape[:2], np.float32)
full[y0:y1, x0:x1] = repair.astype(np.float32)
n, _, _, _ = __import__("cv2").connectedComponentsWithStats(repair, connectivity=8)
print(f"decided: {int(repair.sum())} px in {n - 1} lesions")

after = common.to_np(common.load_image(str(OUT / "removeall-reconstruct-s100-full.jpg")))

vx0, vy0, vx1, vy1 = VIEW
overlay = rgb.copy().astype(np.float32)
a = np.clip(full, 0, 1)[..., None]
overlay = overlay * (1 - a) + np.array([0.0, 255.0, 255.0]) * a

zoom = 7
panels = []
for label, image in [
    ("BEFORE", rgb),
    ("decided mask", overlay.astype(np.uint8)),
    ("AFTER", after),
]:
    panel = Image.fromarray(np.asarray(image, np.uint8)[vy0:vy1, vx0:vx1])
    panel = panel.resize((panel.width * zoom, panel.height * zoom), Image.LANCZOS)
    canvas = Image.new("RGB", (panel.width, panel.height + 34), (18, 18, 22))
    canvas.paste(panel, (0, 34))
    ImageDraw.Draw(canvas).text((10, 10), label, fill=(240, 240, 240))
    panels.append(canvas)

gap = 10
sheet = Image.new(
    "RGB",
    (sum(p.width for p in panels) + gap * 2, panels[0].height),
    (18, 18, 22),
)
x = 0
for p in panels:
    sheet.paste(p, (x, 0))
    x += p.width + gap
sheet.save(OUT / "diag-detect.jpg", quality=96)
print("->", OUT / "diag-detect.jpg", sheet.size)
