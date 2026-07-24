"""Shared image I/O for engine tools."""

import io
import base64

import numpy as np
from PIL import Image


def b64_to_image(data: str) -> Image.Image:
    if "," in data:  # strip a data: URL prefix if present
        data = data.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")


def image_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def to_np(img: Image.Image) -> np.ndarray:
    return np.asarray(img).astype(np.uint8)


def to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def clamp01(v, default=0.0) -> float:
    try:
        return max(0.0, min(1.0, float(v) / 100.0))
    except (TypeError, ValueError):
        return default
