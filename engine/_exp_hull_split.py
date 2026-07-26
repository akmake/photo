"""Experiment: is the merged eye+brow hull still needed?

It was introduced because separate hulls left the eyelid crease exposed and the
detector kept flagging it. The colour weighting (W_L=0.25) landed later and is
documented as making the detector nearly blind to geometry — and a crease IS
geometry. If that holds, the merged hull is now redundant belt-and-braces, and
it costs us the brow: 56% of the brow area is unreachable because of it.

This does not decide by argument. It splits the hull, then measures BOTH sides:
does the crease come back into the detection map, and does the brow open up.
"""

from __future__ import annotations

import sys
from collections import OrderedDict
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import masks

SRC = sys.argv[1]
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 100

LEFT_EYE_UPPER = [33, 246, 161, 160, 159, 158, 157, 173, 133]
RIGHT_EYE_UPPER = [263, 466, 388, 387, 386, 385, 384, 398, 362]
LEFT_BROW_LOWER = [46, 53, 52, 65, 55]
RIGHT_BROW_LOWER = [276, 283, 282, 295, 285]

_orig_parts = masks.anatomy_parts


def split_parts(rgb, lm):
    """Same protections, but the eye and the brow get their own hulls."""
    h, w = rgb.shape[:2]
    fw = max(1.0, abs(lm[masks.FACE_RIGHT].x - lm[masks.FACE_LEFT].x) * w)

    def hull(idx, grow):
        m = np.zeros((h, w), np.uint8)
        pts = np.array([[lm[i].x * w, lm[i].y * h] for i in idx], np.int32)
        cv2.fillConvexPoly(m, cv2.convexHull(pts), 255)
        return cv2.dilate(m, masks._kern(fw * grow)) if grow > 0 else m

    parts: "OrderedDict[str, np.ndarray]" = OrderedDict()
    # lashes sit outside the landmark ring -> the eye still needs a margin
    parts["eye-l"] = hull(masks.LEFT_EYE, 0.030)
    parts["eye-r"] = hull(masks.RIGHT_EYE, 0.030)
    # brow hairs need cover, but a fat margin here is what walled off the ridge
    parts["brow-l"] = hull(masks.LEFT_EYEBROW, 0.012)
    parts["brow-r"] = hull(masks.RIGHT_EYEBROW, 0.012)
    # The fold is what the merged hull was really for — measured, not assumed:
    # splitting without it puts 426px of eyelid crease back under the healer.
    # So protect the fold ITSELF, as the thin band it is, instead of paying for
    # it with the whole brow.
    if FOLD:
        parts["eyelid-crease"] = crease_band(rgb, lm)

    rest = _orig_parts(rgb, lm)
    for k, v in rest.items():
        if not k.startswith("eyelid"):
            parts[k] = v
    return parts


def crease_band(rgb, lm):
    """The fold between lash line and brow underside — what the hull protected."""
    h, w = rgb.shape[:2]
    m = np.zeros((h, w), np.uint8)
    for up, lowr in ((LEFT_EYE_UPPER, LEFT_BROW_LOWER), (RIGHT_EYE_UPPER, RIGHT_BROW_LOWER)):
        pts = np.array([[lm[i].x * w, lm[i].y * h] for i in list(up) + list(lowr)], np.int32)
        cv2.fillConvexPoly(m, cv2.convexHull(pts), 255)
    return m


def run(label):
    masks._CACHE.clear()
    rgb = common.to_np(common.load_image(SRC))
    masks.set_source(rgb)
    sf = masks.get_mask(rgb, "face-skin")
    fd = float(np.sqrt(sf.sum()))
    x0, y0, x1, y1 = common.region_box(sf, int(fd * 0.25), rgb.shape)
    crop = rgb[y0:y1, x0:x1]
    conf, region, fc, model = cleanup.confidence(crop, {"strength": STRENGTH})
    repair = cleanup.decide(conf, fc)
    out, meta = cleanup.apply(rgb, {"strength": STRENGTH, "mode": "reconstruct"})

    small = common.downscale(crop)
    lm = masks._face_landmarks(small)[0]
    h, w = crop.shape[:2]
    skin = masks.get_mask(crop, "face-skin")
    band = common.upscale_to(crease_band(small, lm).astype(np.float32) / 255.0, crop.shape) > 0.5
    # only the fold itself: drop the eye and the brow hair from the band
    eye = np.zeros((h, w), bool)
    for idx in (masks.LEFT_EYE, masks.RIGHT_EYE, masks.LEFT_EYEBROW, masks.RIGHT_EYEBROW):
        m = np.zeros(small.shape[:2], np.uint8)
        pts = np.array([[lm[i].x * small.shape[1], lm[i].y * small.shape[0]] for i in idx], np.int32)
        cv2.fillConvexPoly(m, cv2.convexHull(pts), 255)
        eye |= common.upscale_to(m.astype(np.float32) / 255.0, crop.shape) > 0.5
    fold = band & ~eye & (skin > 0.5)

    print(f"\n--- {label} ---")
    print(f"  repaired total      : {int(repair.sum()):6d} px in {meta.get('spotsRemoved', 0)} lesions")
    print(f"  CREASE fold area    : {int(fold.sum()):6d} px")
    print(f"    seeds in fold     : {int(((conf > 0.60) & fold).sum()):6d}")
    print(f"    REPAIRED in fold  : {int(((repair > 0) & fold).sum()):6d}   <-- must stay ~0")

    for side, idx in (("L", masks.LEFT_EYEBROW), ("R", masks.RIGHT_EYEBROW)):
        pts = np.array([[lm[i].x * w, lm[i].y * h] for i in idx])
        bx0, by0 = pts.min(0)
        bx1, by1 = pts.max(0)
        pad = (bx1 - bx0) * 0.40
        a, b = int(max(0, bx0 - pad)), int(max(0, by0 - pad * 1.3))
        c, d = int(min(w, bx1 + pad)), int(min(h, by1 + pad * 1.3))
        sel = np.zeros((h, w), bool)
        sel[b:d, a:c] = True
        S = sel & (skin > 0.5)
        print(f"  BROW {side}: eligible {float((region[S] > 0).mean()) * 100:5.1f}%"
              f"   repaired {int((repair[S] > 0).sum()):4d} px")
    return rgb, crop, repair, out, (x0, y0, x1, y1)


FOLD = False
base = run("BASELINE (merged eye+brow hull)")
masks.anatomy_parts = split_parts
split = run("SPLIT (eye hull + brow hull, no merged hull)")
FOLD = True
split = run("SPLIT + explicit crease band")

for tag, (rgb, crop, repair, out, box) in (("baseline", base), ("split", split)):
    x0, y0, x1, y1 = box
    mark = crop.astype(np.float32)
    a = repair.astype(np.float32)[..., None] * 0.85
    mark = np.clip(mark * (1 - a) + np.array([0.0, 255.0, 120.0]) * a, 0, 255).astype(np.uint8)
    panels = []
    for label, image in [("BEFORE", crop), ("marked", mark), ("AFTER", out[y0:y1, x0:x1])]:
        p = Image.fromarray(np.asarray(image, np.uint8))
        s = 1100 / p.height
        p = p.resize((int(p.width * s), 1100), Image.LANCZOS)
        cv_ = Image.new("RGB", (p.width, p.height + 34), (18, 18, 22))
        cv_.paste(p, (0, 34))
        ImageDraw.Draw(cv_).text((10, 12), f"{tag} — {label}", fill=(240, 240, 240))
        panels.append(cv_)
    sheet = Image.new("RGB", (sum(p.width for p in panels) + 20, panels[0].height), (18, 18, 22))
    x = 0
    for p in panels:
        sheet.paste(p, (x, 0))
        x += p.width + 10
    sheet.save(OUT / f"exp-hull-{tag}.jpg", quality=95)
    print("->", OUT / f"exp-hull-{tag}.jpg")
