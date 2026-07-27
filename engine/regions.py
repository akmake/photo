"""Class-agnostic region segmentation for pixel_color's material anchors.

Where masks.py answers "where is X" for a small, known set of semantic
classes (skin, hair, subject...), this answers "what are the materially
distinct regions in this photo" without knowing what any of them ARE --
flowers, foliage, a horse, a wooden post, whatever a given shoot happens to
contain. `_fit_anchors` in pixel_color.py groups pixels by colour alone, so
two unrelated materials that coincide in Lab space get merged into one
anchor with a delta that fits neither (see docs/opo.md section 8/10). A
class-agnostic segmentation run fresh on every photo -- teach AND every
photo it's applied to -- is what lets a material anchor's identity survive
across photos, the same way the skin model's mask does.

Backed by MobileSAM (ChaoningZhang/MobileSAM, Apache 2.0 -- verified against
the repo's own LICENSE file, not from memory). No text prompts, no fixed
category list: it finds "this hangs together" the same way for a flower, a
shirt, or a fence post.
"""

import hashlib
import os
import threading
from collections import OrderedDict

import cv2
import numpy as np

import common

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# Matches pixel_color.WORK_MAX: the encoder resizes to a fixed internal
# resolution regardless of what we hand it, so there is little speed to gain
# from downscaling further -- this just keeps fit-time and apply-time
# segmentation granularity comparable.
REGION_MAX_DIM = 900
# A region smaller than this fraction of the (downscaled) frame is too small
# to trust as its own "material" -- same role as MIN_SKIN_SAMPLES: a couple
# of stray proposal pixels should not become a whole anchor.
MIN_REGION_FRACTION = 0.002
POINTS_PER_SIDE = 16
PRED_IOU_THRESH = 0.86
STABILITY_SCORE_THRESH = 0.90
BOX_NMS_THRESH = 0.7

_lock = threading.Lock()
_generator = None

# Same reasoning as masks.py: a whole recipe re-derives masks/regions per
# tool unless everyone segments the one pristine source image.
_source = threading.local()

_CACHE: "OrderedDict[tuple, tuple]" = OrderedDict()
# Heavier per entry than masks.py's float masks (a label map + stats list),
# and segmentation is the expensive part of this module -- keep fewer around.
_CACHE_MAX = 8


def _generator_instance():
    global _generator
    with _lock:
        if _generator is None:
            from mobile_sam import SamAutomaticMaskGenerator, sam_model_registry

            sam = sam_model_registry["vit_t"](
                checkpoint=os.path.join(MODELS_DIR, "mobile_sam.pt")
            )
            sam.eval()
            _generator = SamAutomaticMaskGenerator(
                sam,
                points_per_side=POINTS_PER_SIDE,
                pred_iou_thresh=PRED_IOU_THRESH,
                stability_score_thresh=STABILITY_SCORE_THRESH,
                box_nms_thresh=BOX_NMS_THRESH,
            )
    return _generator


def set_source(rgb: np.ndarray) -> None:
    _source.rgb = rgb


def clear_source() -> None:
    _source.rgb = None


def _cache_key(rgb: np.ndarray) -> tuple:
    thumb = cv2.resize(rgb, (64, 64), interpolation=cv2.INTER_AREA)
    return (rgb.shape, hashlib.blake2b(thumb.tobytes(), digest_size=16).digest())


def _texture(gray: np.ndarray, mask: np.ndarray) -> float:
    """Mean local gradient magnitude inside a region.

    A cheap way to tell a smooth petal from a fibrous material (bark, fabric
    weave) that happens to share a similar average colour -- used only to
    break near-ties at match time, colour stays the primary evidence.
    """
    if not mask.any():
        return 0.0
    edges = np.hypot(
        cv2.Sobel(gray, cv2.CV_32F, 1, 0, 3), cv2.Sobel(gray, cv2.CV_32F, 0, 1, 3)
    )
    return float(edges[mask].mean())


def get_regions(rgb: np.ndarray):
    """Class-agnostic materially-distinct regions.

    Returns (labels, stats): labels is int32 (H,W), same shape as `rgb`,
    -1 where no region claimed the pixel; stats is a list of dicts
    {"id", "area", "meanLab": (L,a,b), "texture"}, one per kept region.
    Overlapping proposals are resolved in favour of the largest first, so a
    pixel's label is always its biggest, most-confident covering region.
    """
    src = getattr(_source, "rgb", None)
    if src is not None and src.shape == rgb.shape:
        rgb = src

    key = _cache_key(rgb)
    hit = _CACHE.get(key)
    if hit is not None:
        _CACHE.move_to_end(key)
        return hit

    small = common.downscale(rgb, REGION_MAX_DIM)
    height, width = small.shape[:2]
    min_area = max(64, int(height * width * MIN_REGION_FRACTION))

    try:
        proposals = _generator_instance().generate(small)
    except Exception:
        proposals = []

    proposals = sorted(
        (p for p in proposals if p["area"] >= min_area),
        key=lambda p: p["area"],
        reverse=True,
    )

    lab = cv2.cvtColor(small, cv2.COLOR_RGB2LAB).astype(np.float32)
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY).astype(np.float32)

    labels = np.full((height, width), -1, np.int32)
    stats = []
    for region_id, proposal in enumerate(proposals):
        mask = proposal["segmentation"] & (labels == -1)
        area = int(mask.sum())
        if area < min_area:
            continue
        labels[mask] = region_id
        stats.append(
            {
                "id": region_id,
                "area": area,
                "meanLab": tuple(float(v) for v in lab[mask].mean(axis=0)),
                "texture": _texture(gray, mask),
            }
        )

    if labels.shape[:2] != rgb.shape[:2]:
        labels = cv2.resize(
            labels,
            (rgb.shape[1], rgb.shape[0]),
            interpolation=cv2.INTER_NEAREST,
        )

    result = (labels, stats)
    _CACHE[key] = result
    if len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return result
