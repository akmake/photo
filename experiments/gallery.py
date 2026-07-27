"""Learn from one pair, grade the rest of the folder. Reusable across shoots.

  gallery.py <folder> <before.jpg> <after.jpg> <outdir> [tag]
"""
import os, sys, time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")
import compare, lut as lutmod, recipe_fit  # noqa: E402

SRC, BEFORE, AFTER, OUT = sys.argv[1:5]
TAG = sys.argv[5] if len(sys.argv) > 5 else "look"
SCRATCH = os.path.dirname(os.path.abspath(__file__))
CUBE = os.path.join(OUT, f"{TAG}.cube")
os.makedirs(OUT, exist_ok=True)

# the two frames of the learned pair must not be graded as if they were new
STEM = os.path.splitext(os.path.basename(BEFORE))[0]


def load(p, cap=None):
    im = Image.open(p).convert("RGB")
    if cap:
        im.thumbnail((cap, cap), Image.LANCZOS)
    return np.asarray(im)


b = load(BEFORE, 1800)
a, geom = compare.align(b, load(AFTER, 1800))
print(f"pair aligned via {geom['method']}  scale {geom.get('scale')} shift {geom.get('shift')}")

t0 = time.time()
lut, rep = lutmod.fit(b, a, monotone=False)
lutmod.write_cube(lut, CUBE, TAG)
print(f"\nLUT fitted in {time.time()-t0:.0f}s")
for k in ("cubeCoverage", "residualMean", "cellSpread95", "colourOnly"):
    print(f"   {k:<16} {rep[k]}")

# the gate: say up front whether this edit is something a colour LUT can carry
s95 = rep["cellSpread95"]
verdict = ("colour-only — a LUT should reproduce this closely" if s95 < 35 else
           "borderline — expect a good but not exact match" if s95 < 50 else
           "NOT colour-only — this edit contains something a LUT cannot express")
print(f"   verdict          {verdict}")

lk = lambda x: cv2.GaussianBlur(recipe_fit._lab(x), (0, 0), 2.0)
tgt = lk(recipe_fit._fit_scale(a))
base = recipe_fit._delta_e(lk(recipe_fit._fit_scale(b)), tgt)
got = recipe_fit._delta_e(lk(recipe_fit._fit_scale(lutmod.apply_cube(b, CUBE))), tgt)
print(f"\nON THE LEARNED PAIR  {base:.2f} -> {got:.2f}   gap closed {100*(1-got/base):.1f}%")

others = sorted(f for f in os.listdir(SRC)
                if f.lower().endswith((".jpg", ".jpeg")) and STEM not in f)
print(f"\ngrading {len(others)} unseen frames:")
thumbs = []
t_all = time.time()
for f in others:
    im = load(os.path.join(SRC, f))
    out = lutmod.apply_cube(im, CUBE)
    Image.fromarray(out).save(os.path.join(OUT, f), quality=97, subsampling=0)
    h = 300
    w = int(im.shape[1] * h / im.shape[0])
    thumbs.append((cv2.resize(im, (w, h)), cv2.resize(out, (w, h))))
print(f"   {len(others)} frames in {time.time()-t_all:.0f}s")

w, h = thumbs[0][0].shape[1], thumbs[0][0].shape[0]
cols = 4
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (w + 6), rows * (2 * h + 14)), (20, 20, 22))
for i, (bt, at) in enumerate(thumbs):
    x, y = (i % cols) * (w + 6), (i // cols) * (2 * h + 14)
    sheet.paste(Image.fromarray(bt), (x, y))
    sheet.paste(Image.fromarray(at), (x, y + h + 4))
sheet.save(os.path.join(SCRATCH, f"{TAG}_sheet.png"))
print(f"wrote {TAG}_sheet.png  ·  full size in {OUT}")
