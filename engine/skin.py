"""Skin detection + frequency-separation smoothing.

POC note: the skin MASK here comes from YCbCr color thresholds. In production
we swap `skin_mask()` for a semantic model (BiSeNet face-parsing) — the rest of
the pipeline (smoothing, blending, the HTTP tool contract) stays identical.
"""

import io
import base64
import numpy as np
from PIL import Image, ImageFilter


def b64_to_image(data: str) -> Image.Image:
    if "," in data:  # strip a data: URL prefix if present
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def image_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def skin_mask(img: Image.Image) -> np.ndarray:
    """Return a feathered 0..1 float skin mask, shape (H, W)."""
    ycbcr = np.asarray(img.convert("YCbCr")).astype(np.int16)
    y, cb, cr = ycbcr[..., 0], ycbcr[..., 1], ycbcr[..., 2]
    mask = (
        (cr >= 135) & (cr <= 180) & (cb >= 85) & (cb <= 135) & (y >= 40)
    ).astype(np.float32)
    # feather the edges so blending has no hard seams
    m_img = Image.fromarray((mask * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(6)
    )
    return np.asarray(m_img).astype(np.float32) / 255.0


def smooth_skin(img: Image.Image, strength: float) -> Image.Image:
    """Frequency-separation smoothing, limited to the skin mask.

    strength: 0..1. Blurs skin TONE while re-injecting fine texture (pores)
    so the result doesn't look plastic.
    """
    arr = np.asarray(img).astype(np.float32)
    mask = skin_mask(img)[..., None]  # (H, W, 1)

    low = np.asarray(img.filter(ImageFilter.GaussianBlur(4))).astype(np.float32)
    fine_low = np.asarray(img.filter(ImageFilter.GaussianBlur(1))).astype(np.float32)
    high = arr - fine_low  # fine skin texture

    alpha = strength * mask
    result = arr * (1 - alpha) + low * alpha + high * (alpha * 0.6)
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8))


def process(image_b64: str, params: dict):
    """Apply the skin tool. params: { strength: 0..100 }."""
    img = b64_to_image(image_b64)
    strength = max(0.0, min(1.0, float(params.get("strength", 60)) / 100.0))
    out = smooth_skin(img, strength)
    coverage = float(skin_mask(img).mean())  # fraction detected as skin
    return image_to_b64(out), {"skinCoverage": round(coverage, 4)}
