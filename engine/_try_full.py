"""Run the FULL AI chain on a real photo and build a zoomed before/after."""

import sys
import time

import numpy as np
from PIL import Image

import common
import masks
import cleanup
import skin
import background

SRC, OUT_DIR = sys.argv[1], sys.argv[2]

img = Image.open(SRC).convert("RGB")
print("size:", img.size)
before = img.copy()

b64 = common.image_to_b64(img)

chain = [
    ("skin-cleanup", cleanup.process, {"strength": 70}),
    ("skin", skin.process, {"strength": 55}),
    ("background-blur", background.process, {"amount": 70, "feather": 40}),
]
for name, fn, params in chain:
    t0 = time.time()
    b64, meta = fn(b64, params)
    print(f"{name:16s} {meta}  ({(time.time()-t0)*1000:.0f}ms)")

after = common.b64_to_image(b64)
after.save(f"{OUT_DIR}/04-full-retouch.jpg", quality=95)

# ---- zoomed face comparison (faces are small in the frame) ----
rgb = common.to_np(before)
face = masks.get_mask(rgb, "face-skin") > 0.5
ys, xs = np.where(face)
if len(xs):
    pad_x = int((xs.max() - xs.min()) * 0.35)
    pad_y = int((ys.max() - ys.min()) * 0.35)
    box = (
        max(0, xs.min() - pad_x),
        max(0, ys.min() - pad_y),
        min(rgb.shape[1], xs.max() + pad_x),
        min(rgb.shape[0], ys.max() + pad_y),
    )
    ca, cb = before.crop(box), after.crop(box)
    z = 3
    size = (ca.width * z, ca.height * z)
    ca, cb = ca.resize(size, Image.LANCZOS), cb.resize(size, Image.LANCZOS)
    combo = Image.new("RGB", (size[0] * 2 + 12, size[1]), (20, 20, 24))
    combo.paste(ca, (0, 0))
    combo.paste(cb, (size[0] + 12, 0))
    combo.save(f"{OUT_DIR}/05-face-before-after.jpg", quality=95)
    print("face crop:", box, "-> 05-face-before-after.jpg (left=before, right=after)")
else:
    print("no face found for crop")
