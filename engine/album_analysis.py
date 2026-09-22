"""Local content analysis for album layout and crop decisions.

The output is deliberately geometric and explainable: normalised face and
subject boxes, a focal point, and a basic technical-quality score. The album
editor uses these facts to score layouts; the model never silently crops.
"""

import hashlib
import json
import os

import cv2
import numpy as np

import album_palette
import common
import masks


def _box_from_points(points, pad_x=0.0, pad_y=0.0):
    xs = [float(p.x) for p in points]
    ys = [float(p.y) for p in points]
    if not xs or not ys:
        return None
    x0 = max(0.0, min(xs) - pad_x)
    y0 = max(0.0, min(ys) - pad_y)
    x1 = min(1.0, max(xs) + pad_x)
    y1 = min(1.0, max(ys) + pad_y)
    return {
        "x": round(x0, 5),
        "y": round(y0, 5),
        "width": round(max(0.0, x1 - x0), 5),
        "height": round(max(0.0, y1 - y0), 5),
    }


def _box_from_mask(mask, threshold=0.34):
    ys, xs = np.where(mask >= threshold)
    if not xs.size:
        return None
    h, w = mask.shape[:2]
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    return {
        "x": round(x0 / w, 5),
        "y": round(y0 / h, 5),
        "width": round((x1 - x0) / w, 5),
        "height": round((y1 - y0) / h, 5),
    }


def _weighted_focal(faces, subject):
    boxes = [(box, 3.0) for box in faces]
    if subject:
        boxes.append((subject, 1.0))
    if not boxes:
        return {"x": 0.5, "y": 0.5}
    weight = sum(item[1] for item in boxes)
    x = sum((box["x"] + box["width"] / 2) * w for box, w in boxes) / weight
    y = sum((box["y"] + box["height"] / 2) * w for box, w in boxes) / weight
    return {"x": round(float(x), 5), "y": round(float(y), 5)}


def analyze(image):
    rgb = common.to_np(image)
    h, w = rgb.shape[:2]
    work = common.downscale(rgb, 1280)

    face_boxes = []
    for landmarks in masks._face_landmarks(work):
        # Include hair/chin breathing room, not just the facial skin polygon.
        box = _box_from_points(landmarks, pad_x=0.025, pad_y=0.055)
        if box and box["width"] * box["height"] > 0.0002:
            face_boxes.append(box)

    # The existing multiclass person segmenter is fast and sufficient for
    # composition bounds. High-resolution BiRefNet remains reserved for
    # pixel-perfect matting in editing tools.
    confidence = masks.confidence_masks(work)
    subject_prob = np.maximum.reduce(confidence[1:]) if len(confidence) > 1 else np.zeros(work.shape[:2])
    subject_box = _box_from_mask(subject_prob)

    gray = cv2.cvtColor(work, cv2.COLOR_RGB2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sharpness_score = max(0.0, min(1.0, np.log1p(sharpness) / np.log(900.0)))
    exposure = float(gray.mean() / 255.0)
    exposure_score = max(0.0, 1.0 - abs(exposure - 0.5) / 0.5)
    quality = 0.72 * sharpness_score + 0.28 * exposure_score

    return {
        "widthPx": w,
        "heightPx": h,
        "faces": face_boxes,
        "subject": subject_box,
        "focalPoint": _weighted_focal(face_boxes, subject_box),
        "palette": album_palette.measure(work, face_boxes),
        "sharpnessScore": round(sharpness_score, 4),
        "qualityScore": round(float(quality), 4),
        "analyzedBy": "mediapipe-local-v1",
    }


# ------------------------------------------------------------- by path, cached
#
# An album used to analyse every photograph again each time it opened —
# 2-4 s a frame through the engine's single worker, twenty seconds for twenty
# photographs, and thumbnails starved of connections meanwhile. The answer
# depends only on the file, so it is kept on disk keyed by the file's path,
# size, modification time and this module's version, and a re-open costs a
# file read. The first analysis reads a reduced decode (the work below runs at
# 1280 px anyway) while the reported size stays the file's own, from its header.

ANALYSIS_VERSION = "mediapipe-local-v1+cache1"


def _cache_file(path):
    try:
        st = os.stat(path)
    except OSError:
        return None
    import previews  # noqa: PLC0415 - shares the engine's cache folder

    key = hashlib.sha1(
        f"{os.path.abspath(path)}|{st.st_size}|{st.st_mtime_ns}|{ANALYSIS_VERSION}".encode("utf-8")
    ).hexdigest()
    return os.path.join(previews.cache_root(), "album-analysis", key[:2], key + ".json")


def cached(path):
    """-> the stored analysis of this file as it is now, or None."""
    target = _cache_file(path)
    if not target:
        return None
    try:
        with open(target, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def analyze_path(path):
    """Analyse a file on disk, reading only as much of it as the work needs."""
    import previews  # noqa: PLC0415
    import shotinfo  # noqa: PLC0415

    hit = cached(path)
    if hit is not None:
        return hit
    small, _ = previews.decode_small(path, 1280, fast=True)
    result = analyze(small)
    wh = shotinfo.dims(path)
    if wh:
        result["widthPx"], result["heightPx"] = int(wh[0]), int(wh[1])
    target = _cache_file(path)
    if target:
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            tmp = f"{target}.{os.getpid()}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(result, fh)
            os.replace(tmp, target)
        except OSError:
            pass  # a cache that cannot be written still answers
    return result
