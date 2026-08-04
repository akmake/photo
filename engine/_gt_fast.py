"""The inner loop: six frames that carry every failure mode in the set.

A full pass over the 23 images costs ~28 minutes, which is the wrong cadence for
choosing a weight — it turns calibration into guessing with long gaps. These six
were picked because between them they hold every way the detector fails, so a
weight that helps here and hurts nothing here is worth spending the full run on:

    321A5117  flawless 539px face — the two verified anatomy false positives
    321A5235  the set's only regression under the prior — brow tail, lip corner
    321A4934  small faces at the size gate, 6/6 heals on anatomy at baseline
    321A1791  the only face with real dirt — the recall side of the trade
    321A5254  the recall reference frame (injected marks live here)
    321A5015  a real pimple to keep, and a beard boundary to stop marking

Prints heals and heals-on-anatomy per frame for one weight set, so a sweep is a
shell loop over this file rather than a day.

    python _gt_fast.py <folder> [STRUCT_LIFT] [STRUCT_REACH] [SPECULAR_LIFT]
"""

from __future__ import annotations

import os
import sys

import numpy as np

import cleanup
import common
import masks

FRAMES = [
    ("22", "321A5117"),
    ("22", "321A5235"),
    ("33", "321A4934"),
    ("44", "321A1791"),
    ("22", "321A5254"),
    ("33", "321A5015"),
]
NEAR_FEATURE = 0.10


def on_feature(item, lms, w, h):
    """True when the candidate centre sits within 0.10 face widths of anatomy."""
    idx = [33, 133, 263, 362, 129, 358, 98, 327] + list(masks.LIPS) + \
        list(masks.LEFT_EYEBROW) + list(masks.RIGHT_EYEBROW) + \
        list(masks.LEFT_EYE) + list(masks.RIGHT_EYE)
    bx0, by0, bx1, by1 = item["bbox"]
    cx, cy = (bx0 + bx1) / 2 * w, (by0 + by1) / 2 * h
    best = 9.9
    for lm in lms:
        face_d = float(np.hypot(
            (lm[masks.FACE_RIGHT].x - lm[masks.FACE_LEFT].x) * w,
            (lm[masks.FACE_RIGHT].y - lm[masks.FACE_LEFT].y) * h))
        for i in idx:
            d = float(np.hypot(cx - lm[i].x * w, cy - lm[i].y * h)) / max(1.0, face_d)
            best = min(best, d)
    return best < NEAR_FEATURE


def main():
    folder = sys.argv[1]
    if len(sys.argv) > 2:
        cleanup.STRUCT_LIFT = float(sys.argv[2])
    if len(sys.argv) > 3:
        cleanup.STRUCT_REACH = float(sys.argv[3])
    if len(sys.argv) > 4:
        cleanup.SPECULAR_LIFT = float(sys.argv[4])
    print(f"lift={cleanup.STRUCT_LIFT} reach={cleanup.STRUCT_REACH} "
          f"spec={cleanup.SPECULAR_LIFT} credit={cleanup.PIGMENT_CREDIT}")

    total_h = total_f = 0
    for sub, name in FRAMES:
        path = None
        for ext in (".JPG", ".jpg"):
            p = os.path.join(folder, sub, name + ext)
            if os.path.exists(p):
                path = p
                break
        if path is None:
            print(f"  {name}: NOT FOUND")
            continue
        rgb = common.to_np(common.load_image(path))
        masks.set_source(rgb)
        h, w = rgb.shape[:2]
        lms = masks._face_landmarks(rgb) or []
        det = cleanup.detect(rgb, {"strength": 25})
        heals = [i for i in det["items"] if i["verdict"] == "heal"]
        feat = sum(1 for i in heals if on_feature(i, lms, w, h))
        total_h += len(heals)
        total_f += feat
        print(f"  {name:10s} heal {len(heals):3d}  onAnatomy {feat:3d}")
    pct = 100 * total_f / max(1, total_h)
    print(f"  {'TOTAL':10s} heal {total_h:3d}  onAnatomy {total_f:3d}  ({pct:.0f}%)")


if __name__ == "__main__":
    main()
