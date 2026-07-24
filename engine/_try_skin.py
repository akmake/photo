"""Sanity-check the frequency-separation skin tool on an enlarged face crop.

Upscaling does not create real pores, so this proves the algorithm behaves
(evens tone, keeps features) — it is NOT a substitute for a full-res original.
"""

import sys
import time

import numpy as np
from PIL import Image

import common
import masks
import skin

SRC, OUT_DIR = sys.argv[1], sys.argv[2]

img = common.load_image(SRC)
rgb = common.to_np(img)
face = masks.get_mask(rgb, "face-skin") > 0.5
ys, xs = np.where(face)
pad = int((xs.max() - xs.min()) * 0.4)
box = (
    max(0, xs.min() - pad),
    max(0, ys.min() - pad),
    min(rgb.shape[1], xs.max() + pad),
    min(rgb.shape[0], ys.max() + pad),
)
crop = img.crop(box)
crop = crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS)
print("enlarged face crop:", crop.size)

t0 = time.time()
out_b64, meta = skin.process(common.image_to_b64(crop), {"strength": 70})
print(f"skin: {meta}  ({(time.time()-t0)*1000:.0f}ms)")

after = common.b64_to_image(out_b64)
combo = Image.new("RGB", (crop.width * 2 + 12, crop.height), (20, 20, 24))
combo.paste(crop, (0, 0))
combo.paste(after, (crop.width + 12, 0))
combo.save(f"{OUT_DIR}/30-skin-before-after.jpg", quality=95)
print("saved 30-skin-before-after.jpg (left=before, right=after)")
