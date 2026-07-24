"""Background blur / bokeh — AI tool.

mask = subject (MediaPipe multiclass segmenter), operation = blur the inverse.
"""

import cv2
import numpy as np

import common
import masks


def process(image_b64: str, params: dict):
    """params: { amount: 0..100, feather: 0..100 }"""
    img = common.b64_to_image(image_b64)
    rgb = common.to_np(img)
    amount = common.clamp01(params.get("amount", 60))
    feather = common.clamp01(params.get("feather", 40))

    if amount <= 0:
        return common.image_to_b64(img), {"subjectCoverage": 0.0}

    h, w = rgb.shape[:2]
    mask = masks.get_mask(rgb, "subject")

    # Feather the subject edge so the cutout never looks pasted.
    fr = max(1, int(feather * 0.015 * max(h, w))) | 1
    soft = cv2.GaussianBlur(mask, (fr, fr), 0)

    # Blur strength scales with the image so it looks the same at any size.
    k = max(3, int(amount * 0.05 * max(h, w))) | 1
    blurred = cv2.GaussianBlur(rgb.astype(np.float32), (k, k), 0)

    m3 = soft[..., None]
    out = rgb.astype(np.float32) * m3 + blurred * (1.0 - m3)

    return common.image_to_b64(common.to_pil(out)), {
        "subjectCoverage": round(float(mask.mean()), 4)
    }
