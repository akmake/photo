"""Choose the grid by whether it TRANSFERS, not by how well it fits.

The previous sweep picked 32x32x24 because that scored best on the frame it was
fitted to. Applied to the rest of the gallery it produced purple paths and green
faces: at that resolution a cell is small enough to memorise that "this spot is
dirt in haze", and in the next photograph that spot is a dress.

So the selection criterion changes. The frame is split into vertical strips;
the grid is fitted on some strips and scored on the strips it never saw. A grid
that has learned a real, smooth gradient extrapolates into the held-out strips.
One that memorised the composition does not — which is precisely the failure we
need to detect before it reaches 200 photographs.
"""
import os, sys, time

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")
import bgrid, compare  # noqa: E402

PAIRS = [
    (r"C:\Users\yosef dahan\Downloads\22\321A5208.JPG",
     r"C:\Users\yosef dahan\Downloads\22\321A5208 (1).JPG", "haze"),
    (r"C:\Users\yosef dahan\Downloads\jm__yg0J2rjsE-dhAL\321A5290.JPG",
     r"C:\Users\yosef dahan\Downloads\jm__yg0J2rjsE-dhAL\321A5290 (1).JPG", "olive"),
]


def load(p, cap):
    im = Image.open(p).convert("RGB")
    im.thumbnail((cap, cap), Image.LANCZOS)
    return np.asarray(im)


def prep(spec, cap=1200):
    b = load(spec[0], cap)
    a, _ = compare.align(b, load(spec[1], cap))
    return b, a


data = [(prep(s), s[2]) for s in PAIRS]

STRIPS = 6  # fit on 4 of 6 vertical strips, score on the 2 held out


def evaluate(sx, sl, lspace):
    bgrid.SX = bgrid.SY = sx
    bgrid.SL = sl
    bgrid.LAMBDA_SPACE = lspace
    out = {}
    for (b, a), tag in data:
        h, w = b.shape[:2]
        col = (np.arange(w) * STRIPS // w)
        held = np.isin(col, [1, 4])            # two interior strips, never seen
        train_mask = np.repeat(~held[None, :], h, axis=0)

        bb = b.copy()
        aa = a.copy()
        # fit on the training strips only
        tb = bb[:, ~held]
        ta = aa[:, ~held]
        grid, _ = bgrid.fit(tb, ta)

        full = bgrid.apply(bb, grid).astype(np.float32)
        tgt = aa.astype(np.float32)
        src = bb.astype(np.float32)

        def err(sel):
            return float(np.abs(full[:, sel] - tgt[:, sel]).mean())

        def base(sel):
            return float(np.abs(src[:, sel] - tgt[:, sel]).mean())

        seen = 100 * (1 - err(~held) / base(~held))
        unseen = 100 * (1 - err(held) / base(held))
        out[tag] = (seen, unseen)
    return out


print(f"  grid            haze seen/unseen      olive seen/unseen     gap")
print("  " + "-" * 66)
best = None
for sx, sl, ls in ((4, 16, 8.0), (6, 16, 6.0), (8, 16, 4.0),
                   (12, 16, 3.0), (16, 16, 2.5), (32, 24, 2.0)):
    t0 = time.time()
    r = evaluate(sx, sl, ls)
    hs, hu = r["haze"]
    os_, ou = r["olive"]
    gap = (hs - hu) + (os_ - ou)          # how much worse it is where it never looked
    mark = ""
    if best is None or (hu + ou) > best[0]:
        best = (hu + ou, sx, sl, ls)
        mark = "  <-"
    print(f"  {sx:>2}x{sx:<2} L{sl:<3} s{ls:<4} "
          f"{hs:6.1f}% /{hu:6.1f}%      {os_:6.1f}% /{ou:6.1f}%   {gap:5.1f}{mark}")

print(f"\nbest by HELD-OUT score: {best[1]}x{best[1]}x{best[2]}  Lspace {best[3]}")
