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

MODEL = os.path.join(os.path.dirname(__file__), "models", "segformer_B5_ce.onnx")
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


def beard_mask(rgb: np.ndarray, faces) -> np.ndarray:
    """(H, W) float32 in 0..1 — facial hair of every face in `faces`.

    `faces` are landmark lists in normalised frame coordinates (masks'
    `_face_landmarks`). Crops that run past the frame are padded with black,
    so a face at the edge of a tight crop is still seen at its own proportions.
    """
    h, w = rgb.shape[:2]
    out = np.zeros((h, w), np.float32)
    if not faces or not available():
        return out
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
        labels = sess.run(None, {"input": x})[0][0, 0]
        beard = (labels == BEARD).astype(np.float32)
        if not beard.any():
            continue
        # Back to the crop's own size, smoothly — a 512 label edge blown up to a
        # 1500px crop would otherwise be a staircase.
        beard = cv2.resize(beard, (side, side), interpolation=cv2.INTER_LINEAR)
        region = beard[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0]
        out[sy0:sy1, sx0:sx1] = np.maximum(out[sy0:sy1, sx0:sx1], region)
    return np.clip(out, 0.0, 1.0)
