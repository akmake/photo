"""Skin cleanup — removes small blemishes/spots from facial skin.

mask = face-skin (minus eyes), operation = detect small dark spots and inpaint.
Uses cv2.inpaint (Telea) — the classic healing-brush approach, which is the
right tool for small areas. No heavy model needed.
"""

import cv2
import numpy as np

import common
import masks

# A face must be at least this wide (px) for blemish healing to be safe.
MIN_FACE_PX = 180


def process(image_b64: str, params: dict):
    """params: { strength: 0..100 }"""
    img = common.b64_to_image(image_b64)
    rgb = common.to_np(img)
    strength = common.clamp01(params.get("strength", 60))
    if strength <= 0:
        return common.image_to_b64(img), {"spotsRemoved": 0}

    skin = masks.get_mask(rgb, "face-skin")
    skin_px = float(skin.sum())
    face_d = float(np.sqrt(skin_px))  # ~face diameter in px

    # Below this, a blemish and a nostril are the same size — healing would
    # destroy real features. Refuse rather than produce mush.
    if face_d < MIN_FACE_PX:
        return common.image_to_b64(img), {"spotsRemoved": 0, "faceTooSmall": 1}

    eyes = masks.get_mask(rgb, "eyes")
    region = (skin > 0.5) & (eyes < 0.3)

    # pull in from the face outline so we never heal across an edge
    er = max(1, int(face_d * 0.03))
    region = cv2.erode(region.astype(np.uint8), np.ones((er, er), np.uint8)) > 0

    # a blemish is a small spot DARKER than the skin around it
    spot_r = max(1, int(face_d / 30))
    k = spot_r * 4 + 1
    if k % 2 == 0:
        k += 1
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    expected = cv2.medianBlur(gray, k)
    diff = expected.astype(np.int16) - gray.astype(np.int16)

    thr = max(4, int(18 - strength * 13))  # stronger => catches subtler spots
    spots = (diff > thr) & region

    # keep only small blobs — real blemishes, not nostrils/lips/shadows
    n, labels, stats, _ = cv2.connectedComponentsWithStats(
        spots.astype(np.uint8), connectivity=8
    )
    heal = np.zeros(spots.shape, dtype=np.uint8)
    # a blemish is small relative to the face; anything bigger is a real
    # feature (nostril, lip corner, eye shadow) and must be left alone
    max_area = max(6, int((face_d * 0.04) ** 2))
    count = 0
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if 1 <= area <= max_area:
            heal[labels == i] = 255
            count += 1

    if count == 0:
        return common.image_to_b64(img), {"spotsRemoved": 0}

    heal = cv2.dilate(heal, np.ones((3, 3), np.uint8), iterations=1)
    out = cv2.inpaint(rgb, heal, 3, cv2.INPAINT_TELEA)
    return common.image_to_b64(common.to_pil(out)), {"spotsRemoved": count}
