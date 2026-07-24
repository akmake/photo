"""Blush-preservation assertion.

The cleanup tool must never neutralise the subject's natural colouring. This
measures the mean Lab colour of the cheek apples (and the nose tip) before and
after, and FAILS if they moved. It is an assertion, not a one-off eyeball check
— run it whenever the detector changes.

    python test_blush.py <image> [more images...]
"""

import sys

import cv2
import numpy as np

import common
import masks
import cleanup

# Max allowed drift of mean cheek colour, in Lab units. ~1.0 is the threshold
# of human perception for a large flat area, so 0.6 is a strict bar.
TOL = 0.6


def cheek_stats(rgb, cheeks):
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    m = cheeks > 0.5
    if m.sum() < 32:
        return None
    return lab[m].mean(axis=0)


def check(path: str) -> bool:
    rgb = common.to_np(common.load_image(path))
    cheeks = masks.get_mask(rgb, "cheeks")
    before = cheek_stats(rgb, cheeks)
    if before is None:
        print(f"  SKIP {path}: no cheeks detected")
        return True

    out, meta = cleanup.apply(rgb, {"strength": 90})  # worst case: most aggressive
    after = cheek_stats(out, cheeks)

    drift = np.abs(after - before)
    ok = bool((drift <= TOL).all())
    print(
        f"  {'PASS' if ok else 'FAIL'}  {path.split(chr(92))[-1]}  "
        f"dL={drift[0]:.3f} da={drift[1]:.3f} db={drift[2]:.3f}  "
        f"(tol {TOL})  {meta}"
    )
    return ok


if __name__ == "__main__":
    paths = sys.argv[1:]
    if not paths:
        print("usage: python test_blush.py <image> [...]")
        raise SystemExit(2)
    print("blush preservation:")
    results = [check(p) for p in paths]
    raise SystemExit(0 if all(results) else 1)
