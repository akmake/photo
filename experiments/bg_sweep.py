"""Tune the grid on the hard gallery, then check it did not cost anything on
the easy one. A setting that only helps the case it was tuned on is worthless."""
import importlib, os, sys, time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")
import bgrid, compare, recipe_fit  # noqa: E402

OUT = os.path.dirname(os.path.abspath(__file__))
HARD = (r"C:\Users\yosef dahan\Downloads\22\321A5208.JPG",
        r"C:\Users\yosef dahan\Downloads\22\321A5208 (1).JPG", "haze")
EASY = (r"C:\Users\yosef dahan\Downloads\jm__yg0J2rjsE-dhAL\321A5290.JPG",
        r"C:\Users\yosef dahan\Downloads\jm__yg0J2rjsE-dhAL\321A5290 (1).JPG", "olive")


def load(p, cap=None):
    im = Image.open(p).convert("RGB")
    if cap:
        im.thumbnail((cap, cap), Image.LANCZOS)
    return np.asarray(im)


def pair(spec, cap=1500):
    b = load(spec[0], cap)
    a, _ = compare.align(b, load(spec[1], cap))
    return b, a


lk = lambda x: cv2.GaussianBlur(recipe_fit._lab(x), (0, 0), 2.0)


def score(b, a, grid):
    tgt = lk(recipe_fit._fit_scale(a))
    base = recipe_fit._delta_e(lk(recipe_fit._fit_scale(b)), tgt)
    got = recipe_fit._delta_e(lk(recipe_fit._fit_scale(bgrid.apply(b, grid))), tgt)
    return 100 * (1 - got / base)


def blotch(b, grid, frac=0.05):
    H, W = b.shape[:2]
    x0, y0 = int(W * frac), int(H * frac)
    p = (x0, y0, min(W, x0 + 500), min(H, y0 + 380))

    def mc(img):
        g = cv2.cvtColor(img[p[1]:p[3], p[0]:p[2]], cv2.COLOR_RGB2GRAY).astype(np.float32)
        return float((g - cv2.GaussianBlur(g, (0, 0), 3.0)).std())
    return mc(bgrid.apply(b, grid)) - mc(b)


hb, ha = pair(HARD)
eb, ea = pair(EASY)
print("  SX  SL  Lspace |   haze%   blotch |  olive%   blotch |  fit")
print("  " + "-" * 62)

CONFIGS = [
    (16, 8, 6.0), (16, 16, 6.0), (16, 16, 2.5),
    (24, 16, 4.0), (32, 16, 4.0), (32, 24, 2.0),
]
best = None
for sx, sl, ls in CONFIGS:
    bgrid.SX = bgrid.SY = sx
    bgrid.SL = sl
    bgrid.LAMBDA_SPACE = ls
    t0 = time.time()
    gh, _ = bgrid.fit(hb, ha)
    ge, _ = bgrid.fit(eb, ea)
    sh, se = score(hb, ha, gh), score(eb, ea, ge)
    bh, be = blotch(hb, gh), blotch(eb, ge)
    print(f"  {sx:>3} {sl:>3} {ls:>6.1f} | {sh:6.1f}% {bh:+7.2f} | {se:6.1f}% {be:+7.2f} | {time.time()-t0:4.0f}s")
    combined = sh + se - 12 * max(0, bh) - 12 * max(0, be)
    if best is None or combined > best[0]:
        best = (combined, sx, sl, ls, sh, se)

print(f"\nbest: {best[1]}x{best[1]}x{best[2]}  Lspace {best[3]}"
      f"   haze {best[4]:.1f}%   olive {best[5]:.1f}%")
print("  (3D LUT reference: haze 63.0% and unusable, olive 83.3%)")
