"""Tight zoom: original vs ABPN, on the lower face where the marks are."""

import sys

import numpy as np
from PIL import Image

import common
import masks
import abpn

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
S = float(sys.argv[3]) if len(sys.argv) > 3 else 80

rgb = common.to_np(common.load_image(SRC))
out, meta = abpn.apply(rgb, {"strength": S})
print(meta)

skin = masks.get_mask(rgb, "face-skin")
ys, xs = np.where(skin > 0.5)
fx0, fy0, fx1, fy1 = xs.min(), ys.min(), xs.max(), ys.max()
fw, fh = fx1 - fx0, fy1 - fy0
x0 = max(0, fx0 - int(fw * 0.08))
x1 = min(rgb.shape[1], fx1 + int(fw * 0.08))
y0 = fy0 + int(fh * 0.40)
y1 = min(rgb.shape[0], fy1 + int(fh * 0.10))

z = 5
a = Image.fromarray(rgb[y0:y1, x0:x1])
b = Image.fromarray(out[y0:y1, x0:x1])
size = (a.width * z, a.height * z)
a, b = a.resize(size, Image.LANCZOS), b.resize(size, Image.LANCZOS)
combo = Image.new("RGB", (size[0] * 2 + 16, size[1]), (18, 18, 22))
combo.paste(a, (0, 0))
combo.paste(b, (size[0] + 16, 0))
combo.save(f"{OUT_DIR}/71-abpn-zoom.jpg", quality=97)
print("-> 71-abpn-zoom.jpg  (left=original, right=ABPN)")
