"""Does the preserve-first thesis hold on this pair?

For every selector we could express a rule in — semantic regions, hue bands,
tonal zones — measure how far the colour inside it actually moved between
before and after, against the noise floor of the pair itself.

If skin, hair and the reds come back inside the noise while the greens collapse,
the edit really is "protect everything, attack one thing" and the fitter should
be constrained accordingly. If they all moved, the thesis is wrong and the plan
changes.

Everything is measured in a way that would transfer to another photo: no pixel
coordinates, only selectors that get re-evaluated per frame.
"""
import os, sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")
import compare, masks as masks_mod, render as render_mod  # noqa: E402

B = r"C:\Users\yosef dahan\Downloads\IMG_2034ב.jpg"
A = r"C:\Users\yosef dahan\Downloads\IMG_2034 (1) copy (1).jpg"
CAP = 1600


def load(p):
    im = Image.open(p).convert("RGB")
    im.thumbnail((CAP, CAP), Image.LANCZOS)
    return np.asarray(im)


before = load(B)
after, geom = compare.align(before, load(A))
print(f"frame {before.shape[1]}x{before.shape[0]}   aligned via {geom['method']}\n")

lab_b = cv2.cvtColor(before, cv2.COLOR_RGB2LAB).astype(np.float32)
lab_a = cv2.cvtColor(after, cv2.COLOR_RGB2LAB).astype(np.float32)

# Blur both: a sub-pixel offset in dense foliage would otherwise read as a huge
# colour change. We are asking "did this colour move", not "did this pixel move".
sb = cv2.GaussianBlur(lab_b, (0, 0), 3.0)
sa = cv2.GaussianBlur(lab_a, (0, 0), 3.0)

# Noise floor: the flattest areas of the frame moved by this much for reasons
# that are not editing. Anything at or under it counts as untouched.
d_all = np.sqrt(((sa - sb) ** 2).sum(axis=2))
noise = float(np.percentile(d_all, 5))
print(f"noise floor (5th pct of all deltas): {noise:.2f} dE")
print(f"whole-frame median delta:            {float(np.median(d_all)):.2f} dE\n")

hsv_b = cv2.cvtColor(before, cv2.COLOR_RGB2HSV_FULL)
hue = hsv_b[..., 0].astype(np.float32) * (360.0 / 255.0)
sat = hsv_b[..., 1].astype(np.float32) / 255.0

masks_mod.set_source(before)
sel = {}
for name, kind in (("subject", "subject"), ("face-skin", "face-skin"),
                   ("hair", "hair"), ("body-skin", "body-skin")):
    try:
        sel[name] = masks_mod.get_mask(before, kind) > 0.5
    except Exception as e:
        print(f"  ({name} unavailable: {e})")
sel["background"] = ~sel.get("subject", np.zeros(before.shape[:2], bool))
masks_mod.clear_source()

chromatic = sat > 0.18
for name, lo, hi in (("hue: red", 345, 15), ("hue: orange", 15, 45),
                     ("hue: yellow", 45, 75), ("hue: green", 75, 165),
                     ("hue: blue", 165, 260)):
    m = ((hue >= lo) | (hue < hi)) if lo > hi else ((hue >= lo) & (hue < hi))
    sel[name] = m & chromatic

L = lab_b[..., 0] / 255.0
for name, lo, hi in (("tone: shadows", 0, .3), ("tone: mid", .3, .65),
                     ("tone: high", .65, 1.01)):
    sel[name] = (L >= lo) & (L < hi)

print(f"{'selector':<16}{'% frame':>9}{'dE':>8}{'chroma':>9}{'L shift':>9}   verdict")
print("-" * 68)
rows = []
for name, m in sel.items():
    if m.sum() < 400:
        continue
    de = float(d_all[m].mean())
    cb = float(np.hypot(sb[..., 1][m] - 128, sb[..., 2][m] - 128).mean())
    ca = float(np.hypot(sa[..., 1][m] - 128, sa[..., 2][m] - 128).mean())
    ratio = ca / max(cb, 1e-6)
    dl = float((sa[..., 0][m] - sb[..., 0][m]).mean())
    if de <= noise * 1.6:
        v = "PRESERVED"
    elif de <= noise * 3.0:
        v = "light touch"
    else:
        v = "CHANGED"
    rows.append((name, 100 * m.mean(), de, ratio, dl, v))

for name, pct, de, ratio, dl, v in rows:
    print(f"{name:<16}{pct:>8.1f}%{de:>8.1f}{ratio:>8.2f}x{dl:>+9.1f}   {v}")

print("\nranked by how much each selector moved:")
for name, pct, de, ratio, dl, v in sorted(rows, key=lambda r: -r[2])[:6]:
    print(f"   {name:<16} dE {de:5.1f}   chroma x{ratio:.2f}")
