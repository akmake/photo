"""Skin cleanup — removes blemishes without touching the person's own colour.

Detection: novelty against a per-face skin model (see skinmodel.py). We do not
describe what a flaw looks like; we model the skin and flag what the model
cannot explain — so a mark that is LIGHTER, darker, redder or yellower is all
caught by the same measure.

Healing: frequency-separated, not inpainting. cv2.inpaint fills a hole by
propagating from its rim, which leaves a flat, textureless disc — the "plaster"
look. Instead the image is split into

    low  = the skin's own colour field  (blush; NEVER modified)
    mid  = the band blemishes live in   (suppressed where confidence is high)
    high = pores and texture            (kept, so the repair has real skin)

and reassembled. Because `low` is untouched by construction, this tool cannot
neutralise natural rosiness — that is a structural guarantee, not a setting.
"""

import cv2
import numpy as np

import common
import masks
import skinmodel

# A face must be at least this wide (px) for blemish healing to be safe.
MIN_FACE_PX = 180


def process(image_b64: str, params: dict):
    """HTTP wrapper — internal chaining uses apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def confidence(rgb, params: dict):
    """Return (confidence map 0..1, skin_region, face_d, model) or None."""
    strength = common.clamp01(params.get("strength", 60))
    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    if face_d < MIN_FACE_PX:
        return None

    features = masks.get_mask(rgb, "face-features")
    hair = masks.get_mask(rgb, "hair")
    hr = max(3, int(face_d * 0.035)) | 1
    hair = cv2.dilate(hair, np.ones((hr, hr), np.uint8))

    region = np.clip(skin - features - hair, 0.0, 1.0)
    er = max(1, int(face_d * 0.03))
    region = cv2.erode(region, np.ones((er, er), np.uint8))
    if region.max() <= 0:
        return None

    model = skinmodel.build(rgb, region, face_d)

    # Mahalanobis distance is chi-like with 3 dof, so the bar is set in sigmas.
    # strength 0 -> 4.5 sigma (only blatant marks), 1 -> 2.2 sigma (subtle too)
    lo = 4.5 - strength * 2.3
    hi = lo + 1.6
    conf = np.clip((model.novelty - lo) / (hi - lo), 0.0, 1.0)
    conf = conf * conf * (3 - 2 * conf)  # smoothstep: no hard edges
    conf *= region

    # Safety net: a blemish is LOCAL. Anything larger than this is skin
    # character the model failed to absorb (a broad shadow, strong blush on an
    # unusual face) — never "correct" it.
    max_side = max(8, int(face_d * 0.16))
    blobs = (conf > 0.35).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(blobs, connectivity=8)
    for i in range(1, n):
        if (
            stats[i, cv2.CC_STAT_WIDTH] > max_side
            or stats[i, cv2.CC_STAT_HEIGHT] > max_side
        ):
            conf[labels == i] = 0.0

    # feather so the correction fades in
    fr = max(3, int(face_d * 0.006)) | 1
    conf = cv2.GaussianBlur(conf, (fr, fr), 0)
    return conf, region, face_d, model


def apply(rgb, params: dict):
    """params: { strength: 0..100 }"""
    strength = common.clamp01(params.get("strength", 60))
    if strength <= 0:
        return rgb, {"spotsRemoved": 0}

    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    if face_d < MIN_FACE_PX:
        return rgb, {"spotsRemoved": 0, "faceTooSmall": 1}

    box = common.region_box(skin, int(face_d * 0.25), rgb.shape)
    if box is None:
        return rgb, {"spotsRemoved": 0}
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1]

    got = confidence(crop, params)
    if got is None:
        return rgb, {"spotsRemoved": 0}
    conf, region, face_c, model = got

    area = float((conf > 0.35).sum())
    if area < 4:
        return rgb, {"spotsRemoved": 0, "correctedPx": 0}

    # --- healing -----------------------------------------------------------
    # low is reassembled untouched -> natural colour cannot be neutralised.
    # mid is where the blemish lives -> suppressed by confidence.
    # high is texture -> kept almost entirely, so there is no flat patch.
    c = conf[..., None]
    healed_lab = model.low + model.mid * (1.0 - c) + model.high * (1.0 - c * 0.30)
    healed_lab = np.clip(healed_lab, 0, 255).astype(np.uint8)
    healed = cv2.cvtColor(healed_lab, cv2.COLOR_LAB2RGB)

    blend = np.clip(conf, 0.0, 1.0)[..., None]
    out_crop = (crop.astype(np.float32) * (1 - blend) + healed.astype(np.float32) * blend)

    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(out_crop, 0, 255).astype(np.uint8)

    n, _, stats, _ = cv2.connectedComponentsWithStats(
        (conf > 0.35).astype(np.uint8), connectivity=8
    )
    return out, {"spotsRemoved": max(0, n - 1), "correctedPx": int(area)}
