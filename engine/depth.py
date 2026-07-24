"""Monocular depth estimation — MiDaS small (MIT) via onnxruntime.

This is what turns "cut out the person and blur everything behind" into an
actual lens simulation: blur grows with distance from the subject's plane,
so the ground at their feet stays sharp while the far trees melt away.
"""

import os
import threading

import cv2
import numpy as np
import onnxruntime as ort

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "midas_small.onnx")

_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_lock = threading.Lock()
_session = None
_input_name = None
_input_hw = (256, 256)


def _session_instance():
    global _session, _input_name, _input_hw
    with _lock:
        if _session is None:
            _session = ort.InferenceSession(
                MODEL_PATH, providers=["CPUExecutionProvider"]
            )
            inp = _session.get_inputs()[0]
            _input_name = inp.name
            h = inp.shape[2] if isinstance(inp.shape[2], int) else 256
            w = inp.shape[3] if isinstance(inp.shape[3], int) else 256
            _input_hw = (h, w)
    return _session


def get_depth(rgb: np.ndarray) -> np.ndarray:
    """Relative INVERSE depth normalised to 0..1 — 1 = closest to camera."""
    sess = _session_instance()
    h, w = _input_hw

    img = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    img = (img - _IMAGENET_MEAN) / _IMAGENET_STD
    tensor = np.transpose(img, (2, 0, 1))[None, ...].astype(np.float32)

    out = np.squeeze(sess.run(None, {_input_name: tensor})[0])
    out = cv2.resize(out, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_CUBIC)

    lo, hi = float(out.min()), float(out.max())
    if hi - lo < 1e-6:
        return np.zeros(rgb.shape[:2], dtype=np.float32)
    return ((out - lo) / (hi - lo)).astype(np.float32)
