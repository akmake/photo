"""סינון — the culling judge for the auto-album.

The stage that decides a frame does not belong in the book. It is the highest-
value stage in the pipeline and the most dangerous one, so three rules shape it:

1. **It never deletes.** A verdict is a label with the numbers that produced it.
   Every rejection is reversible, and the UI shows the face it judged.

2. **Unknown is not "bad".** A face 40 pixels wide has unreliable eye landmarks;
   reporting "eyes closed" from them would reject the sharpest frame in the set
   for no reason. Below the reliability floor the answer is `None` — a third
   value that reads as "could not tell", never folded into a rejection
   (CLAUDE.md §3: a failed read and a bad result are different facts).

3. **It judges the FACE, not the frame.** A photograph can have a razor-sharp
   background and a soft subject, and the frame-wide Laplacian that
   `album_analysis` computes will happily call it sharp. So sharpness, exposure
   and clipping are all measured inside the face box, at native resolution.

The same pass also returns the geometry the layout needs (dimensions, faces,
focal point) — the expensive part is finding the landmarks, and finding them
twice for two endpoints would double the slowest stage of the album for nothing.
"""

import hashlib
import json
import os

import cv2
import numpy as np

import album_analysis
import common
import identity
import masks
import workspace

# The iris ring, which the 478-point landmarker gives us for free. `eyes.py`
# already relies on it for the sparkle tool; here it answers a different and
# much cheaper question — which way the person is actually looking.
LEFT_IRIS = (468, 469, 470, 471, 472)
RIGHT_IRIS = (473, 474, 475, 476, 477)

# Bump on ANY change to what is measured or how it is judged: the disk cache is
# keyed on it, and a stale verdict from older thresholds is worse than no cache.
CULL_VERSION = 6

# MediaPipe face-mesh indices. Mid-lid pairs and the corners that scale them.
# `masks` already names the eye rings; these are the four points that measure an
# eye's opening, which the rings do not single out.
LEFT_EYE_TOP, LEFT_EYE_BOTTOM = 159, 145
LEFT_EYE_OUTER, LEFT_EYE_INNER = 33, 133
RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM = 386, 374
RIGHT_EYE_OUTER, RIGHT_EYE_INNER = 263, 362

# Below this the eye landmarks are noise, not measurement. Measured against the
# face width in ORIGINAL pixels, because that is what sets landmark precision.
MIN_FACE_PX_FOR_EYES = 90.0

# Openness = lid gap / eye width. An open eye sits around 0.25–0.40; a blink
# collapses below 0.12. The band between is a squint — flagged, never rejected,
# because half the honest laughter in a wedding lives there.
EYES_SHUT = 0.13
EYES_NARROW = 0.20

# Nose offset between the face edges, as a fraction. Frontal is near 0; a full
# profile approaches 1. A deliberate profile portrait is a real photograph, so
# only the extreme rejects.
YAW_TURNED = 0.55
YAW_AWAY = 0.74

# Face-crop Laplacian, log-normalised the same way album_analysis normalises the
# frame, so the two numbers are comparable.
FACE_SOFT = 0.34

# Fraction of the face box that may be pure white before the skin is gone.
FACE_BLOWN = 0.18
FACE_CRUSHED = 0.42

# Frame-wide exposure, for the frames the face detector cannot help with.
#
# These exist because of a measured hole: an overexposed frame destroys the face
# so thoroughly that MediaPipe finds nothing, and a judge that only asked the
# faces then passed a pure-white frame as "keep". They are deliberately far more
# forgiving than the face thresholds — a bride on white and a candle-lit room are
# real photographs, and only the genuinely dead frame may fail here.
FRAME_BLOWN = 0.45
FRAME_CRUSHED = 0.70
FRAME_MEAN_HIGH = 0.92
FRAME_MEAN_LOW = 0.05


def _cache_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "TEZA", "cache", "cull")


def _cache_key(path):
    norm = os.path.normcase(os.path.abspath(path))
    try:
        stat = os.stat(path)
        stamp = f"{stat.st_mtime_ns}:{stat.st_size}"
    except OSError:
        stamp = "0:0"
    return hashlib.sha1(
        f"{CULL_VERSION}|{norm}|{stamp}".encode("utf-8")
    ).hexdigest()


def _cached(path):
    try:
        with open(os.path.join(_cache_dir(), f"{_cache_key(path)}.json"), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _store(path, payload):
    try:
        os.makedirs(_cache_dir(), exist_ok=True)
        with open(os.path.join(_cache_dir(), f"{_cache_key(path)}.json"), "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
    except OSError:
        # A cache that cannot be written is a slow run, not a failed one.
        pass


def _px(point, w, h):
    return np.array([float(point.x) * w, float(point.y) * h])


def _eye_openness(landmarks, w, h, top, bottom, outer, inner):
    """Lid gap over eye width. Scale-free, so it survives any crop."""
    gap = np.linalg.norm(_px(landmarks[top], w, h) - _px(landmarks[bottom], w, h))
    width = np.linalg.norm(_px(landmarks[outer], w, h) - _px(landmarks[inner], w, h))
    if width < 1e-6:
        return None
    return float(gap / width)


def _yaw(landmarks, w, h):
    """How far the head is turned, from the nose's offset between face edges."""
    left = _px(landmarks[masks.FACE_LEFT], w, h)
    right = _px(landmarks[masks.FACE_RIGHT], w, h)
    nose = _px(landmarks[masks.NOSE_TIP], w, h)
    d_left = abs(nose[0] - left[0])
    d_right = abs(right[0] - nose[0])
    total = d_left + d_right
    if total < 1e-6:
        return None
    return float(abs(d_left - d_right) / total)


# ------------------------------------------------------- the editorial reads
#
# The facts a designer takes from a photograph in about half a second, every one
# of them computable from landmarks we already have.
#
# Until now this module measured only whether a frame was GOOD. That is a
# gatekeeper, not an eye. These three answer what the frame IS, which is what
# decides where it belongs on a page:
#
#   * scale — close-up, medium, wide, detail. The variable that paces a book.
#   * gaze  — which way the subject faces. A portrait must look INTO the spread;
#             one looking off the outer edge pushes the reader out of the book,
#             and it is the most recognisable amateur mistake in album design.
#   * space — which side of the frame is empty, so a picture can be placed with
#             its air pointing inward rather than into the fold.

# Face height as a fraction of the frame height. The bands follow the ordinary
# shot vocabulary — head-and-shoulders, waist-up, full-length — rather than
# numbers tuned to any one set.
SCALE_CLOSEUP = 0.30
SCALE_MEDIUM = 0.12
SCALE_WIDE = 0.04


def _shot_scale(faces, subject):
    """close-up / medium / wide / detail, from what actually fills the frame."""
    if faces:
        tallest = max(f["box"]["height"] for f in faces)
        if tallest >= SCALE_CLOSEUP:
            return "closeup", round(tallest, 4)
        if tallest >= SCALE_MEDIUM:
            return "medium", round(tallest, 4)
        if tallest >= SCALE_WIDE:
            return "wide", round(tallest, 4)
    # No readable face. A big isolated subject is still a wide shot of
    # something; anything smaller is a detail — a ring, a shoe, a hand.
    area = (subject["width"] * subject["height"]) if subject else 0.0
    if area >= 0.16:
        return "wide", round(area, 4)
    return "detail", round(area, 4)


def _iris_offset(landmarks, iris, outer, inner):
    """Where the iris sits between the eye corners: -1 inner-most … +1 outer."""
    xs = [float(landmarks[i].x) for i in iris]
    if not xs:
        return None
    centre = sum(xs) / len(xs)
    a = float(landmarks[outer].x)
    b = float(landmarks[inner].x)
    lo, hi = min(a, b), max(a, b)
    if hi - lo < 1e-6:
        return None
    return float((centre - lo) / (hi - lo) * 2 - 1)


def _gaze(landmarks):
    """Which way the subject faces: -1 hard left of frame … +1 hard right.

    Two signals, because either alone is wrong half the time. The head's
    rotation dominates — a person turned away is facing away whatever the eyes
    do — but a frontal head with the eyes cut sideways is looking sideways, and
    only the irises show it."""
    left = float(landmarks[masks.FACE_LEFT].x)
    right = float(landmarks[masks.FACE_RIGHT].x)
    nose = float(landmarks[masks.NOSE_TIP].x)
    d_left = abs(nose - left)
    d_right = abs(right - nose)
    total = d_left + d_right
    if total < 1e-6:
        return None
    # Nose crowded toward the left edge means the face points left.
    head = (d_left - d_right) / total

    irises = [
        _iris_offset(landmarks, LEFT_IRIS, masks.LEFT_EYE[0], masks.LEFT_EYE[8]),
        _iris_offset(landmarks, RIGHT_IRIS, masks.RIGHT_EYE[0], masks.RIGHT_EYE[8]),
    ]
    seen = [v for v in irises if v is not None]
    eyes = sum(seen) / len(seen) if seen else 0.0

    return float(max(-1.0, min(1.0, head * 0.68 + eyes * 0.32)))


def _negative_space(faces, subject):
    """Which side of the frame the air is on: 'left', 'right' or 'centre'."""
    box = None
    if faces:
        box = max(faces, key=lambda f: f["box"]["width"] * f["box"]["height"])["box"]
    elif subject:
        box = subject
    if not box:
        return "centre"
    centre = box["x"] + box["width"] / 2
    if centre < 0.44:
        return "right"   # subject sits left, the air is on the right
    if centre > 0.56:
        return "left"
    return "centre"


def _sharpness_score(gray):
    """The same log-normalised Laplacian album_analysis uses, on any crop."""
    if gray.size < 64:
        return None
    variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    return max(0.0, min(1.0, float(np.log1p(variance) / np.log(900.0))))


def _face_crop(rgb, landmarks, w, h):
    """The face box in ORIGINAL pixels, padded to include brow and chin."""
    xs = [float(p.x) * w for p in landmarks]
    ys = [float(p.y) * h for p in landmarks]
    face_w = max(1.0, max(xs) - min(xs))
    pad_x = face_w * 0.10
    pad_y = face_w * 0.16
    x0 = max(0, int(min(xs) - pad_x))
    x1 = min(w, int(max(xs) + pad_x))
    y0 = max(0, int(min(ys) - pad_y))
    y1 = min(h, int(max(ys) + pad_y))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return rgb[y0:y1, x0:x1]


def _judge_face(rgb, landmarks, w, h):
    """Every measurement for one face, plus its own verdict flags."""
    left = _eye_openness(landmarks, w, h, LEFT_EYE_TOP, LEFT_EYE_BOTTOM,
                         LEFT_EYE_OUTER, LEFT_EYE_INNER)
    right = _eye_openness(landmarks, w, h, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM,
                          RIGHT_EYE_OUTER, RIGHT_EYE_INNER)

    face_px = abs(
        float(landmarks[masks.FACE_RIGHT].x) - float(landmarks[masks.FACE_LEFT].x)
    ) * w
    # Too small to read an eyelid from: say so, do not guess.
    eyes_readable = face_px >= MIN_FACE_PX_FOR_EYES and left is not None and right is not None
    openness = min(left, right) if eyes_readable else None

    yaw = _yaw(landmarks, w, h)
    gaze = _gaze(landmarks)
    crop = _face_crop(rgb, landmarks, w, h)

    sharp = None
    blown = None
    crushed = None
    if crop is not None:
        gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        sharp = _sharpness_score(gray)
        total = float(gray.size)
        blown = float((gray >= 250).sum() / total)
        crushed = float((gray <= 6).sum() / total)

    xs = [float(p.x) for p in landmarks]
    ys = [float(p.y) for p in landmarks]
    box = {
        "x": round(max(0.0, min(xs)), 5),
        "y": round(max(0.0, min(ys)), 5),
        "width": round(min(1.0, max(xs)) - max(0.0, min(xs)), 5),
        "height": round(min(1.0, max(ys)) - max(0.0, min(ys)), 5),
    }

    return {
        "box": box,
        "faceWidthPx": round(face_px, 1),
        "eyeOpenness": None if openness is None else round(openness, 4),
        # Three-valued on purpose: True / False / None = "could not tell".
        "eyesShut": None if openness is None else bool(openness < EYES_SHUT),
        "eyesNarrow": None if openness is None else bool(EYES_SHUT <= openness < EYES_NARROW),
        "yaw": None if yaw is None else round(yaw, 4),
        "turnedAway": None if yaw is None else bool(yaw >= YAW_AWAY),
        "profile": None if yaw is None else bool(YAW_TURNED <= yaw < YAW_AWAY),
        "gaze": None if gaze is None else round(gaze, 4),
        "faceSharpness": None if sharp is None else round(sharp, 4),
        "faceSoft": None if sharp is None else bool(sharp < FACE_SOFT),
        "blownFraction": None if blown is None else round(blown, 4),
        "crushedFraction": None if crushed is None else round(crushed, 4),
    }


def _reasons(faces, frame_sharpness, frame):
    """Why a frame is rejected — in the photographer's words, with the number.

    Only the LARGEST face votes. In a group shot someone at the back always
    blinks, and rejecting the whole frame for it would empty the album."""
    out = []

    # Exposure is judged first and regardless of faces. A frame can be blown so
    # far that the face detector finds nothing at all, and a judge that only
    # asked the faces would call that empty result "no problems".
    if frame["blown"] >= FRAME_BLOWN or frame["mean"] >= FRAME_MEAN_HIGH:
        out.append({"code": "frame-blown", "label": "הפריים שרוף",
                    "value": frame["blown"], "hard": True})
    elif frame["crushed"] >= FRAME_CRUSHED or frame["mean"] <= FRAME_MEAN_LOW:
        out.append({"code": "frame-dark", "label": "הפריים חשוך",
                    "value": frame["crushed"], "hard": True})

    if not faces:
        # No face is not a fault: a detail, a room, a ring. Only the frame's own
        # focus can condemn it, and only when it is badly gone.
        if frame_sharpness is not None and frame_sharpness < 0.22:
            out.append({"code": "frame-soft", "label": "הפריים לא בפוקוס",
                        "value": frame_sharpness, "hard": True})
        return out

    main = max(faces, key=lambda f: f["box"]["width"] * f["box"]["height"])

    if main["eyesShut"]:
        out.append({"code": "eyes-shut", "label": "עיניים עצומות",
                    "value": main["eyeOpenness"], "hard": True})
    elif main["eyesNarrow"]:
        out.append({"code": "eyes-narrow", "label": "עיניים מצומצמות",
                    "value": main["eyeOpenness"], "hard": False})
    elif main["eyesShut"] is None:
        out.append({"code": "eyes-unknown", "label": "פנים קטנות מכדי לקרוא עיניים",
                    "value": main["faceWidthPx"], "hard": False})

    if main["faceSoft"]:
        out.append({"code": "face-soft", "label": "הפנים לא בפוקוס",
                    "value": main["faceSharpness"], "hard": True})

    if main["turnedAway"]:
        out.append({"code": "turned-away", "label": "הראש מסובב מהמצלמה",
                    "value": main["yaw"], "hard": True})
    elif main["profile"]:
        out.append({"code": "profile", "label": "פרופיל",
                    "value": main["yaw"], "hard": False})

    if main["blownFraction"] is not None and main["blownFraction"] >= FACE_BLOWN:
        out.append({"code": "blown", "label": "פנים שרופות",
                    "value": main["blownFraction"], "hard": True})
    if main["crushedFraction"] is not None and main["crushedFraction"] >= FACE_CRUSHED:
        out.append({"code": "crushed", "label": "פנים בחושך",
                    "value": main["crushedFraction"], "hard": True})

    return out


def judge(path):
    """One frame, measured and judged. Geometry included — the landmarks that
    cost the time answer both questions."""
    cached = _cached(path)
    if cached is not None:
        return cached

    rgb = common.to_np(common.load_image(path))
    h, w = rgb.shape[:2]
    work = common.downscale(rgb, 1280)

    gray_frame = cv2.cvtColor(work, cv2.COLOR_RGB2GRAY)
    frame_sharpness = _sharpness_score(gray_frame)
    exposure = float(gray_frame.mean() / 255.0)
    exposure_score = max(0.0, 1.0 - abs(exposure - 0.5) / 0.5)
    total_px = float(gray_frame.size)
    frame_stats = {
        "mean": exposure,
        "blown": float((gray_frame >= 250).sum() / total_px),
        "crushed": float((gray_frame <= 6).sum() / total_px),
    }

    landmark_sets = list(masks._face_landmarks(work))
    faces = [_judge_face(rgb, lm, w, h) for lm in landmark_sets]

    reasons = _reasons(faces, frame_sharpness, frame_stats)
    rejected = any(r["hard"] for r in reasons)

    face_boxes = [f["box"] for f in faces]
    subject = None
    try:
        confidence = masks.confidence_masks(work)
        if len(confidence) > 1:
            subject_prob = np.maximum.reduce(confidence[1:])
            subject = album_analysis._box_from_mask(subject_prob)
    except Exception:
        # Segmentation is a nice-to-have for the focal point; its absence must
        # not fail the judgement that the landmarks already produced.
        subject = None

    # The album's own quality number, weighted toward the face when there is one.
    main_sharp = None
    if faces:
        main = max(faces, key=lambda f: f["box"]["width"] * f["box"]["height"])
        main_sharp = main["faceSharpness"]
    sharpness_score = main_sharp if main_sharp is not None else (frame_sharpness or 0.0)
    quality = 0.72 * sharpness_score + 0.28 * exposure_score

    scale, scale_value = _shot_scale(faces, subject)

    # The frame's gaze is the MAIN subject's gaze. Averaging a crowd's faces
    # cancels out to zero and says nothing about where the picture points.
    main_face = max(
        faces, key=lambda f: f["box"]["width"] * f["box"]["height"], default=None,
    ) if faces else None
    gaze = main_face["gaze"] if main_face else None

    # Identity vectors, computed here because this is the one place the frame is
    # already open at full resolution with its faces located. They are stored
    # beside the frame, not inside this payload: 512 floats per face would bloat
    # every cached verdict for a question only the clustering pass asks.
    try:
        identity.faces_of(path, face_boxes, rgb)
    except Exception:  # noqa: BLE001 — identity is an enrichment, not a gate
        pass

    payload = {
        "widthPx": w,
        "heightPx": h,
        "faces": face_boxes,
        "faceDetail": faces,
        "subject": subject,
        "focalPoint": album_analysis._weighted_focal(face_boxes, subject),
        # ---- the editorial reads ----
        "shotTime": workspace._shot_time(path),
        "shotScale": scale,
        "shotScaleValue": scale_value,
        "gaze": gaze,
        "negativeSpace": _negative_space(faces, subject),
        "frameSharpness": None if frame_sharpness is None else round(frame_sharpness, 4),
        "sharpnessScore": round(float(sharpness_score), 4),
        "qualityScore": round(float(quality), 4),
        "exposure": round(exposure, 4),
        "blownFraction": round(frame_stats["blown"], 4),
        "crushedFraction": round(frame_stats["crushed"], 4),
        "verdict": "reject" if rejected else "keep",
        "reasons": reasons,
        "analyzedBy": f"cull-local-v{CULL_VERSION}",
    }
    _store(path, payload)
    return payload
