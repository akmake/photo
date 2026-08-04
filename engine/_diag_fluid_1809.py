"""Reproduce the drool (fluid-trail) detection failure on 321A1809.

The tool has a whole fluid detector (`cleanup._fluid_trails`) whose only
validated true positive is this baby's drool. On the full-resolution group
frame it returns 0. This traces WHY: the strand fragments, and the surviving
anchored pieces are rejected by the mean-width gate.

Usage:
    ./.venv/Scripts/python.exe _diag_fluid_1809.py [path-to-321A1809.JPG]
"""
import sys
import cv2
import numpy as np

import cleanup
import common
import masks
import shape

SRC = sys.argv[1] if len(sys.argv) > 1 else r"C:/Users/yosef dahan/Downloads/44/321A1809.JPG"

rgb = common.to_np(common.load_image(SRC))
H, W = rgb.shape[:2]

# 1) Top-level, exactly what the app sees.
det = cleanup.detect(rgb, {"strength": 60})
print("detect() notes:", det["notes"])
print("  -> fluidTrails =", det["notes"].get("fluidTrails", 0),
      " wetTrails =", det["notes"].get("wetTrails", 0),
      "  (drool is visible on face 2-from-left)")

# 2) Reproduce the per-face crop the group path builds for the baby, and trace
#    _fluid_trails gate by gate on it.
faces = masks._face_landmarks(rgb)
boxes = sorted(cleanup._face_boxes(rgb, faces)[0], key=lambda b: (b[0] + b[2]) / 2)
x0, y0, x1, y1 = boxes[1]                       # 2nd from left = the toddler
sub = rgb[y0:y1, x0:x1]
skin = masks.get_mask(sub, "face-skin")
face_d = float(np.sqrt(skin.sum()))
bx = common.region_box(skin, int(face_d * 0.25), sub.shape)
crop = sub[bx[1]:bx[3], bx[0]:bx[2]]
fd = float(np.sqrt(masks.get_mask(crop, "face-skin").sum()))
orifice, anchor_src, down = cleanup._orifice_context(sub)
sl = np.s_[bx[1]:bx[3], bx[0]:bx[2]]
skin_zone = np.clip(
    masks.get_mask(crop, "face-skin") * masks.get_mask(crop, "face-oval")
    - masks.get_mask(crop, "face-eye-region"), 0.0, 1.0)

# --- inline the strand builder from _fluid_trails, then judge each piece ---
zr = max(7, int(fd * 0.55)) | 1
reach = cv2.dilate(orifice[sl], np.ones((zr, zr), np.uint8)) > 0
zone = reach & (orifice[sl] == 0) & (skin_zone > 0.35)
lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB)
k = max(5, int(fd * 0.02)) | 1
kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
top = cv2.morphologyEx(lab[..., 0], cv2.MORPH_TOPHAT, kern).astype(np.float32)
med = float(np.median(top[zone]))
sig = 1.4826 * float(np.median(np.abs(top[zone] - med))) + 1e-6
seed = ((top > max(6.0, med + 4 * sig)) & zone).astype(np.uint8)
extent = ((top > max(2.0, med + 1.5 * sig)) & zone).astype(np.uint8)
bridge = max(3, int(fd * 0.03)) | 1
extent = cv2.morphologyEx(extent, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (1, bridge)))
cnt, lbl, _, _ = cv2.connectedComponentsWithStats(extent, 8)
keep = np.zeros(cnt, bool); keep[np.unique(lbl[seed > 0])] = True; keep[0] = False
strands = cv2.morphologyEx(keep[lbl].astype(np.uint8), cv2.MORPH_CLOSE,
                           np.ones((5, 5), np.uint8))
anchor_zone = cv2.dilate(anchor_src[sl], np.ones((max(3, int(fd * 0.05)),) * 2, np.uint8)) > 0
rim = reach & ~cv2.erode(reach.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)

n, lbl, st, _ = cv2.connectedComponentsWithStats(strands, 8)
width_bar = fd * cleanup.FLUID_MAX_WIDTH
print(f"\nface_d(working)={fd:.0f}  vertical-bridge={bridge}px  "
      f"width-gate bar = face_d*{cleanup.FLUID_MAX_WIDTH} = {width_bar:.1f}px")
print(f"strand fragments after bridging: {n - 1}")
print("  (meanW = the old bounding-box estimator, kept only to show the gap)")
for i in range(1, n):
    comp = lbl == i
    area = int(st[i, cv2.CC_STAT_AREA])
    box_len = max(int(st[i, cv2.CC_STAT_WIDTH]), int(st[i, cv2.CC_STAT_HEIGHT]))
    old_ratio = area / max(1, box_len)
    geom = shape.describe(comp)
    ys, xs = np.nonzero(comp)
    why = []
    if area < max(16, int(fd * 0.5)) or area > int(fd * fd * 0.01):
        why.append("area")
    if geom.length < fd * 0.05:
        why.append("len")
    if geom.thickness_typ > width_bar:
        why.append(f"WIDTH {geom.thickness_typ:.1f}>{width_bar:.1f}")
    if not (comp & anchor_zone).any():
        why.append("no-anchor")
    if (comp & rim).any():
        why.append("rim")
    if area >= max(16, int(fd * 0.5)):     # only print the pieces that matter
        print(f"  frag{i:2d} area={area:4d} thick={geom.thickness_typ:4.1f} "
              f"len={geom.length:5.1f} elong={geom.elongation:5.1f} "
              f"[oldMeanW={old_ratio:4.1f}] y=[{ys.min()},{ys.max()}] "
              f"-> {'PASS' if not why else why}")
