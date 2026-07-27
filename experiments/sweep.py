"""Displacement-field LUT, swept over lattice size, on the gallery that broke.

Two numbers matter and they pull against each other:
  closed          how much of the edit is reproduced
  added-blotch    micro-contrast the LUT ADDS to a smooth area that had none
"""
import os, sys, time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")
import compare, lut as lutmod, recipe_fit  # noqa: E402

SRC = r"C:\Users\yosef dahan\Downloads\22"
BEFORE = os.path.join(SRC, "321A5208.JPG")
AFTER = os.path.join(SRC, "321A5208 (1).JPG")
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
H, W = full.shape[:2]
# smooth foliage, upper left — the area that fell apart
px = (int(W * 0.05), int(H * 0.05), int(W * 0.05) + 900, int(H * 0.05) + 620)


def blotch(img):
    g = cv2.cvtColor(img[px[1]:px[3], px[0]:px[2]], cv2.COLOR_RGB2GRAY).astype(np.float32)
    return float((g - cv2.GaussianBlur(g, (0, 0), 3.0)).std())


ref_blotch = blotch(full)
tiles = [full[px[1]:px[3], px[0]:px[2]]]
print(f"original micro-contrast in that patch: {ref_blotch:.2f}\n")
print("  size   closed    added-blotch   fit")
print("  " + "-" * 44)

best = None
for size in (9, 13, 17, 25, 33):
    t0 = time.time()
    lut, rep = lutmod.fit(b, a, size=size, monotone=False)
    p = os.path.join(OUT, f"d{size}.cube")
    lutmod.write_cube(lut, p, f"d{size}")
    got = recipe_fit._delta_e(lk(recipe_fit._fit_scale(lutmod.apply_cube(b, p))), tgt)
    out_full = lutmod.apply_cube(full, p)
    bl = blotch(out_full) - ref_blotch
    closed = 100 * (1 - got / base)
    print(f"  {size:>3}^3  {closed:6.1f}%   {bl:+8.2f}      {time.time()-t0:4.0f}s")
    tiles.append(out_full[px[1]:px[3], px[0]:px[2]])
    if best is None or (bl < 0.35 and closed > best[1]):
        best = (size, closed, p)

print(f"\npicked {best[0]}^3 at {best[1]:.1f}% closed")

h = 620
sheet = Image.new("RGB", (900 * len(tiles) + 14 * (len(tiles) - 1), h), (18, 18, 20))
for i, t in enumerate(tiles):
    sheet.paste(Image.fromarray(t), (i * 914, 0))
sheet.save(os.path.join(OUT, "sweep_patch.png"))

out = lutmod.apply_cube(full, best[2])
Image.fromarray(out).save(os.path.join(OUT, "sweep_best.jpg"), quality=94)
ref = np.asarray(Image.open(AFTER).convert("RGB").resize((W, H), Image.LANCZOS))
hh = 700
ww = int(W * hh / H)
s = Image.new("RGB", (ww * 3 + 20, hh), (18, 18, 20))
for i, t in enumerate((full, out, ref)):
    s.paste(Image.fromarray(t).resize((ww, hh), Image.LANCZOS), (i * (ww + 10), 0))
s.save(os.path.join(OUT, "sweep_full.png"))
print("wrote sweep_patch.png (100% crops) and sweep_full.png (orig | ours | yours)")
