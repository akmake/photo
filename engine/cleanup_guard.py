"""Enforce the pixel boundary between a retoucher and the original photograph.

This is a compositor, not a blemish or beard detector. Its preservation
guarantee applies to the supplied masks; mask accuracy needs separate visual
validation. It deliberately does not resize model predictions or masks.
"""
from __future__ import annotations

import cv2
import numpy as np


def _mask(value, shape, name):
    array = np.asarray(value)
    if array.shape != shape:
        raise ValueError(f"{name} must have the original image dimensions")
    if array.dtype != np.bool_:
        raise ValueError(f"{name} must be an explicit boolean mask")
    return array


def compose(original, prediction, repair, protected, *, feather_px=3):
    """Apply only requested repairs, with immutable protected/source pixels.

    Feathering runs INSIDE the allowed repair support. A model changing the
    whole face therefore cannot write into the background, a protected lash,
    or unselected skin. uint8 RGB at native resolution is the public contract.
    """
    source = np.asarray(original)
    candidate = np.asarray(prediction)
    if source.ndim != 3 or source.shape[2] != 3 or source.dtype != np.uint8:
        raise ValueError("original must be uint8 RGB")
    if candidate.shape != source.shape or candidate.dtype != np.uint8:
        raise ValueError("prediction must be uint8 RGB at original resolution")
    requested = _mask(repair, source.shape[:2], "repair")
    forbidden = _mask(protected, source.shape[:2], "protected")
    if not np.isfinite(feather_px) or feather_px < 0:
        raise ValueError("feather_px must be finite and non-negative")
    support = requested & ~forbidden
    alpha = support.astype(np.float32)
    if feather_px > 0 and support.any():
        # Explicit exterior zeros also handle a repair touching the frame edge.
        padded = np.pad(support.astype(np.uint8), 1)
        distance = cv2.distanceTransform(padded, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)[1:-1, 1:-1]
        t = np.clip(distance / float(feather_px), 0, 1)
        alpha = t * t * (3 - 2 * t)
        alpha[~support] = 0
    result = source.copy()
    if support.any():
        mixed = source[support].astype(np.float32) + alpha[support, None] * (
            candidate[support].astype(np.float32) - source[support].astype(np.float32)
        )
        result[support] = np.clip(np.rint(mixed), 0, 255).astype(np.uint8)
    changed = np.any(result != source, axis=2)
    return result, {
        "requestedPx": int(requested.sum()),
        "blockedPx": int((requested & forbidden).sum()),
        "changedPx": int(changed.sum()),
        "protectedChangedPx": int((changed & forbidden).sum()),
        "outsideRepairChangedPx": int((changed & ~requested).sum()),
    }
