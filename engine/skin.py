"""Skin smoothing — AI tool.

mask = face-skin (MediaPipe semantic segmentation) minus eyes
operation = edge-preserving smoothing that softens texture without
            destroying features.

Note: this replaced an early YCbCr colour-threshold mask, which caught any
skin-coloured pixel in the frame (walls, hair, autumn leaves) and smeared the
whole image. Semantic masks only.
"""

import cv2
import numpy as np

import common
import masks

# Below this face width (px) there is no skin texture to smooth — only
# features, which smoothing would destroy.
MIN_FACE_PX = 120


def process(image_b64: str, params: dict):
    """params: { strength: 0..100 }"""
    img = common.b64_to_image(image_b64)
    rgb = common.to_np(img)
    strength = common.clamp01(params.get("strength", 60))
    if strength <= 0:
        return common.image_to_b64(img), {"skinCoverage": 0.0}

    skin_mask = masks.get_mask(rgb, "face-skin")
    skin_px = float(skin_mask.sum())
    face_d = float(np.sqrt(skin_px))  # ~face diameter in px
    if face_d < MIN_FACE_PX:
        return common.image_to_b64(img), {"skinCoverage": 0.0, "faceTooSmall": 1}

    # keep eyes (and their lashes/brows) fully sharp
    eyes = masks.get_mask(rgb, "eyes")
    region = np.clip(skin_mask - eyes, 0.0, 1.0)

    # feather so the smoothing fades out instead of ending on a hard edge
    fr = max(3, int(face_d * 0.05)) | 1
    region = cv2.GaussianBlur(region, (fr, fr), 0)

    # bilateral = smooths tone while preserving edges (pores, lids, lips)
    d = max(5, int(face_d / 12))
    smoothed = cv2.bilateralFilter(rgb, d, 40, 40)

    a = (strength * region)[..., None]
    out = rgb.astype(np.float32) * (1.0 - a) + smoothed.astype(np.float32) * a

    return common.image_to_b64(common.to_pil(out)), {
        "skinCoverage": round(float((skin_mask > 0.5).mean()), 4)
    }
