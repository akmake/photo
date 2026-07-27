"""Is the marbling present here, and does a finer lattice remove it?

Judged at 100% on a smooth out-of-focus area — the only place the artefact
ever showed. A thumbnail cannot answer this question either way.
"""
import os, sys, time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")
import compare, lut as lutmod, recipe_fit  # noqa: E402

SRC = r"C:\Users\yosef dahan\Downloads\jm__yg0J2rjsE-dhAL"
BEFORE = os.path.join(SRC, "321A5290.JPG")
AFTER = os.path.join(SRC, "321A5290 (1).JPG")
OUT = os.path.dirname(os.path.abspath(__file__))


def load(p, cap=None):
    im = Image.open(p).convert("RGB")
    if cap:
        im.thumbnail((cap, cap), Image.LANCZOS)
    return np.asarray(im)


b = load(BEFORE, 1800)
a, _ = compare.align(b, load(AFTER, 1800))
lk = lambda x: cv2.GaussianBlur(recipe_fit._lab(x), (0, 0), 2.0)
tgt = lk(recipe_fit._fit_scale(a))
base = recipe_fit._delta_e(lk(recipe_fit._fit_scale(b)), tgt)

full = load(BEFORE)
# a smooth bokeh patch, upper background, well away from any subject
H, W = full.shape[:2]
x0, y0 = int(W * 0.34), int(H * 0.02)
patch = (x0, y0, x0 + 900, y0 + 620)
print(f"inspection patch {patch}  (smooth bokeh, upper background)\n")

tiles = [full[patch[1]:patch[3], patch[0]:patch[2]]]
labels = ["original"]

for size, sm in ((33,0.35),(33,1.2),(33,3.0),(17,1.2)):
    t0 = time.time()
    lut, rep = lutmod.fit(b, a, size=size, smooth=sm, monotone=False)
    p = os.path.join(OUT, f"grid{size}_{sm}.cube")
    lutmod.write_cube(lut, p, f"grid{size}")
    got = recipe_fit._delta_e(lk(recipe_fit._fit_scale(lutmod.apply_cube(b, p))), tgt)

    out_full = lutmod.apply_cube(full, p)
    tiles.append(out_full[patch[1]:patch[3], patch[0]:patch[2]])
    labels.append(f"{size}^3 sm{sm}")

    # banding proxy: how much energy sits in tiny steps in a smooth area
    g = cv2.cvtColor(tiles[-1], cv2.COLOR_RGB2GRAY).astype(np.float32)
    hf = g - cv2.GaussianBlur(g, (0, 0), 3.0)
    print(f"  {size}^3   closed {100*(1-got/base):5.1f}%   fit {time.time()-t0:5.1f}s   "
          f"cov {rep['cubeCoverage']:.3f}   bokeh micro-contrast {hf.std():5.2f}")

g0 = cv2.cvtColor(tiles[0], cv2.COLOR_RGB2GRAY).astype(np.float32)
hf0 = g0 - cv2.GaussianBlur(g0, (0, 0), 3.0)
print(f"  original                                       "
      f"           micro-contrast in bokeh {hf0.std():5.2f}")
print("  (a LUT should not ADD micro-contrast to a smooth area; if it does, that is the marbling)")

h = 620
sheet = Image.new("RGB", (900 * len(tiles) + 20 * (len(tiles) - 1), h), (18, 18, 20))
for i, t in enumerate(tiles):
    sheet.paste(Image.fromarray(t), (i * 920, 0))
sheet.save(os.path.join(OUT, "marble_check.png"))
print(f"\nwrote marble_check.png  ({' | '.join(labels)}) at 100%")
