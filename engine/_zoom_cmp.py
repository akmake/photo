"""Tight zoomed before/after on the lower face, where the marks actually are."""

import sys

import numpy as np
from PIL import Image

import common
import masks
import cleanup

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 90

rgb = common.to_np(common.load_image(SRC))
out, meta = cleanup.apply(rgb, {"strength": STRENGTH})
print(meta)

s = masks.get_mask(rgb, "face-skin")
ys, xs = np.where(s > 0.5)
fx0, fy0, fx1, fy1 = xs.min(), ys.min(), xs.max(), ys.max()
fw, fh = fx1 - fx0, fy1 - fy0

# lower half of the face: nose, mouth, chin — where the marks are
x0 = max(0, fx0 - int(fw * 0.10))
x1 = min(rgb.shape[1], fx1 + int(fw * 0.10))
y0 = fy0 + int(fh * 0.42)
y1 = min(rgb.shape[0], fy1 + int(fh * 0.12))

b = Image.fromarray(rgb[y0:y1, x0:x1])
a = Image.fromarray(out[y0:y1, x0:x1])
z = 5
size = (b.width * z, b.height * z)
b = b.resize(size, Image.LANCZOS)
a = a.resize(size, Image.LANCZOS)

combo = Image.new("RGB", (size[0] * 2 + 16, size[1]), (18, 18, 22))
combo.paste(b, (0, 0))
combo.paste(a, (size[0] + 16, 0))
combo.save(f"{OUT_DIR}/52-mouth-zoom.jpg", quality=97)
print("-> 52-mouth-zoom.jpg  (left=before, right=after)")
