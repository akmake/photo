"""The whole person under a click.

WHY. A click on a person came back as the part under the cursor: the hair, a
leg, the dress without the legs, a shoe — and on two girls hugging, both girls
and pieces of the bridge under them. Measured 2026-10-14 on 321A9582 (8 clicks,
one girl): only 2 of 8 took the whole girl (docs/OBJECT-REMOVE-TIMELINE.md).
The click model (MobileSAM) answers "the thing under the point", and the old
growth (object_remove._whole_person) only grew UP to the face, and only from
parts the selfie segmenter calls "person" — legs, trousers and shoes of a
person seen whole are not that.

HOW — the usual pairing of a detector and a segmenter:
1. A person detector (EfficientDet-Lite0, COCO; Google MediaPipe, Apache-2.0,
   4.6MB, tens of ms on the CPU) gives every person's WHOLE-BODY box, and the
   boxes of what they hold or stand by (bicycle, horse...).
2. The clicked person's box goes to SAM 2.1 (box_select, the rectangle model),
   with the click as "this" and the other objects in the box as "not this".
3. Two people the detector saw as one (a hug) are told apart by their faces:
   the clicked one keeps the columns nearest its own face.
4. What SAM still gave of a held object (the bicycle's wheel) is taken off,
   except where the person map says it is a person (the hand on the handlebar).

Measured 2026-10-14, 9 photos from 3 shoots (outdoor family, horses,
newborn), 89 automatic clicks on face, hair, clothes and feet: each person
whole and alone, the same from every part, the hover line equal to the click
(IoU >= 0.98) in 87 of 89. Known misses (docs/OBJECT-REMOVE-TIMELINE.md): a
parent holding a baby takes the baby too; a click off every person box (the
ground by a horse) falls back to the click model. A click that is not on a
person returns None and the click model answers as before.
"""

import os
import threading

import cv2
import numpy as np

import paths

MODEL = "efficientdet_lite0.tflite"
#: Detections below this are not used. The child in 321A4983 is 0.43, the man
#: seen from behind 0.36; nothing false above 0.25 in the set.
SCORE_MIN = 0.25
#: How far outside a person's box a click still counts as on that person, as a
#: fraction of the box: sides and top, and below (feet hanging off a bridge
#: fall under a seated person's box, 321A9703).
CLICK_MARGIN, CLICK_MARGIN_BELOW = 0.03, 0.15

_lock = threading.Lock()
_detector = None
_cache = {}
_entries_cache = {}


def available() -> bool:
    return os.path.isfile(os.path.join(paths.models_dir(), MODEL))


def _instance():
    global _detector
    with _lock:
        if _detector is None:
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision

            _detector = vision.ObjectDetector.create_from_options(vision.ObjectDetectorOptions(
                base_options=mp_python.BaseOptions(model_asset_path=os.path.join(paths.models_dir(), MODEL)),
                score_threshold=SCORE_MIN, max_results=30))
    return _detector


def detect(small: np.ndarray, key=None) -> list:
    """-> [(name, score, x0, y0, x1, y1)] in pixels of `small`."""
    if key is not None and key in _cache:
        return _cache[key]
    import mediapipe as mp

    res = _instance().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(small)))
    out = []
    for d in res.detections:
        b, c = d.bounding_box, d.categories[0]
        out.append((c.category_name, float(c.score), float(b.origin_x), float(b.origin_y),
                    float(b.origin_x + b.width), float(b.origin_y + b.height)))
    if key is not None:
        if len(_cache) > 16:
            _cache.pop(next(iter(_cache)))
        _cache[key] = out
    return out


def _faces(small):
    import masks

    sh, sw = small.shape[:2]
    # at twice the working size: small faces in a group are under the
    # landmarker's floor at 1024 (same as object_remove._whole_person)
    big = cv2.resize(small, (sw * 2, sh * 2), interpolation=cv2.INTER_CUBIC)
    return [((a + c) / 4, (b + d) / 4, (c - a) / 2) for a, b, c, d in masks.face_boxes(big)]


def _sam(small, box, pos, neg):
    import torch

    import box_select

    pts = [[float(p[0]), float(p[1])] for p in list(pos) + list(neg)]
    labels = [1] * len(pos) + [0] * len(neg)
    proc, model = box_select._load()
    with box_select._lock, torch.inference_mode():
        inp = proc(images=small, input_boxes=[[[float(v) for v in box]]],
                   input_points=[[pts]], input_labels=[[labels]], return_tensors="pt")
        out = model(**inp, multimask_output=False)
        logits = proc.post_process_masks(out.pred_masks.cpu(), inp["original_sizes"], binarize=False)[0]
    return logits[0, 0].numpy() > 0


def _entries(small, key):
    """Every person in the photograph, as (box, positive points, negative points).

    Built once per photograph. Two people the detector saw as one box (a hug)
    become two entries, split by their faces. No segmentation here.
    """
    hit = _entries_cache.get(key) if key is not None else None
    if hit is not None:
        return hit
    import masks

    sh, sw = small.shape[:2]
    dets = detect(small, key)
    faces = _faces(small)
    cat = masks._category_map(small)
    person_px = cat != masks.CLS_BACKGROUND
    out = []
    for d in dets:
        if d[0] != "person":
            continue
        bw, bh = d[4] - d[2], d[5] - d[3]
        x0, y0 = max(0.0, d[2] - 0.03 * bw), max(0.0, d[3] - 0.02 * bh)
        x1, y1 = min(sw - 1.0, d[4] + 0.03 * bw), min(sh - 1.0, d[5] + 0.04 * bh)
        inside = sorted([f for f in faces if x0 <= f[0] <= x1 and y0 <= f[1] <= y1], key=lambda f: f[0])
        others = [o for o in dets if o is not d and o[2] < x1 and o[4] > x0 and o[3] < y1 and o[5] > y0]
        groups = [(None, x0, x1)]
        if len(inside) > 1:
            cuts = [(a[0] + b[0]) / 2 for a, b in zip(inside, inside[1:])]
            groups = []
            for k, own in enumerate(inside):
                pad = 0.6 * own[2]
                lo = max(x0, cuts[k - 1] - pad) if k > 0 else x0
                hi = min(x1, cuts[k] + pad) if k < len(cuts) else x1
                groups.append((own, lo, hi))
        for own, lo, hi in groups:
            if own is not None:
                pos = [(own[0], own[1])]
            elif len(inside) == 1:
                pos = [(inside[0][0], inside[0][1])]
            else:
                # no face (seen from behind): the person pixel nearest the box centre
                ys, xs = np.nonzero(person_px[int(y0):int(y1) + 1, int(lo):int(hi) + 1])
                cx, cy = (lo + hi) / 2 - lo, (y0 + y1) / 2 - y0
                if len(ys):
                    i = int(np.argmin((xs - cx) ** 2 + (ys - cy) ** 2))
                    pos = [(xs[i] + lo, ys[i] + y0)]
                else:
                    pos = [((lo + hi) / 2, (y0 + y1) / 2)]
            neg = [(f[0], f[1]) for f in inside if f is not own and own is not None]
            for o in others:
                ox, oy = (o[2] + o[4]) / 2, (o[3] + o[5]) / 2
                if lo <= ox <= hi and y0 <= oy <= y1:
                    neg.append((ox, oy))
            held = [o for o in others if o[0] != "person"]
            out.append({"box": (lo, y0, hi, y1), "det": d, "pos": pos, "neg": neg, "held": held})
    if key is not None:
        if len(_entries_cache) > 16:
            _entries_cache.pop(next(iter(_entries_cache)))
        _entries_cache[key] = out
    return out


def _mask_of(small, entry):
    """The entry's whole-person mask, made once."""
    if "mask" in entry:
        return entry["mask"]
    import masks

    x0, y0, x1, y1 = entry["box"]
    mask = _sam(small, entry["box"], entry["pos"], entry["neg"])
    if entry["held"]:
        cat = masks._category_map(small)
        personish = cv2.dilate((cat != masks.CLS_BACKGROUND).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        for o in entry["held"]:
            om = _sam(small, o[2:6], [((o[2] + o[4]) / 2, (o[3] + o[5]) / 2)], entry["pos"])
            mask &= ~(om & ~personish)
    clip = np.zeros_like(mask)
    clip[int(y0):int(y1) + 1, int(x0):int(x1) + 1] = True
    mask &= clip
    entry["mask"] = mask if mask.any() else None
    return entry["mask"]


def _choose(entries, px, py):
    """The entry a click at (px, py) is on: of those whose box holds it (a little
    beyond, more so below — feet off a bridge), the one it sits deepest in."""
    def holds(e):
        x0, y0, x1, y1 = e["box"]
        bw, bh = x1 - x0, y1 - y0
        return (x0 - CLICK_MARGIN * bw <= px <= x1 + CLICK_MARGIN * bw
                and y0 - CLICK_MARGIN * bh <= py <= y1 + CLICK_MARGIN_BELOW * bh)

    def depth(e):
        x0, y0, x1, y1 = e["box"]
        return min(px - x0, x1 - px) / (x1 - x0) + min(py - y0, y1 - py) / (y1 - y0)

    mine = [e for e in entries if holds(e)]
    return max(mine, key=depth) if mine else None


def person_at(small: np.ndarray, x: float, y: float, key=None):
    """bool mask of the whole person under a normalized click, or None."""
    if not available():
        return None
    sh, sw = small.shape[:2]
    entry = _choose(_entries(small, key), x * (sw - 1), y * (sh - 1))
    return None if entry is None else _mask_of(small, entry)


def prepare(small: np.ndarray, key) -> int:
    """Make every person's mask ahead of the first click, so the line that
    follows the pointer can show the whole person. On the image worker."""
    if not available():
        return 0
    entries = _entries(small, key)
    for e in entries:
        _mask_of(small, e)
    return len(entries)


def ready_at(key, x: float, y: float, shape):
    """The person under the pointer IF already made (prepare / an earlier
    click); never computes — the hover runs off the image worker."""
    entries = _entries_cache.get(key)
    if not entries:
        return None
    sh, sw = shape[:2]
    entry = _choose(entries, x * (sw - 1), y * (sh - 1))
    return None if entry is None else entry.get("mask")
