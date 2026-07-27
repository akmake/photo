"""Learn the grid from one pair, grade the whole folder, prove it transfers.

  bg_gallery.py <folder> <before> <after> <outdir> <tag>
"""
import os, sys, time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")
import bgrid, compare, recipe_fit  # noqa: E402

SRC, BEFORE, AFTER, OUT, TAG = sys.argv[1:6]
SCRATCH = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
STEM = os.path.splitext(os.path.basename(BEFORE))[0]


def load(p, cap=None):
    im = Image.open(p).convert("RGB")
    if cap:
        im.thumbnail((cap, cap), Image.LANCZOS)
    return np.asarray(im)


b = load(BEFORE, 1800)
a, _ = compare.align(b, load(AFTER, 1800))
t0 = time.time()
grid, rep = bgrid.fit(b, a)
np.save(os.path.join(OUT, f"{TAG}.npy"), grid)
print(f"grid {rep['cells']} fitted in {time.time()-t0:.0f}s   "
      f"usesSpace={rep['usesSpace']} ({rep['spatialVariation']})")

lk = lambda x: cv2.GaussianBlur(recipe_fit._lab(x), (0, 0), 2.0)
tgt = lk(recipe_fit._fit_scale(a))
base = recipe_fit._delta_e(lk(recipe_fit._fit_scale(b)), tgt)
got = recipe_fit._delta_e(lk(recipe_fit._fit_scale(bgrid.apply(b, grid))), tgt)
print(f"on the learned pair: {100*(1-got/base):.1f}%\n")


def added_blotch(orig, out):
    H, W = orig.shape[:2]
    p = (int(W * .05), int(H * .05), int(W * .05) + 500, int(H * .05) + 380)

    def mc(i):
        g = cv2.cvtColor(i[p[1]:p[3], p[0]:p[2]], cv2.COLOR_RGB2GRAY).astype(np.float32)
        return float((g - cv2.GaussianBlur(g, (0, 0), 3.0)).std())
    return mc(out) - mc(orig)


others = sorted(f for f in os.listdir(SRC)
                if f.lower().endswith((".jpg", ".jpeg")) and STEM not in f)
thumbs, blotches = [], []
t_all = time.time()
for f in others:
    im = load(os.path.join(SRC, f))
    out = bgrid.apply(im, grid)
    Image.fromarray(out).save(os.path.join(OUT, f), quality=96, subsampling=0)
    blotches.append(added_blotch(im, out))
    h = 300
    w = int(im.shape[1] * h / im.shape[0])
    thumbs.append((cv2.resize(im, (w, h)), cv2.resize(out, (w, h))))
print(f"{len(others)} unseen frames in {time.time()-t_all:.0f}s")
print(f"added micro-contrast across them: mean {np.mean(blotches):+.2f}  "
      f"worst {np.max(blotches):+.2f}   (3D LUT was +1.73 on one frame)")

w, h = thumbs[0][0].shape[1], thumbs[0][0].shape[0]
cols = 4
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (w + 6), rows * (2 * h + 14)), (20, 20, 22))
for i, (bt, at) in enumerate(thumbs):
    x, y = (i % cols) * (w + 6), (i // cols) * (2 * h + 14)
    sheet.paste(Image.fromarray(bt), (x, y))
    sheet.paste(Image.fromarray(at), (x, y + h + 4))
sheet.save(os.path.join(SCRATCH, f"bg_{TAG}_sheet.png"))
print(f"wrote bg_{TAG}_sheet.png  ·  full size in {OUT}")
