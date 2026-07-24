"""Shared image I/O for engine tools."""

import io
import base64

import numpy as np
from PIL import Image, ImageOps


def _upright(img: Image.Image) -> Image.Image:
    """Apply the EXIF orientation tag.

    Camera JPEGs store portrait shots as landscape plus an orientation tag.
    Browsers apply it automatically; PIL does not. Without this the engine
    would analyse a sideways image (MediaPipe finds no faces) and return a
    result rotated 90 degrees from what the UI is showing.
    """
    try:
        return ImageOps.exif_transpose(img)
    except Exception:  # noqa: BLE001 - a broken EXIF block must not kill the load
        return img


def b64_to_image(data: str) -> Image.Image:
    if "," in data:  # strip a data: URL prefix if present
        data = data.split(",", 1)[1]
    return _upright(Image.open(io.BytesIO(base64.b64decode(data)))).convert("RGB")


def load_image(path: str) -> Image.Image:
    """Open a file from disk, EXIF-corrected."""
    return _upright(Image.open(path)).convert("RGB")


def image_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def image_to_jpeg_b64(img: Image.Image, quality: int = 90) -> str:
    """Smaller than PNG — used for previews sent to the UI."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def to_np(img: Image.Image) -> np.ndarray:
    return np.asarray(img).astype(np.uint8)


def to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# Working resolution for masks and low-frequency work.
# Masks and tone layers carry no fine detail, so computing them on a 20MP frame
# is pure waste — we compute at this size and composite at full resolution.
PROC_MAX_DIM = 1600


def proc_scale(shape, max_dim: int = PROC_MAX_DIM) -> float:
    h, w = shape[:2]
    s = max_dim / max(h, w)
    return s if s < 1.0 else 1.0


def downscale(arr: np.ndarray, max_dim: int = PROC_MAX_DIM) -> np.ndarray:
    import cv2

    s = proc_scale(arr.shape, max_dim)
    if s >= 1.0:
        return arr
    h, w = arr.shape[:2]
    return cv2.resize(
        arr, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA
    )


def upscale_to(arr: np.ndarray, shape) -> np.ndarray:
    """Resize a low-frequency layer or mask back up to the full frame."""
    import cv2

    h, w = shape[:2]
    if arr.shape[0] == h and arr.shape[1] == w:
        return arr
    return cv2.resize(arr, (w, h), interpolation=cv2.INTER_LINEAR)


def region_box(mask: np.ndarray, pad: int, shape) -> tuple:
    """Bounding box of a mask, padded and clipped. None if the mask is empty.

    Facial tools only need the face, not the whole 20MP frame. Cropping to this
    box lets them run at FULL resolution (which blemish detection needs) while
    doing a fraction of the work.
    """
    ys, xs = np.where(mask > 0.01)
    if xs.size == 0:
        return None
    h, w = shape[:2]
    return (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(w, int(xs.max()) + pad + 1),
        min(h, int(ys.max()) + pad + 1),
    )


def clamp01(v, default=0.0) -> float:
    try:
        return max(0.0, min(1.0, float(v) / 100.0))
    except (TypeError, ValueError):
        return default
