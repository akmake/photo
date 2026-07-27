"""Where does the remaining error actually live?

Two more tools, +4 points each. Before proposing a third, find out WHERE the
residual sits — and in particular whether the metric we have been optimising is
even measuring the thing a photographer cares about. Mean dE over the frame
weights every pixel equally, and the girl is a small fraction of it.
"""
import json, os, sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")
import compare, masks as masks_mod, recipe_fit, render as render_mod  # noqa: E402

OUT = os.path.dirname(os.path.abspath(__file__))
B = r"C:\Users\yosef dahan\Downloads\IMG_2034ב.jpg"
A = r"C:\Users\yosef dahan\Downloads\IMG_2034 (1) copy (1).jpg"


def load(p, cap=2000):
    im = Image.open(p).convert("RGB")
    im.thumbnail((cap, cap), Image.LANCZOS)
    return np.asarray(im)


before = recipe_fit._fit_scale(load(B))
after = recipe_fit._fit_scale(load(A))
after, _ = compare.align(before, after)

recipe = json.load(open(os.path.join(OUT, "learned_recipe.json")))
fitted, meta = render_mod.render(Image.fromarray(before), recipe)
fitted = np.asarray(fitted)

tl, fl, bl = (recipe_fit._lab(x) for x in (after, fitted, before))
d_fit = np.sqrt(((fl - tl) ** 2).sum(axis=2))
d_base = np.sqrt(((bl - tl) ** 2).sum(axis=2))

masks_mod.set_source(before)
subj = render_mod._region_mask(before, {"region": "subject", "feather": 4})
masks_mod.clear_source()
bg = 1.0 - subj
s_sel, b_sel = subj > 0.5, bg > 0.5

print(f"frame {before.shape[1]}x{before.shape[0]}   subject = "
      f"{100*s_sel.mean():.1f}% of pixels\n")
print(f"{'region':<12}{'baseline dE':>13}{'fitted dE':>11}{'gap closed':>13}")
print("-" * 50)
for name, sel in (("WHOLE FRAME", np.ones_like(s_sel)), ("subject", s_sel), ("background", b_sel)):
    b_, f_ = float(d_base[sel].mean()), float(d_fit[sel].mean())
    print(f"{name:<12}{b_:>13.2f}{f_:>11.2f}{100*(1-f_/max(b_,1e-6)):>12.1f}%")

print("\nresidual by tone (fitted vs target):")
L = tl[..., 0] / 255.0
for lo, hi, lbl in ((0, .25, "shadows"), (.25, .55, "midtones"), (.55, .8, "lights"), (.8, 1.01, "highlights")):
    m = (L >= lo) & (L < hi)
    if m.sum() > 500:
        print(f"  {lbl:<11} dE {float(d_fit[m].mean()):5.2f}   ({100*m.mean():4.1f}% of frame)")

h = 760
w = int(before.shape[1] * h / before.shape[0])
heat = cv2.applyColorMap(
    np.clip(d_fit / 30.0 * 255, 0, 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
heat = cv2.cvtColor(heat, cv2.COLOR_BGR2RGB)
tiles = [cv2.resize(x, (w, h)) for x in (after, fitted, heat)]
gap = np.full((h, 8, 3), 20, np.uint8)
Image.fromarray(np.concatenate([tiles[0], gap, tiles[1], gap, tiles[2]], axis=1)).save(
    os.path.join(OUT, "residual_map.png"))
print(f"\nwrote {os.path.join(OUT, 'residual_map.png')}  (target | fitted | error heatmap)")
