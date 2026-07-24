"""MaskProvider — the single place that answers "where is X in this image?".

Every AI tool in this product is (mask + operation). Adding a tool means
picking a mask kind here and writing the pixel operation — not wiring up a new
model each time. Models are MediaPipe (Apache 2.0), run locally.

Mask kinds:
  subject        — everything that isn't background   (background blur)
  hair           — hair only                          (hair tones)
  face-skin      — facial skin only                   (skin smoothing / cleanup)
  body-skin      — exposed non-face skin
  eyes           — both eye openings                  (eye sparkle)
  cheeks         — cheek patches                      (rosy blush)
  face-features  — eyes+brows+lips+nose: NEVER retouch (protection mask)
"""

import hashlib
import os
import threading
from collections import OrderedDict

import cv2
import numpy as np
import mediapipe as mp

import common
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
LEFT_EYEBROW = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107]
RIGHT_EYEBROW = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336]
LIPS = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    409, 270, 269, 267, 0, 37, 39, 40, 185,
]
NOSE = [1, 2, 98, 97, 326, 327, 4, 45, 275, 220, 440]
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
                # soft per-class probabilities — required for real matting,
                # a binary argmax mask turns hair into a paper cut-out
                output_confidence_masks=True,
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


def confidence_masks(rgb: np.ndarray):
    """Per-class soft probabilities (H, W) float32, indexed by class id."""
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    result = _segmenter_instance().segment(mp_img)
    h, w = rgb.shape[:2]
    out = []
    for m in result.confidence_masks:
        arr = np.squeeze(m.numpy_view()).astype(np.float32)
        if arr.shape[0] != h or arr.shape[1] != w:
            arr = cv2.resize(arr, (w, h), interpolation=cv2.INTER_LINEAR)
        out.append(arr)
    return out


LANDMARK_MAX_DIM = 1280


class _Pt:
    """A landmark remapped into full-frame normalised coordinates."""

    __slots__ = ("x", "y", "z")

    def __init__(self, x: float, y: float, z: float = 0.0):
        self.x = x
        self.y = y
        self.z = z


def _fit(img: np.ndarray, max_dim: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = max_dim / max(h, w)
    if s >= 1.0:
        return img
    return cv2.resize(
        img, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA
    )


def _detect_on(img: np.ndarray):
    mp_img = mp.Image(
        image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(_fit(img, LANDMARK_MAX_DIM))
    )
    return _landmarker_instance().detect(mp_img).face_landmarks


def _face_landmarks(rgb: np.ndarray):
    """Face landmarks in FULL-FRAME normalised coordinates.

    MediaPipe's bundled face detector is short-range: it expects a face to fill
    a good part of the frame and silently returns nothing for a face that is,
    say, 10% of a 3648px-wide camera file. That made every landmark-based mask
    (eyes, cheeks, features) come back EMPTY on real full-resolution photos —
    silently disabling feature protection.

    So: try the whole frame first (cheap, fine for tight portraits); if that
    finds nothing, locate faces with the segmenter — which works at any scale —
    and run the landmarker on a crop of each one, mapping the results back.
    """
    h, w = rgb.shape[:2]

    faces = _detect_on(rgb)
    if faces:
        return faces

    cat = _category_map(rgb)
    face_skin = (cat == CLS_FACE_SKIN).astype(np.uint8)
    if not face_skin.any():
        return []

    n, labels, stats, _ = cv2.connectedComponentsWithStats(face_skin, connectivity=8)
    min_area = max(64, int(0.00002 * h * w))
    out = []
    for i in range(1, n):
        if int(stats[i, cv2.CC_STAT_AREA]) < min_area:
            continue
        bx = int(stats[i, cv2.CC_STAT_LEFT])
        by = int(stats[i, cv2.CC_STAT_TOP])
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        # generous padding: the skin class excludes hair, brows and lips, so the
        # real head is considerably larger than this box
        pad = int(max(bw, bh) * 0.6)
        x0 = max(0, bx - pad)
        y0 = max(0, by - pad)
        x1 = min(w, bx + bw + pad)
        y1 = min(h, by + bh + pad)
        cw, ch = x1 - x0, y1 - y0
        if cw < 32 or ch < 32:
            continue
        for lms in _detect_on(rgb[y0:y1, x0:x1]):
            out.append(
                [
                    _Pt((x0 + p.x * cw) / w, (y0 + p.y * ch) / h, getattr(p, "z", 0.0))
                    for p in lms
                ]
            )
    return out


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


_CACHE: "OrderedDict[tuple, np.ndarray]" = OrderedDict()
_CACHE_MAX = 24

# When a whole recipe is rendered, every tool receives the OUTPUT of the
# previous one — so masks would be recomputed for each step. Masks describe
# *where things are*, and retouching does not move them, so they are computed
# once from the pristine original. This is both faster and more stable.
_source = threading.local()


def set_source(rgb: np.ndarray) -> None:
    _source.rgb = rgb


def clear_source() -> None:
    _source.rgb = None


def _cache_key(rgb: np.ndarray, kind: str) -> tuple:
    # hash a small thumbnail: cheap, and identical frames hit the cache
    thumb = cv2.resize(rgb, (64, 64), interpolation=cv2.INTER_AREA)
    return (kind, rgb.shape, hashlib.blake2b(thumb.tobytes(), digest_size=16).digest())


def get_mask(rgb: np.ndarray, kind: str) -> np.ndarray:
    """Return a float32 mask in 0..1 with the same H,W as the image.

    Masks are computed at PROC_MAX_DIM and upscaled: they carry no fine detail,
    so running segmentation maths on a 20MP frame is wasted work. Results are
    cached because a tool chain asks for the same masks repeatedly.
    """
    src = getattr(_source, "rgb", None)
    if src is not None and src.shape == rgb.shape:
        rgb = src

    key = _cache_key(rgb, kind)
    hit = _CACHE.get(key)
    if hit is not None:
        _CACHE.move_to_end(key)
        return hit

    small = common.downscale(rgb)
    mask = _compute_mask(small, kind)
    mask = np.clip(common.upscale_to(mask, rgb.shape), 0.0, 1.0)

    _CACHE[key] = mask
    if len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return mask


def _compute_mask(rgb: np.ndarray, kind: str) -> np.ndarray:
    h, w = rgb.shape[:2]

    if kind == "subject":
        # delegated to the dedicated matting tool (soft alpha, crop-refined).
        # imported lazily because matting imports this module.
        from matting import subject_alpha

        return subject_alpha(rgb)

    if kind in ("hair", "face-skin", "body-skin"):
        cat = _category_map(rgb)
        if kind == "hair":
            m = (cat == CLS_HAIR)
        elif kind == "face-skin":
            m = (cat == CLS_FACE_SKIN)
        else:
            m = (cat == CLS_BODY_SKIN)
        return m.astype(np.float32)

    if kind == "face-features":
        # Everything a retoucher masks OFF before healing skin: eyes, eyebrows,
        # lips and nostrils. Removing "dark spots" inside these erases the
        # person's actual features.
        faces = _face_landmarks(rgb)
        if not faces:
            return np.zeros((h, w), dtype=np.float32)
        m = np.zeros((h, w), dtype=np.uint8)
        for lm in faces:
            fw = abs(lm[FACE_RIGHT].x - lm[FACE_LEFT].x) * w
            # Hair-bearing features need a margin (a stray lash or brow hair
            # sits outside the landmark ring). Lips and nose do not — an over-
            # generous margin there blocks healing of marks beside the mouth,
            # which is exactly where a child's food/irritation marks live.
            for idx_set, grow_ratio in (
                (LEFT_EYE, 0.030),
                (RIGHT_EYE, 0.030),
                (LEFT_EYEBROW, 0.030),
                (RIGHT_EYEBROW, 0.030),
                (LIPS, 0.004),
                (NOSE, 0.004),
            ):
                pts = np.array(
                    [[lm[i].x * w, lm[i].y * h] for i in idx_set], dtype=np.float32
                )
                hull = cv2.convexHull(pts.astype(np.int32))
                part = np.zeros((h, w), dtype=np.uint8)
                cv2.fillConvexPoly(part, hull, 255)
                g = max(1, int(fw * grow_ratio))
                part = cv2.dilate(part, np.ones((g, g), np.uint8))
                m = np.maximum(m, part)
        k = max(3, int(min(h, w) * 0.003)) | 1
        return cv2.GaussianBlur(m, (k, k), 0).astype(np.float32) / 255.0

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
