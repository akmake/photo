"""Learn a LUT from the real pair, apply it, and score it against everything
we tried today."""
import os, sys, time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")
import compare, lut as lutmod, recipe_fit  # noqa: E402

B = r"C:\Users\yosef dahan\Downloads\IMG_2034ב.jpg"
A = r"C:\Users\yosef dahan\Downloads\IMG_2034 (1) copy (1).jpg"
OUT = os.path.dirname(os.path.abspath(__file__))
CUBE = os.path.join(OUT, "learned.cube")
DEST = r"C:\Users\yosef dahan\Downloads\IMG_2034_lut.jpg"


def load(p, cap=None):
    im = Image.open(p).convert("RGB")
    if cap:
        im.thumbnail((cap, cap), Image.LANCZOS)
    return np.asarray(im)


before = load(B, 1800)
after, geom = compare.align(before, load(A, 1800))
print(f"pair {before.shape[1]}x{before.shape[0]}, aligned via {geom['method']}")

t0 = time.time()
lut, rep = lutmod.fit(before, after)
print(f"\nfitted in {time.time()-t0:.1f}s")
for k, v in rep.items():
    print(f"   {k:<16} {v}")

lutmod.write_cube(lut, CUBE, "poppy field")
print(f"\nwrote {CUBE}  ({os.path.getsize(CUBE)/1024:.0f} KB)")

# ---- apply, and time it on a real full-size frame --------------------------
full = load(B)
t0 = time.time()
ours_full = lutmod.apply_cube(full, CUBE)
dt = time.time() - t0
mp = full.shape[0] * full.shape[1] / 1e6
print(f"applied to {full.shape[1]}x{full.shape[0]} ({mp:.1f} MP) in {dt*1000:.0f} ms"
      f"   -> {dt*200/60:.1f} min for 200 images")
Image.fromarray(ours_full).save(DEST, quality=97, subsampling=0)
print(f"wrote {DEST}")

# ---- score with the same registration-robust metric ------------------------
b = recipe_fit._fit_scale(before)
a = recipe_fit._fit_scale(after)
o = recipe_fit._fit_scale(lutmod.apply_cube(before, CUBE))
lk = lambda x: cv2.GaussianBlur(recipe_fit._lab(x), (0, 0), 2.0)
base = recipe_fit._delta_e(lk(b), lk(a))
got = recipe_fit._delta_e(lk(o), lk(a))
print(f"\nLOOK  baseline {base:.2f}  ->  LUT {got:.2f}   gap closed {100*(1-got/base):.1f}%")
print("  for comparison, today's parametric attempts reached:")
print("    47.6% base tools | 51.9% +HSL | 55.6% +masks | 59.0% +texture | -9.1% derived")

# ---- protected colours -----------------------------------------------------
import masks as masks_mod  # noqa: E402
masks_mod.set_source(before)
sel = {n: masks_mod.get_mask(before, n) > 0.5 for n in ("face-skin", "hair")}
masks_mod.clear_source()
ours_small = lutmod.apply_cube(before, CUBE)
print("\nprotected colours (target from your edit -> what the LUT produced):")
for n, m in sel.items():
    if m.sum() < 300:
        continue
    def st(img):
        lab = recipe_fit._lab(img)
        return (float(np.hypot(lab[..., 1][m] - 128, lab[..., 2][m] - 128).mean()),
                float(lab[..., 0][m].mean()))
    cb, lb = st(before); ca, la = st(after); co, lo = st(ours_small)
    print(f"   {n:<10} chroma {cb:5.1f} -> target {ca:5.1f} / got {co:5.1f}"
          f"    L {lb:5.1f} -> target {la:5.1f} / got {lo:5.1f}")

# ---- sheets ----------------------------------------------------------------
def sheet(tiles, path, h):
    tiles = [Image.fromarray(t) if isinstance(t, np.ndarray) else t for t in tiles]
    w = int(tiles[0].width * h / tiles[0].height)
    tiles = [t.resize((w, h), Image.LANCZOS) for t in tiles]
    s = Image.new("RGB", (w * 3 + 20, h), (18, 18, 20))
    for i, t in enumerate(tiles):
        s.paste(t, (i * (w + 10), 0))
    s.save(path)
    print("wrote", os.path.basename(path))


ref_full = load(A)
ref_full = np.asarray(Image.fromarray(ref_full).resize(
    (full.shape[1], full.shape[0]), Image.LANCZOS))
sheet([full, ours_full, ref_full], os.path.join(OUT, "lut_full.png"), 800)
crop = (294, 297, 3379, 3537)
sheet([Image.fromarray(x).crop(crop) for x in (full, ours_full, ref_full)],
      os.path.join(OUT, "lut_face.png"), 740)
