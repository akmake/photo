"""Per-photo object removal: click selection and reproducible local fill.

The selected mask is stored in the recipe as PNG bytes. It is deliberately
independent of a fresh segmentation run: preview and export use the same
selection, scaled to their respective frame sizes.
"""

import base64
import threading

import cv2
import numpy as np

import lama_fill
import manual_clean
import paths

SELECT_MAX_DIM = 1024
DEFAULT_MARGIN = 0.003  # fraction of frame width
SWALLOW = 12  # a candidate this much larger than the click is the scene, not it
_predictor = None
_predict_lock = threading.Lock()


def _choose_candidate(candidates: np.ndarray, scores: np.ndarray) -> int:
    """Prefer the enclosing object when the predictor also offers a part.

    A shirt can score a little higher than the whole person. Keep the broader
    candidate only when it contains the precise one, is similarly confident,
    and is not the scene itself: past half the frame, or more than SWALLOW
    times the area it was supposed to extend, it is no longer that object.
    A subject can legitimately fill a third of a portrait, so the guard is a
    ratio to what was clicked, not a small fixed share of the frame. The caller
    still receives every candidate for visual review.
    """
    best = int(np.argmax(scores))
    core = candidates[best].astype(bool)
    core_area = int(core.sum())
    if not core_area:
        return best
    eligible = [best]
    for index, candidate in enumerate(candidates):
        if index == best or float(scores[index]) < float(scores[best]) - 0.03:
            continue
        expanded = candidate.astype(bool)
        area = int(expanded.sum())
        if area <= core_area or area > SWALLOW * core_area:
            continue
        if area / expanded.size > 0.5:
            continue
        if np.count_nonzero(core & expanded) / core_area < 0.85:
            continue
        eligible.append(index)
    return max(eligible, key=lambda index: int(candidates[index].sum()))


def _mask_data(mask: np.ndarray) -> str:
    ok, png = cv2.imencode(".png", (mask > 0).astype(np.uint8) * 255)
    if not ok:
        raise RuntimeError("Could not encode object mask")
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _read_mask(data: str, shape: tuple) -> np.ndarray:
    if not isinstance(data, str) or not data.startswith("data:image/png;base64,"):
        raise ValueError("Object removal requires a PNG selection mask")
    try:
        raw = base64.b64decode(data.split(",", 1)[1], validate=True)
        if len(raw) > 16_000_000:
            raise ValueError("Object mask is too large")
        mask = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValueError("Invalid object mask") from exc
    if mask is None or mask.size == 0:
        raise ValueError("Invalid object mask")
    h, w = shape[:2]
    return (cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST) > 127).astype(np.uint8)


def select(rgb: np.ndarray, x: float, y: float) -> dict:
    """Choose a MobileSAM mask at a normalized click; the user must review it."""
    if not (0 <= x <= 1 and 0 <= y <= 1):
        raise ValueError("Selection point must be inside the photograph")
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("Selection requires an RGB photograph")
    h, w = rgb.shape[:2]
    scale = min(1.0, SELECT_MAX_DIM / max(h, w))
    small = cv2.resize(rgb, (max(1, round(w * scale)), max(1, round(h * scale))),
                       interpolation=cv2.INTER_AREA) if scale < 1 else rgb
    global _predictor
    with _predict_lock:
        if _predictor is None:
            from mobile_sam import SamPredictor, sam_model_registry

            import os
            checkpoint = os.path.join(paths.models_dir(), "mobile_sam.pt")
            if not os.path.isfile(checkpoint):
                raise RuntimeError("MobileSAM model is unavailable")
            model = sam_model_registry["vit_t"](checkpoint=checkpoint).eval()
            _predictor = SamPredictor(model)
        _predictor.set_image(small)
        sh, sw = small.shape[:2]
        point = np.array([[min(sw - 1, round(x * (sw - 1))),
                           min(sh - 1, round(y * (sh - 1)))]])
        candidates, scores, _ = _predictor.predict(
            point_coords=point, point_labels=np.array([1]), multimask_output=True,
        )
    if len(candidates) == 0:
        raise RuntimeError("No object mask found at the selected point")
    index = _choose_candidate(candidates, scores)
    mask = candidates[index].astype(np.uint8)
    if not mask.any():
        raise RuntimeError("No object mask found at the selected point")
    alternatives = [
        {"maskPng": _mask_data(candidate), "coverage": round(float(candidate.mean()), 5),
         "score": round(float(score), 4)}
        for candidate, score in zip(candidates, scores)
    ]
    return {**alternatives[index], "width": sw, "height": sh,
            "selectedIndex": index, "candidates": alternatives}


def repair_mask(shape: tuple, selection: dict) -> np.ndarray:
    """Expand the chosen object, then apply hand corrections at render size."""
    h, w = shape[:2]
    mask = _read_mask(selection.get("maskPng"), shape)
    # Hand-added pixels are part of the object too. Growing only the model's
    # mask left a halo around the very corrections the photographer made.
    add = manual_clean.strokes_mask(shape, selection.get("add") or [])
    mask = np.maximum(mask, add)
    margin = float(selection.get("margin", DEFAULT_MARGIN))
    if not (0 <= margin <= 0.03):
        raise ValueError("Object mask margin must be between 0 and 0.03")
    radius = round(margin * w)
    if radius:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                            (2 * radius + 1, 2 * radius + 1))
        mask = cv2.dilate(mask, kernel)
    subtract = manual_clean.strokes_mask(shape, selection.get("subtract") or [])
    mask[subtract > 0] = 0
    return mask


def apply(rgb: np.ndarray, params: dict):
    selection = params.get("objectSelection")
    if not isinstance(selection, dict):
        raise ValueError("Object removal requires a saved selection")
    mask = repair_mask(rgb.shape, selection)
    count = int(mask.sum())
    if not count:
        return rgb, {"removedPx": 0, "filler": "none"}
    if not lama_fill.available():
        raise RuntimeError("LaMa model is unavailable for object removal")
    out = lama_fill.fill(rgb, mask, context=1.0)
    return out, {"removedPx": count, "filler": "lama",
                 "coverage": round(count / mask.size, 5)}
