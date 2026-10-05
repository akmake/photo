"""The object inside a rectangle — Photoshop's Object Selection, rectangle mode.

A click is ambiguous: the bear's head or the bear with its feet, the bicycle or
the girl holding it. A rectangle drawn around the object says which. Measured
2026-10-05 on 11 objects from five shoots (kids, newborn, outdoor family,
horses): SAM 2.1 small with the rectangle took the whole object in 9 —
bicycle without the girl, father without his daughter, bear with its feet,
jar with its foot. MobileSAM (the click model) with the same rectangle bled
into the neighbour in 4 of them. Weak for a thin diagonal rope: a rectangle
around it holds half the picture; that stays with the click and the brush.

SAM 2.1 — Meta, Apache-2.0. ~0.6s per rectangle on the CPU (24 cores; not
measured on a 4-core machine).
"""

import os
import threading

import numpy as np

import paths

REPO = "facebook/sam2.1-hiera-small"
_model = None
_lock = threading.Lock()


def _load():
    global _model
    if _model is None:
        from transformers import Sam2Model, Sam2Processor

        local = os.path.join(paths.models_dir(), "sam2.1-hiera-small")
        source = local if os.path.isdir(local) else REPO
        _model = (Sam2Processor.from_pretrained(source), Sam2Model.from_pretrained(source).eval())
    return _model


def mask_in_box(small: np.ndarray, box) -> np.ndarray:
    """uint8 mask of the object inside `box` (x0, y0, x1, y1, fractions of the frame)."""
    import torch

    x0, y0, x1, y1 = (float(v) for v in box)
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        raise ValueError("The rectangle must be inside the photograph")
    h, w = small.shape[:2]
    with _lock:
        proc, model = _load()
        with torch.inference_mode():
            inp = proc(images=small, input_boxes=[[[x0 * (w - 1), y0 * (h - 1), x1 * (w - 1), y1 * (h - 1)]]],
                       return_tensors="pt")
            out = model(**inp, multimask_output=False)
        logits = proc.post_process_masks(out.pred_masks.cpu(), inp["original_sizes"], binarize=False)[0]
    mask = (logits[0, 0].numpy() > 0).astype(np.uint8)
    if not mask.any():
        raise RuntimeError("No object found inside the rectangle")
    return mask
