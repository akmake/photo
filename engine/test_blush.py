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

import abpn
import common
import masks
import cleanup

TOOLS = {"cleanup": cleanup.apply, "abpn": abpn.apply}

# Max allowed drift of mean cheek colour, in Lab units. ~1.0 is the threshold
# of human perception for a large flat area, so 0.6 is a strict bar.
TOL = 0.6


def cheek_stats(rgb, cheeks):
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    m = cheeks > 0.5
    if m.sum() < 32:
        return None
    return lab[m].mean(axis=0)


def clean_cheeks(rgb, cheeks):
    """The cheek apple MINUS whatever is actually a mark on it.

    The assertion assumed a cheek apple is essentially clean skin, so any drift
    in its mean colour had to be blush being ironed flat. That assumption fails
    exactly where it matters most: on a face whose cheeks are covered in acne,
    the mean is red BECAUSE of the acne, and removing it must move the mean.
    Measured on the reference acne face: dL=1.15, da=0.73 — a failure recorded
    for doing precisely the job.

    Excluding the marks keeps the assertion strict where it was designed to be
    strict. Blush is a broad low-frequency field, so flattening it still moves
    the mean over clean pixels; only the marks stop counting. The detector here
    is a local median residual, deliberately sharing no code with the tool.
    """
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    face_d = float(np.sqrt(masks.get_mask(rgb, "face-skin").sum()))
    k = min(99, max(9, int(face_d * 0.10)) | 1)
    a_res = lab[..., 1].astype(np.float32) - cv2.medianBlur(lab[..., 1], k).astype(np.float32)
    l_res = lab[..., 0].astype(np.float32) - cv2.medianBlur(lab[..., 0], k).astype(np.float32)
    marked = ((a_res > 3.0) | (l_res < -3.0)).astype(np.uint8)
    marked = cv2.dilate(marked, np.ones((5, 5), np.uint8))
    clean = np.where(marked > 0, 0.0, cheeks)
    # If a cheek is so affected that almost nothing is clean, there is no blush
    # measurement to make; fall back rather than assert on a handful of pixels.
    return cheeks if (clean > 0.5).sum() < 256 else clean


def check(path: str) -> bool:
    rgb = common.to_np(common.load_image(path))
    cheeks = clean_cheeks(rgb, masks.get_mask(rgb, "cheeks"))
    before = cheek_stats(rgb, cheeks)
    if before is None:
        print(f"  SKIP {path}: no cheeks detected")
        return True

    name = path.split(chr(92))[-1]
    all_ok = True
    for tool, fn in TOOLS.items():
        out, meta = fn(rgb, {"strength": 90})  # worst case: most aggressive
        drift = np.abs(cheek_stats(out, cheeks) - before)
        ok = bool((drift <= TOL).all())
        all_ok &= ok
        print(
            f"  {'PASS' if ok else 'FAIL'}  {tool:8s} {name}  "
            f"dL={drift[0]:.3f} da={drift[1]:.3f} db={drift[2]:.3f}  (tol {TOL})"
        )
    return all_ok


if __name__ == "__main__":
    paths = sys.argv[1:]
    if not paths:
        print("usage: python test_blush.py <image> [...]")
        raise SystemExit(2)
    print("blush preservation:")
    results = [check(p) for p in paths]
    raise SystemExit(0 if all(results) else 1)
