"""Compare: original | our hand-written cleanup | the learned ABPN model."""

import sys
import time

import numpy as np
from PIL import Image

import common
import masks
import cleanup
import abpn

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
S = float(sys.argv[3]) if len(sys.argv) > 3 else 80

rgb = common.to_np(common.load_image(SRC))

t0 = time.time()
ours, m1 = cleanup.apply(rgb, {"strength": S})
t_ours = time.time() - t0

t0 = time.time()
learned, m2 = abpn.apply(rgb, {"strength": S})
t_abpn = time.time() - t0

print(f"ours    {t_ours:5.1f}s  {m1}")
print(f"abpn    {t_abpn:5.1f}s  {m2}")

skin = masks.get_mask(rgb, "face-skin")
ys, xs = np.where(skin > 0.5)
pad = 70
x0, x1 = max(0, xs.min() - pad), min(rgb.shape[1], xs.max() + pad)
y0, y1 = max(0, ys.min() - pad), min(rgb.shape[0], ys.max() + pad)

z = 3
panels = []
for arr in (rgb, ours, learned):
    p = Image.fromarray(arr[y0:y1, x0:x1])
    panels.append(p.resize((p.width * z, p.height * z), Image.LANCZOS))

w, h = panels[0].size
combo = Image.new("RGB", (w * 3 + 24, h), (18, 18, 22))
for i, p in enumerate(panels):
    combo.paste(p, (i * (w + 12), 0))
combo.save(f"{OUT_DIR}/70-abpn-vs-ours.jpg", quality=96)
print("-> 70-abpn-vs-ours.jpg  (original | ours | ABPN)")
