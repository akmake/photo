"""Where does the acne get lost? Recall of REAL marks at every stage.

Ground truth comes from an independent median-background detector (shared with
test_cleanup_quality), never from the tool's own confidence — otherwise the
measurement just agrees with the bug.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

import cleanup
import common
import masks
import skinmodel

SRC = sys.argv[1]
STRENGTH = float(sys.argv[2]) if len(sys.argv) > 2 else 100.0

rgb = common.to_np(common.load_image(SRC))
masks.set_source(rgb)
skin = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin.sum()))
box = common.region_box(skin, int(face_d * 0.25), rgb.shape)
x0, y0, x1, y1 = box
crop = rgb[y0:y1, x0:x1]
print(f"face_d {face_d:.0f}  crop {crop.shape}")

# ---------------- ground truth: independent acne blobs ---------------------
sk = masks.get_mask(crop, "face-skin")
oval = masks.get_mask(crop, "face-oval")
feat = masks.get_mask(crop, "face-anatomy")
hair = masks.get_mask(crop, "hair")
hr = max(3, int(face_d * 0.035)) | 1
hair_d = cv2.dilate(hair, np.ones((hr, hr), np.uint8))
judge = np.clip(sk * oval - feat - hair_d, 0.0, 1.0)

lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB)
k = min(99, max(9, int(face_d * 0.10)) | 1)
a_res = lab[..., 1].astype(np.float32) - cv2.medianBlur(lab[..., 1], k).astype(np.float32)
l_res = lab[..., 0].astype(np.float32) - cv2.medianBlur(lab[..., 0], k).astype(np.float32)
gt = (((a_res > 3.5) | (l_res < -3.5)) & (judge > 0.5)).astype(np.uint8)
gt = cv2.morphologyEx(gt, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, gt_lab, gt_stats, gt_cent = cv2.connectedComponentsWithStats(gt, 8)
truth = []
for i in range(1, n):
    area = int(gt_stats[i, cv2.CC_STAT_AREA])
    w = gt_stats[i, cv2.CC_STAT_WIDTH]
    h = gt_stats[i, cv2.CC_STAT_HEIGHT]
    if area < 15 or area > face_d * face_d * 0.004:
        continue
    if max(w, h) > 4 * max(1, min(w, h)):
        continue
    truth.append((i, area, (int(gt_cent[i][0]), int(gt_cent[i][1]))))
print(f"ground-truth marks: {len(truth)} (independent detector)")

mid_x = crop.shape[1] / 2
left = [t for t in truth if t[2][0] < mid_x]
right = [t for t in truth if t[2][0] >= mid_x]
print(f"  left half {len(left)}   right half {len(right)}")


def recall(mask, name):
    hit = [t for t in truth if mask[gt_lab == t[0]].mean() > 0.30]
    hl = sum(1 for t in hit if t[2][0] < mid_x)
    hr_ = len(hit) - hl
    print(
        f"{name:<22} px={int((mask > 0).sum()):7d}  recall={len(hit):4d}/{len(truth)} "
        f"({100.0 * len(hit) / max(1, len(truth)):5.1f}%)   L {hl}/{len(left)}  R {hr_}/{len(right)}"
    )
    return hit


# ---------------- replicate the real chain, stage by stage -----------------
got = cleanup.confidence(crop, {"strength": STRENGTH})
conf, region, face_c, model = got
recall((region > 0.35).astype(np.uint8), "0 region (judgeable)")

lo = cleanup._novelty_bar(common.clamp01(STRENGTH))
print(f"\nnovelty bar lo={lo:.2f}  hi={lo + 1.6:.2f}  (strength {STRENGTH} -> "
      f"{common.clamp01(STRENGTH)})")
nv = model.novelty
for label, sel in [("on GT marks", gt > 0), ("on clean skin", (region > 0.5) & (gt == 0))]:
    v = nv[sel]
    if v.size:
        print(f"  novelty {label:<14} median={np.median(v):.2f} p75={np.percentile(v,75):.2f} "
              f"p90={np.percentile(v,90):.2f} p99={np.percentile(v,99):.2f}")

raw = np.clip((model.novelty - lo) / 1.6, 0.0, 1.0)
raw = raw * raw * (3 - 2 * raw) * region
recall((raw > 0.22).astype(np.uint8), "1a raw score>0.22")
# what does the max_side safety net in confidence() cost?
ms = max(8, int(face_c * 0.16))
blobs = (raw > 0.35).astype(np.uint8)
cn, cl, cs, _ = cv2.connectedComponentsWithStats(blobs, 8)
culled = np.zeros_like(blobs)
for i in range(1, cn):
    if cs[i, cv2.CC_STAT_WIDTH] > ms or cs[i, cv2.CC_STAT_HEIGHT] > ms:
        culled[cl == i] = 1
print(f"    max_side net: {int(culled.sum())}px in oversized blobs would be discarded "
      f"(max_side={ms})")
recall((np.clip(raw - culled.astype(np.float32), 0, 1) > 0.22).astype(np.uint8),
       "1b after max_side net")
recall((conf > 0.22).astype(np.uint8), "1 conf>0.22 (extent)")
recall((conf > 0.60).astype(np.uint8), "2 conf>0.60 (seed)")
core = cleanup.hysteresis_core(conf)
recall(core, "3 hysteresis core")

orifice, down_field = cleanup._orifice_context(rgb)
gated, lv, sv, wt = cleanup._structure_gate(
    crop, core, face_c, model.novelty, lo, region,
    orifice=orifice[y0:y1, x0:x1], down_field=down_field[y0:y1, x0:x1],
)
recall(gated, "4 structure gate")
print(f"    lineVetoed={lv} shadingVetoed={sv} wetTrails={wt}")
repair = cleanup.decide(conf, face_c, gated)
recall(repair, "5 decide (final repair)")

# ---------------- is sigma inflated by the acne itself? -------------------
print("\n--- sigma diagnosis (is the model absorbing what it should flag?) ---")
# The honest test: mid is computed exactly as production does; only the set of
# pixels the SIGMA is estimated from changes. (Excluding marks from `support`
# instead punches holes in the tiny `fine` kernel and explodes num/den — that
# is a measurement artefact, not a signal.)
usable = region > 0.5
clean = usable & (gt == 0)
print(f"  judged {int(usable.sum())}px, of which clean {int(clean.sum())}px "
      f"({100.0 * clean.sum() / usable.sum():.1f}%)")
for c, nm in enumerate("Lab"):
    v = model.mid[..., c]
    s_all = skinmodel._robust_sigma(v[usable])
    s_clean = skinmodel._robust_sigma(v[clean])
    print(f"  {nm}: sigma(all judged)={s_all:.3f}   sigma(clean only)={s_clean:.3f}"
          f"   inflation x{s_all / max(1e-6, s_clean):.3f}")

# What recall would we get if sigma came from clean skin only?
acc = np.zeros(crop.shape[:2], np.float32)
w = (skinmodel.W_L, skinmodel.W_A, skinmodel.W_B)
for c in range(3):
    v = model.mid[..., c]
    med = float(np.median(v[clean]))
    sig = skinmodel._robust_sigma(v[clean])
    z = (v - med) / sig
    acc += w[c] * z * z
nov2 = np.sqrt(acc / sum(w))
print(f"  novelty with clean-sigma: marks median={np.median(nov2[gt > 0]):.2f}  "
      f"clean median={np.median(nov2[clean]):.2f}")
r2 = np.clip((nov2 - lo) / 1.6, 0, 1)
r2 = r2 * r2 * (3 - 2 * r2) * region
recall((r2 > 0.22).astype(np.uint8), "  clean-sigma score>0.22")
