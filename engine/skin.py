"""Skin smoothing — AI tool.

mask      = face-skin (MediaPipe semantic segmentation) minus eyes
operation = FREQUENCY SEPARATION, the technique retouchers actually use.

The image is split into a low-frequency layer (skin *tone* — blotchiness,
uneven colour, shadow mottling) and a high-frequency layer (skin *texture* —
pores, fine hairs). Only the LOW layer is smoothed; the high layer is put back
untouched. The result is even skin that still has real texture.

This replaced two earlier, worse versions:
  1. a YCbCr colour-threshold mask that caught any skin-coloured pixel in the
     frame (walls, hair, autumn leaves) and smeared the whole image;
  2. a plain bilateral filter, which evens the tone but also erases pores and
     leaves the plastic "beauty app" look.
"""

import cv2
import numpy as np

import common
import masks

# Below this face width (px) there is no skin texture to separate — only
# features, which smoothing would destroy.
MIN_FACE_PX = 120


def process(image_b64: str, params: dict):
    """HTTP wrapper. Internal chaining must use apply() — serialising a 20MP
    frame to PNG between every tool costs more than the tools themselves."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def apply(rgb, params: dict):
    """params: { strength: 0..100 }"""
    strength = common.clamp01(params.get("strength", 60))
    if strength <= 0:
        return rgb, {"skinCoverage": 0.0}

    skin_mask = masks.get_mask(rgb, "face-skin")
    skin_px = float(skin_mask.sum())
    face_d = float(np.sqrt(skin_px))  # ~face diameter in px
    if face_d < MIN_FACE_PX:
        return rgb, {"skinCoverage": 0.0, "faceTooSmall": 1}

    # keep every real feature perfectly sharp — eyes, brows, lips, nostrils
    features = masks.get_mask(rgb, "face-features")
    region = np.clip(skin_mask - features, 0.0, 1.0)

    # feather so smoothing fades out instead of ending on a hard edge
    fr = max(3, int(face_d * 0.05)) | 1
    region = cv2.GaussianBlur(region, (fr, fr), 0)

    # Work on the face region only, at FULL resolution. A bilateral filter over
    # a 20MP frame to retouch a 350px face is almost entirely wasted work.
    box = common.region_box(region, int(face_d * 0.3), rgb.shape)
    if box is None:
        return rgb, {"skinCoverage": 0.0}
    x0, y0, x1, y1 = box

    src = rgb[y0:y1, x0:x1].astype(np.float32)
    reg = region[y0:y1, x0:x1]

    # --- frequency separation -------------------------------------------------
    # split radius scales with the face so it behaves the same at any resolution
    split = max(3, int(face_d * 0.045)) | 1
    low = cv2.GaussianBlur(src, (split, split), 0)
    high = src - low  # pores and fine detail live here

    # smooth ONLY the tone layer. Bilateral keeps the big transitions
    # (nose shadow, jawline) while flattening blotchiness.
    d = max(5, int(face_d / 10))
    low_even = cv2.bilateralFilter(low, d, 45, 45)

    # texture is added back at full strength — that's what keeps it real
    retouched = low_even + high

    a = (strength * reg)[..., None]
    blended = src * (1.0 - a) + retouched * a

    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(blended, 0, 255).astype(np.uint8)

    return out, {"skinCoverage": round(float((skin_mask > 0.5).mean()), 4)}
