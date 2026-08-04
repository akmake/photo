"""What the structural prior actually charges each candidate, term by term.

Weights picked by intuition are weights picked wrong — the first attempt at
this file's constants left both verified false positives on 321A5117 alive,
because the pigment credit was reading a highlight's chroma MAGNITUDE as
evidence of pigment and refunding the specular lift it had just charged.

So the terms get printed per candidate, next to the novelty they have to beat.

    python _gt_lift.py <image> [spots]
"""

from __future__ import annotations

import sys

import cv2
import numpy as np

import cleanup
import common
import masks
import skinmodel


def main():
    path = sys.argv[1]
    spots = float(sys.argv[2]) if len(sys.argv) > 2 else 25.0
    rgb = common.to_np(common.load_image(path))
    masks.set_source(rgb)

    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    features = masks.get_mask(rgb, "face-anatomy")
    hair = masks.get_mask(rgb, "hair")
    hr = max(3, int(face_d * 0.035)) | 1
    hair = cv2.dilate(hair, np.ones((hr, hr), np.uint8))
    region = np.clip(skin - features - hair, 0.0, 1.0) * masks.get_mask(rgb, "face-oval")
    er = max(1, int(face_d * 0.03))
    region = cv2.erode(region, np.ones((er, er), np.uint8))
    simple = masks.get_mask(rgb, "face-features")
    support = np.clip(skin - simple - hair, 0.0, 1.0)
    model = skinmodel.build(rgb, region, face_d, support=support)

    structures = np.maximum(features, hair)
    outside = (structures <= 0).astype(np.uint8)
    dist = cv2.distanceTransform(outside, cv2.DIST_L2, 5)
    usable = region > 0.5
    mid = model.mid
    sigma_l = cleanup._robust_sigma(mid[..., 0][usable])
    sigma_a = cleanup._robust_sigma(mid[..., 1][usable])
    chroma = np.hypot(mid[..., 1], mid[..., 2])
    sigma_c = cleanup._robust_sigma(chroma[usable])

    det = cleanup.detect(rgb, {"strength": spots})
    h, w = rgb.shape[:2]
    lo = cleanup._novelty_bar(spots)
    print(f"face_d={face_d:.0f}  lo={lo:.2f}  hi={lo + 1.6:.2f}  "
          f"sigma_L={sigma_l:.2f} sigma_a={sigma_a:.2f} sigma_chroma={sigma_c:.2f}")
    print(f"{'n':>3} {'kind':7} {'verdict':8} {'distPx':>7} {'z_bright':>8} "
          f"{'z_red':>6} {'z_chr':>6} {'novPk':>6} {'area':>6}")
    for n, item in enumerate(det["items"], 1):
        m = np.zeros((h, w), np.uint8)
        for c in item["contours"]:
            pts = np.array([[int(px * w), int(py * h)] for px, py in c], np.int32)
            cv2.fillPoly(m, [pts], 1)
        sel = m > 0
        if not sel.any():
            continue
        print(f"{n:3d} {item['kind']:7} {item['verdict']:8} "
              f"{np.median(dist[sel]):7.1f} "
              f"{np.median(mid[..., 0][sel]) / sigma_l:8.2f} "
              f"{np.median(mid[..., 1][sel]) / sigma_a:6.2f} "
              f"{np.median(chroma[sel]) / sigma_c:6.2f} "
              f"{item['facts'].get('noveltyPeak', 0):6.2f} "
              f"{item['facts'].get('areaPx', 0):6d}")


if __name__ == "__main__":
    main()
