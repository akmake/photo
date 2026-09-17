"""The manual brush: it rebuilds what was painted, and nothing else.

    python test_manual_clean.py <image> [more images...]

Four properties, each one a way the tool could quietly be wrong:

  1. outside the stroke, the frame is BIT-IDENTICAL. A brush that softens the
     skin around what it cleans is the failure this whole tool exists to avoid.
  2. the mark is actually gone. Measured against a blemish PUT THERE on
     purpose: paint a dark blob on clean skin, brush over it, and ask how much
     of the original frame came back. "The pixels changed" was the first
     version of this and it was a bad test — the first stroke landed on a white
     shirt, where a perfectly correct fill returns almost the same numbers and
     an honest tool looks broken.
  3. the same stroke means the same place at any resolution. It is drawn on a
     preview and delivered at full size, so the coordinates are fractions;
     this measures that the region treated lands in the same place in both.
  4. no face needed. Half of what a photographer points at is on a shirt, a
     hand or a background, and `skin-cleanup` cannot reach any of it.
"""

import sys

import cv2
import numpy as np

import manual_clean
import previews

STROKE = {"id": "t1", "points": [[0.46, 0.52], [0.54, 0.52]], "r": 0.012}
failures = 0


def report(ok, text):
    global failures
    if not ok:
        failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {text}")


def run(path):
    print(path)
    _src, img, _scale = previews.working_frame(path, 1400)
    rgb = np.asarray(img)
    out, meta = manual_clean.apply(rgb, {"strokes": [STROKE]})
    mask = manual_clean._mask(rgb.shape, [STROKE]) > 0

    outside = int((out != rgb).any(axis=2)[~mask].sum())
    report(outside == 0, f"outside the stroke: {outside} px changed (must be 0)")

    report(meta.get("cleanedPx") == int(mask.sum()), f"reported {meta.get('cleanedPx')} px")

    # THE MARK IS GONE. A blob of the frame's own skin, darkened hard, painted
    # inside the stroke: the brush has to bring the frame back, so what is left
    # is measured against the ORIGINAL pixels, not against the blob.
    dirty = rgb.copy()
    core = cv2.erode(mask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    dirty[core] = (rgb[core].astype(np.float32) * 0.45).astype(np.uint8)
    before = float(np.abs(dirty[core].astype(int) - rgb[core].astype(int)).mean())
    cleaned, _ = manual_clean.apply(dirty, {"strokes": [STROKE]})
    after = float(np.abs(cleaned[core].astype(int) - rgb[core].astype(int)).mean())
    report(after < before * 0.25,
           f"a blemish {before:.0f} levels deep comes back within {after:.0f} levels of the real skin")

    # Same stroke, quarter-size frame: the treated region must sit in the same
    # PLACE, so its centre of mass in fractions of the frame must agree.
    small = cv2.resize(rgb, (rgb.shape[1] // 4, rgb.shape[0] // 4), interpolation=cv2.INTER_AREA)
    m_small = manual_clean._mask(small.shape, [STROKE]) > 0

    def centre(m):
        ys, xs = np.where(m)
        return xs.mean() / m.shape[1], ys.mean() / m.shape[0]

    cx, cy = centre(mask)
    sx, sy = centre(m_small)
    drift = max(abs(cx - sx), abs(cy - sy))
    report(drift < 0.005, f"at a quarter of the size the stroke lands within {drift:.4f} of the frame")

    # A frame with nothing in it at all: still cleaned, still only the stroke.
    flat = np.full((600, 900, 3), 180, np.uint8)
    flat[:, :, 1] = 150
    f_out, f_meta = manual_clean.apply(flat, {"strokes": [STROKE]})
    f_mask = manual_clean._mask(flat.shape, [STROKE]) > 0
    report(int((f_out != flat).any(axis=2)[~f_mask].sum()) == 0,
           f"no face in the frame: {f_meta.get('cleanedPx')} px treated, nothing else touched")


for p in sys.argv[1:]:
    run(p)

if not sys.argv[1:]:
    print("usage: python test_manual_clean.py <image> [...]")
    sys.exit(2)
print("FAILURES:", failures)
sys.exit(1 if failures else 0)
