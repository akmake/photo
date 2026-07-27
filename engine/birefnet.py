"""Subject alpha from BiRefNet (ONNX, MIT) — the high-resolution mask backend.

The MediaPipe selfie segmenter this replaces takes a 256x256 input. On a
4160px frame that is one mask pixel per 16 image pixels, so hair comes back as
cardboard and any grade applied through the mask leaves a halo. BiRefNet runs
at 1024x1024 — sixteen times the mask detail — which is what makes it possible
to grade the subject and the background differently without the seam showing.

Nothing here generates pixels. The model returns one channel: how much of each
pixel belongs to the subject.

Kept deliberately dependency-light: plain onnxruntime on the same session the
rest of the engine uses, no timm, no transformers, no trust_remote_code.
"""

import os
import threading

import cv2
import numpy as np

MODEL = os.path.join(os.path.dirname(__file__), "models", "birefnet_lite.onnx")
SIZE = 1024

# ImageNet normalisation — from the model's own preprocessor_config.json.
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

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
            # The engine already serialises image work onto one worker thread;
            # letting ORT spawn its own pool on top just thrashes the cache.
            opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) // 2)
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            _session = ort.InferenceSession(
                MODEL, sess_options=opts, providers=["CPUExecutionProvider"]
            )
    return _session


def _prep(rgb: np.ndarray) -> np.ndarray:
    small = cv2.resize(rgb, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
    x = small.astype(np.float32) / 255.0
    x = (x - MEAN) / STD
    return np.ascontiguousarray(x.transpose(2, 0, 1)[None])


def subject_alpha(rgb: np.ndarray) -> np.ndarray:
    """(H, W) float32 alpha in 0..1. Raises if the model is missing."""
    if not available():
        raise FileNotFoundError(f"BiRefNet weights not found at {MODEL}")

    sess = _instance()
    out = sess.run(None, {"input_image": _prep(rgb)})[0]

    alpha = np.squeeze(out).astype(np.float32)
    if alpha.min() < 0.0 or alpha.max() > 1.0:  # some exports emit logits
        alpha = 1.0 / (1.0 + np.exp(-alpha))

    h, w = rgb.shape[:2]
    alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LINEAR)

    # The model is sharp but works at 1024; snapping the upscaled alpha to the
    # real image edges recovers the strand detail the resize softens.
    if hasattr(cv2, "ximgproc"):
        try:
            radius = max(4, int(0.006 * max(h, w)))
            a8 = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
            refined = cv2.ximgproc.guidedFilter(rgb, a8, radius, 250.0)
            alpha = refined.astype(np.float32) / 255.0
        except cv2.error:
            pass

    return np.clip(alpha, 0.0, 1.0)
