"""Visual check for the cleanup tool: original | detected | healed, zoomed."""

import sys

import cv2
import numpy as np
from PIL import Image

import common
import masks
import cleanup

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 70

rgb = common.to_np(common.load_image(SRC))
before = rgb.copy()

out, meta = cleanup.apply(rgb, {"strength": STRENGTH})
print(f"strength={STRENGTH}  {meta}")

diff = np.abs(out.astype(np.int16) - before.astype(np.int16)).max(axis=2)
print(f"changed pixels: {int((diff > 3).sum())}")

# crop to the face
s = masks.get_mask(before, "face-skin")
ys, xs = np.where(s > 0.5)
pad = 60
x0, x1 = max(0, xs.min() - pad), min(before.shape[1], xs.max() + pad)
y0, y1 = max(0, ys.min() - pad), min(before.shape[0], ys.max() + pad)

b = before[y0:y1, x0:x1]
a = out[y0:y1, x0:x1]
d = diff[y0:y1, x0:x1]

marked = b.copy()
marked[d > 3] = [255, 0, 0]

z = 3
panels = [
    Image.fromarray(p).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS)
    for p in (b, marked, a)
]
w, h = panels[0].size
combo = Image.new("RGB", (w * 3 + 24, h), (18, 18, 22))
for i, p in enumerate(panels):
    combo.paste(p, (i * (w + 12), 0))
combo.save(f"{OUT_DIR}/51-cleanup-check.jpg", quality=96)
print("-> 51-cleanup-check.jpg  (original | detected | healed)")
