"""MaskProvider — the single place that answers "where is X in this image?".

Every AI tool in this product is (mask + operation). Adding a tool means
picking a mask kind here and writing the pixel operation — not wiring up a new
model each time. Models are MediaPipe (Apache 2.0), run locally.

Mask kinds:
  subject     — everything that isn't background   (background blur)
  hair        — hair only                          (hair tones)
  face-skin   — facial skin only                   (skin smoothing / cleanup)
  body-skin   — exposed non-face skin
  eyes        — both eye openings                  (eye sparkle)
  cheeks      — cheek patches                      (rosy blush)
"""

import os
import threading

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# selfie_multiclass_256x256 class ids
CLS_BACKGROUND = 0
CLS_HAIR = 1
CLS_BODY_SKIN = 2
CLS_FACE_SKIN = 3
CLS_CLOTHES = 4

_lock = threading.Lock()
_segmenter = None
_landmarker = None

# FaceMesh landmark index sets
LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
LEFT_CHEEK_CENTER = 50
RIGHT_CHEEK_CENTER = 280
FACE_LEFT = 234
FACE_RIGHT = 454


def _segmenter_instance():
    global _segmenter
    with _lock:
        if _segmenter is None:
            opts = vision.ImageSegmenterOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=os.path.join(
                        MODELS_DIR, "selfie_multiclass_256x256.tflite"
                    )
                ),
                output_category_mask=True,
            )
            _segmenter = vision.ImageSegmenter.create_from_options(opts)
    return _segmenter


def _landmarker_instance():
    global _landmarker
    with _lock:
        if _landmarker is None:
            opts = vision.FaceLandmarkerOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=os.path.join(MODELS_DIR, "face_landmarker.task")
                ),
                num_faces=6,
            )
            _landmarker = vision.FaceLandmarker.create_from_options(opts)
    return _landmarker


def _category_map(rgb: np.ndarray) -> np.ndarray:
    """Per-pixel class ids from the multiclass selfie segmenter."""
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    result = _segmenter_instance().segment(mp_img)
    # some builds return (H, W, 1) — masks must always be 2-D
    cat = np.squeeze(result.category_mask.numpy_view())
    h, w = rgb.shape[:2]
    if cat.shape[0] != h or cat.shape[1] != w:
        cat = cv2.resize(cat, (w, h), interpolation=cv2.INTER_NEAREST)
    return cat


def _face_landmarks(rgb: np.ndarray):
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    return _landmarker_instance().detect(mp_img).face_landmarks


def _poly_mask(rgb: np.ndarray, polys, feather_px: int) -> np.ndarray:
    h, w = rgb.shape[:2]
    m = np.zeros((h, w), dtype=np.uint8)
    for poly in polys:
        if len(poly) >= 3:
            cv2.fillPoly(m, [np.array(poly, dtype=np.int32)], 255)
    if feather_px > 0:
        k = feather_px * 2 + 1
        m = cv2.GaussianBlur(m, (k, k), 0)
    return m.astype(np.float32) / 255.0


def get_mask(rgb: np.ndarray, kind: str) -> np.ndarray:
    """Return a float32 mask in 0..1 with the same H,W as the image."""
    h, w = rgb.shape[:2]

    if kind in ("subject", "hair", "face-skin", "body-skin"):
        cat = _category_map(rgb)
        if kind == "subject":
            # Everything non-background includes stray "clothes" — e.g. laundry
            # on a line. Keep only components that contain an actual person
            # (skin or hair), so hanging garments and props drop out.
            foreground = (cat != CLS_BACKGROUND).astype(np.uint8)
            person = (
                (cat == CLS_FACE_SKIN) | (cat == CLS_BODY_SKIN) | (cat == CLS_HAIR)
            )
            count, labels = cv2.connectedComponents(foreground)
            if count > 1 and person.any():
                keep = np.unique(labels[person])
                keep = keep[keep != 0]
                m = np.isin(labels, keep)
            else:
                m = foreground.astype(bool)
        elif kind == "hair":
            m = (cat == CLS_HAIR)
        elif kind == "face-skin":
            m = (cat == CLS_FACE_SKIN)
        else:
            m = (cat == CLS_BODY_SKIN)
        return m.astype(np.float32)

    if kind in ("eyes", "cheeks"):
        faces = _face_landmarks(rgb)
        if not faces:
            return np.zeros((h, w), dtype=np.float32)

        if kind == "eyes":
            polys = []
            for lm in faces:
                for idx_set in (LEFT_EYE, RIGHT_EYE):
                    polys.append([(lm[i].x * w, lm[i].y * h) for i in idx_set])
            return _poly_mask(rgb, polys, feather_px=max(1, int(min(h, w) * 0.002)))

        # cheeks: soft discs sized relative to each face
        m = np.zeros((h, w), dtype=np.uint8)
        for lm in faces:
            fw = abs(lm[FACE_RIGHT].x - lm[FACE_LEFT].x) * w
            r = max(3, int(fw * 0.16))
            for idx in (LEFT_CHEEK_CENTER, RIGHT_CHEEK_CENTER):
                cv2.circle(m, (int(lm[idx].x * w), int(lm[idx].y * h)), r, 255, -1)
        k = max(3, int(min(h, w) * 0.02)) | 1
        m = cv2.GaussianBlur(m, (k, k), 0)
        return m.astype(np.float32) / 255.0

    raise ValueError(f"unknown mask kind: {kind}")
