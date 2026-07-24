"""Show what the skin model considers a flaw — and prove the cheeks are not."""

import sys

import cv2
import numpy as np
from PIL import Image

import common
import masks
import cleanup

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 75

rgb = common.to_np(common.load_image(SRC))
skin = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin.sum()))
box = common.region_box(skin, int(face_d * 0.25), rgb.shape)
x0, y0, x1, y1 = box
crop = rgb[y0:y1, x0:x1]

conf, region, fc, model = cleanup.confidence(crop, {"strength": STRENGTH})
cheeks = masks.get_mask(rgb, "cheeks")[y0:y1, x0:x1]

overlap = float(conf[cheeks > 0.5].mean()) if (cheeks > 0.5).sum() else 0.0
print(f"mean confidence inside the cheek apples: {overlap:.4f}   (0 = blush untouched)")
print(f"corrected pixels: {int((conf > 0.35).sum())}")

# panel 1: face. panel 2: what it flags. panel 3: cheek zones (must not overlap)
flag = crop.copy().astype(np.float32)
flag[..., 0] = np.minimum(255, flag[..., 0] + conf * 255)
flag[..., 1] *= 1 - conf * 0.6
flag[..., 2] *= 1 - conf * 0.6

zone = crop.copy().astype(np.float32)
zone[..., 2] = np.minimum(255, zone[..., 2] + cheeks * 170)

z = 3
panels = [
    Image.fromarray(np.clip(p, 0, 255).astype(np.uint8)).resize(
        ((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS
    )
    for p in (crop.astype(np.float32), flag, zone)
]
w, h = panels[0].size
combo = Image.new("RGB", (w * 3 + 24, h), (18, 18, 22))
for i, p in enumerate(panels):
    combo.paste(p, (i * (w + 12), 0))
combo.save(f"{OUT_DIR}/60-confidence.jpg", quality=95)
print("-> 60-confidence.jpg  (face | flagged as flaw | cheek zones)")
