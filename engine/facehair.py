"""Facial hair — where the beard and moustache are, so no tool treats them as skin.

docs/BUGS.md BUG-006. The selfie segmenter has classes for hair, face skin and
body skin and none for facial hair, so a beard came back as 100% `face-skin`:
spot cleanup read its darkness as a huge deviation from the skin model, healed
the "marks" along its edge and smeared a soft patch across the man's beard
(measured on chayamushka-103: 752px changed by more than 20 levels, peak 143).
Two attempts to derive a beard from lightness statistics were measured and
rejected, and a third, zoned by landmarks and gated on texture, missed a full
beard entirely while marking shadows on girls' jaws. Rules cannot tell a beard
from a shadow, from head hair on a cheek or from dark background; a network
that has seen beards can.

The network is the face parser from GHOST 2.0 (ai-forever, Apache-2.0,
github.com/ai-forever/ghost-2.0, release asset `segformer_B5_ce.onnx`):
SegFormer-B5 trained on the authors' own 20k annotated images, 20 classes, one
of which is `beard`. Run on the same wide face crop the authors feed it (twice
the face width, 512x512, their mean/std). Measured on 14 faces across three
sets: all three bearded men found, beard and moustache outlined; zero beard
pixels on every woman, girl and baby. ~0.55s a face on CPU, and cached like
every other mask.

Fails CLOSED to "no facial hair" when the weights are absent — the tools then
behave exactly as they did before this existed, which is the honest fallback
for an optional model.
"""

import os
import threading

import cv2
import numpy as np

import paths

MODEL = paths.model_path("segformer_B5_ce.onnx")
SIZE = 512
BEARD = 14
# The authors' own normalisation (ghost-2.0 preprocess_image.py), RGB order.
MEAN = np.array([0.51315393, 0.48064056, 0.46301059], np.float32)
STD = np.array([0.21438347, 0.20799829, 0.20304542], np.float32)
# The crop: a square twice the landmark face width, centred a little below the
# landmark centre so the chin and the whole beard are inside it.
CROP_PER_FACE_WIDTH = 2.0
CROP_DROP_PER_FACE_WIDTH = 0.10

_lock = threading.Lock()
_session = None


def available() -> bool:
    return os.path.exists(MODEL)


def _instance():
    global _session
    with _lock:
        if _session is None:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) // 2)
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            # Same reason as birefnet.py: the arena keeps a large model's
            # activations resident and grows between runs.
            opts.enable_cpu_mem_arena = False
            _session = ort.InferenceSession(MODEL, sess_options=opts,
                                            providers=["CPUExecutionProvider"])
    return _session


# class ids of the parser (ghost-2.0: background, person, skin, left brow,
# right brow, left eye, right eye, mouth, teeth, lips, left ear, right ear,
# nose, neck, beard, hair, hat, headphone, glasses, earring)
BROWS = (3, 4)
EYES = (5, 6)
MOUTH = (7, 8, 9)
NOSE = 12
HAIR = 15
HAT = 16

_labels_cache = {}
_labels_order = []
_LABELS_KEEP = 6


def _key(rgb, faces):
    import hashlib

    thumb = cv2.resize(rgb, (32, 32), interpolation=cv2.INTER_AREA)
    marks = tuple(round(float(p.x), 3) for lm in faces for p in (lm[1], lm[152]))
    return (rgb.shape, hashlib.blake2b(thumb.tobytes(), digest_size=12).hexdigest(), marks)


def labels(rgb: np.ndarray, faces) -> np.ndarray:
    """(H, W) uint8 class id per pixel for every face in `faces`, 0 elsewhere.

    One inference per face per picture, shared by every mask kind that asks
    (beard, hair, nose, mouth, brows) — they are one question to the network.
    Where two faces' crops overlap, a pixel keeps the first answer unless that
    answer was only background/person/skin and the other face says more.
    """
    h, w = rgb.shape[:2]
    out = np.zeros((h, w), np.uint8)
    if not faces or not available():
        return out
    key = _key(rgb, faces)
    hit = _labels_cache.get(key)
    if hit is not None:
        return hit
    sess = _instance()
    for lm in faces:
        xs = np.array([p.x for p in lm]) * w
        ys = np.array([p.y for p in lm]) * h
        fw = float(xs.max() - xs.min())
        if fw < 8:
            continue
        side = int(round(fw * CROP_PER_FACE_WIDTH))
        cx = (xs.max() + xs.min()) / 2.0
        cy = (ys.max() + ys.min()) / 2.0 + fw * CROP_DROP_PER_FACE_WIDTH
        x0, y0 = int(round(cx - side / 2.0)), int(round(cy - side / 2.0))
        crop = np.zeros((side, side, 3), np.uint8)
        sx0, sy0 = max(0, x0), max(0, y0)
        sx1, sy1 = min(w, x0 + side), min(h, y0 + side)
        if sx1 <= sx0 or sy1 <= sy0:
            continue
        crop[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = rgb[sy0:sy1, sx0:sx1]
        interp = cv2.INTER_AREA if side > SIZE else cv2.INTER_LINEAR
        x = cv2.resize(crop, (SIZE, SIZE), interpolation=interp).astype(np.float32) / 255.0
        x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
        lab = sess.run(None, {"input": x})[0][0, 0].astype(np.uint8)
        # class ids: NEAREST — averaging two labels invents a third
        lab = cv2.resize(lab, (side, side), interpolation=cv2.INTER_NEAREST)
        region = lab[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0]
        dst = out[sy0:sy1, sx0:sx1]
        take = (dst <= 2) & (region > dst)
        dst[take] = region[take]
    _labels_cache[key] = out
    _labels_order.append(key)
    while len(_labels_order) > _LABELS_KEEP:
        _labels_cache.pop(_labels_order.pop(0), None)
    return out


def beard_mask(rgb: np.ndarray, faces) -> np.ndarray:
    """(H, W) float32 in 0..1 — facial hair of every face in `faces` (class 14)."""
    return (labels(rgb, faces) == BEARD).astype(np.float32)
