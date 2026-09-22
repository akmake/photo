"""סינון — what the tool would remove, offered to the photographer as a suggestion.

The earlier judge (cull.py) looked at each frame ALONE and asked "is this bad?".
On a real 648-frame family session it proposed removing 172 frames, and every
one of the eight checked at full size was a good photograph: a child looking
down at a cup, a laughing squint, a three-quarter profile, a mother kissing her
son. A single frame cannot tell a blink from a lowered gaze, or a soft focus
from smooth skin — the pixels are nearly the same, and the difference is intent.

So this module never judges a frame alone. It judges a frame AGAINST ITS TWIN:

  1. The set is cut into MOMENTS — consecutive frames, close in time, that look
     alike (a gap over MOMENT_GAP seconds or a similarity under MOMENT_SIM
     starts a new one). This is navigation, not judgement.
  2. Inside a moment, frames that are near-identical (TWIN_SIM and above) form a
     TWIN GROUP: the same pose shot again. Only here is comparison fair — the
     content is the same, so a difference IS the defect.
  3. The same PERSON is followed across a twin group (position, size, skin
     tone), and compared only with frames where their head is in the SAME POSE.
     A lowered head is never compared with a raised one.
  4. A frame is suggested for removal only when a twin shows the same person,
     same pose, better: eyes open where these are shut, or sharp where this is
     soft. The suggestion names the twin, so the photographer loses nothing by
     accepting it and can see why in one glance.
  5. The rest of a twin group — flawless near-repeats — is marked as a
     DUPLICATE of the group's recommended frame (the star). A softer
     suggestion, filtered separately: a repeat is not a defect.
  6. A frame with ruined exposure is suggested on its own; that needs no twin.

Measured on the jm session (docs/TOOLS-STATUS.md): eyes-shut fires on real
closures only (model blink score >= 0.7 there, 0.42-0.6 for a lowered gaze);
softness fires only when the eyes AND the mid-face both drop, which held on
every pair checked at 100%. A miss is cheap — the photographer still sees the
frame. A false suggestion is expensive — it teaches him to ignore the tool.

Nothing is deleted, and nothing here is the photographer's decision: that lives
in project.json (`cull`), written by the studio, never by this module.
"""

import hashlib
import json
import math
import os
import threading

import cv2
import numpy as np

import common
import embed
import masks
import workspace

# Bump on ANY change to what is measured: the disk cache is keyed on it.
TRIAGE_VERSION = 1

# ---- the set's structure (measured on jm: 1-2s between frames is shooting,
# 23s+ is a new idea; neighbours in a pose series sit 0.9-0.96)
MOMENT_GAP = 5.0
MOMENT_SIM = 0.85
TWIN_SIM = 0.95

# ---- one person across a twin group
SAME_POS = 0.05        # face centre, as a fraction of the frame
SAME_SIZE = (0.85, 1.18)   # inter-ocular distance ratio
SAME_TONE = 10.0       # mean face Lab distance
# ---- same pose: degrees
POSE_PITCH, POSE_YAW, POSE_ROLL = 7.0, 10.0, 10.0

# ---- eyes shut: the landmarker's own blink score. A lowered gaze reads
# 0.42-0.6 on it, a real closure 0.7+. The twin must be clearly open.
BLINK_SHUT = 0.65
BLINK_OPEN = 0.25
# Too small to read an eyelid from; below this nothing is said about eyes.
MIN_IOD_EYES = 30.0

# ---- softness: log-variance of the Laplacian at native pixels. Content-bound,
# which is why it is only ever compared between twins, and only when BOTH the
# eye region and the mid-face drop — expression moves one, focus moves both.
SOFT_DROP = 0.4
MIN_IOD_SHARP = 35.0
# A face under this share of the frame's largest is background, for focus.
LEAD_SHARE = 0.7

# ---- ruined exposure, frame-wide (same forgiving bars as cull.py: a bride on
# white and a candle-lit room are photographs; only the dead frame fails)
FRAME_BLOWN = 0.45
FRAME_CRUSHED = 0.70
FRAME_MEAN_HIGH = 0.92
FRAME_MEAN_LOW = 0.05

L_EYE = (33, 133, 159, 145, 160, 144, 158, 153, 246, 7, 163, 161, 157, 154, 155, 173)
R_EYE = (263, 362, 386, 374, 387, 373, 385, 380, 466, 249, 390, 388, 384, 381, 382, 398)
L_IRIS, R_IRIS = 468, 473

_lock = threading.Lock()
_landmarker = None


def _cache_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "TEZA", "cache", "triage")


def _cache_path(path):
    norm = os.path.normcase(os.path.abspath(path))
    try:
        st = os.stat(path)
        stamp = f"{st.st_mtime_ns}:{st.st_size}"
    except OSError:
        stamp = "0:0"
    key = hashlib.sha1(f"{TRIAGE_VERSION}|{norm}|{stamp}".encode("utf-8")).hexdigest()
    return os.path.join(_cache_dir(), f"{key}.json")


def cached(path):
    try:
        with open(_cache_path(path), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _store(path, payload):
    try:
        os.makedirs(_cache_dir(), exist_ok=True)
        tmp = _cache_path(path) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp, _cache_path(path))
    except OSError:
        pass  # a cache that cannot be written is a slow run, not a failed one


def _face_model():
    """A landmarker that also answers blink/gaze and head pose. masks.py keeps
    its own without them; this one is only ever called on a face crop."""
    global _landmarker
    with _lock:
        if _landmarker is None:
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision
            opts = vision.FaceLandmarkerOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=os.path.join(masks.MODELS_DIR, "face_landmarker.task")
                ),
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
                num_faces=1,
            )
            _landmarker = vision.FaceLandmarker.create_from_options(opts)
    return _landmarker


def _lapv(patch):
    if patch is None or patch.size < 200:
        return None
    return float(np.log1p(cv2.Laplacian(cv2.GaussianBlur(patch, (0, 0), 0.5), cv2.CV_64F).var()))


def _face(rgb, gray, lms):
    """Everything a twin comparison needs about one face, in ORIGINAL pixels."""
    import mediapipe as mp

    h, w = rgb.shape[:2]
    xs = [float(p.x) * w for p in lms]
    ys = [float(p.y) * h for p in lms]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    side = int(max(max(xs) - min(xs), max(ys) - min(ys)) * 1.3 * 2) // 2 * 2 or 2
    x0, y0 = int(cx - side / 2), int(cy - side / 2)
    box = {
        "x": round(max(0.0, min(xs) / w), 5), "y": round(max(0.0, min(ys) / h), 5),
        "width": round((min(w, max(xs)) - max(0, min(xs))) / w, 5),
        "height": round((min(h, max(ys)) - max(0, min(ys))) / h, 5),
    }
    face = {"box": box, "cx": round(cx / w, 5), "cy": round(cy / h, 5)}

    # The crop is padded with edge pixels when the face touches the frame, so a
    # face at the border is still measured at the right scale.
    pad = [(max(0, -y0), max(0, y0 + side - h)), (max(0, -x0), max(0, x0 + side - w)), (0, 0)]
    crop = rgb[max(0, y0):y0 + side, max(0, x0):x0 + side]
    if crop.size == 0:
        return face
    crop = np.pad(crop, pad, mode="edge")
    small = np.ascontiguousarray(cv2.resize(crop, (384, 384), interpolation=cv2.INTER_AREA))
    out = _face_model().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=small))
    if not out.face_landmarks:
        return face

    P = out.face_landmarks[0]
    k = side / 384.0

    def pt(i):
        return np.array([x0 + P[i].x * 384 * k, y0 + P[i].y * 384 * k])

    iod = float(np.linalg.norm(pt(L_IRIS) - pt(R_IRIS)))
    d = {c.category_name: float(c.score) for c in out.face_blendshapes[0]}
    R = np.array(out.facial_transformation_matrixes[0])[:3, :3]

    def patch(ids, up, down, side_pad):
        ex = [pt(i)[0] for i in ids]
        ey = [pt(i)[1] for i in ids]
        a0, a1 = int(min(ex) - iod * side_pad), int(max(ex) + iod * side_pad)
        b0, b1 = int(min(ey) - iod * up), int(max(ey) + iod * down)
        return gray[max(0, b0):max(0, b1), max(0, a0):max(0, a1)]

    eyes = [v for v in (_lapv(patch(L_EYE, 0.12, 0.08, 0.08)), _lapv(patch(R_EYE, 0.12, 0.08, 0.08))) if v is not None]
    # Mid-face: under the eyes, over the mouth, inside the cheeks — skin that has
    # texture whatever the eyes are doing.
    lx, rx = pt(234)[0], pt(454)[0]
    top = max(pt(145)[1], pt(374)[1]) + iod * 0.08
    bot = pt(0)[1] - iod * 0.05
    mx0, mx1 = int(min(lx, rx) + abs(rx - lx) * 0.12), int(max(lx, rx) - abs(rx - lx) * 0.12)
    mid = _lapv(gray[max(0, int(top)):max(0, int(bot)), max(0, mx0):max(0, mx1)])

    tone = cv2.resize(crop, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    lab = cv2.cvtColor(tone, cv2.COLOR_RGB2LAB).reshape(-1, 3).mean(0)

    face.update({
        "iod": round(iod, 1),
        "pitch": round(math.degrees(math.atan2(R[2, 1], R[2, 2])), 1),
        "yaw": round(math.degrees(math.asin(-max(-1.0, min(1.0, R[2, 0])))), 1),
        "roll": round(math.degrees(math.atan2(R[1, 0], R[0, 0])), 1),
        "blink": round((d.get("eyeBlinkLeft", 0) + d.get("eyeBlinkRight", 0)) / 2, 3),
        "eyeSharp": round(max(eyes), 3) if eyes else None,
        "midSharp": None if mid is None else round(mid, 3),
        "lab": [round(float(v), 2) for v in lab],
    })
    return face


def analyze(path):
    """One frame, measured for comparison with its twins. Cached on disk."""
    hit = cached(path)
    if hit is not None:
        return hit

    rgb = common.to_np(common.load_image(path))
    h, w = rgb.shape[:2]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    work = common.downscale(rgb, 1280)
    small = cv2.cvtColor(work, cv2.COLOR_RGB2GRAY)
    total = float(small.size)

    faces = []
    for lms in masks._face_landmarks(work):
        try:
            faces.append(_face(rgb, gray, lms))
        except Exception:  # noqa: BLE001 — one unreadable face must not lose the frame
            continue

    try:
        embed.embed_path(path)
    except Exception:  # noqa: BLE001 — no vector means no twins; the frame still stands
        pass

    payload = {
        "file": os.path.basename(path),
        "widthPx": w, "heightPx": h,
        "shotTime": workspace._shot_time(path),
        "exposure": round(float(small.mean() / 255.0), 4),
        "blown": round(float((small >= 250).sum() / total), 4),
        "crushed": round(float((small <= 6).sum() / total), 4),
        "faces": faces,
        "version": TRIAGE_VERSION,
    }
    _store(path, payload)
    return payload


def store_failure(path, error):
    """A frame that could not be read is ANSWERED, not left pending forever:
    the screen says "could not read" instead of "still reading" (CLAUDE.md §6 —
    a failure must never look like waiting, or like a clean result)."""
    _store(path, {"file": os.path.basename(path), "error": str(error)[:300],
                  "faces": [], "version": TRIAGE_VERSION})


# ------------------------------------------------------------ the set's answer

def _same_person(a, b):
    if "iod" not in a or "iod" not in b or not b["iod"]:
        return False
    tone = sum((x - y) ** 2 for x, y in zip(a["lab"], b["lab"])) ** 0.5
    return (abs(a["cx"] - b["cx"]) < SAME_POS and abs(a["cy"] - b["cy"]) < SAME_POS
            and SAME_SIZE[0] < a["iod"] / b["iod"] < SAME_SIZE[1] and tone < SAME_TONE)


def _same_pose(a, b):
    return (abs(a["pitch"] - b["pitch"]) < POSE_PITCH and abs(a["yaw"] - b["yaw"]) < POSE_YAW
            and abs(a["roll"] - b["roll"]) < POSE_ROLL)


def _groups(order, vecs, times):
    """Moments, then twin groups inside each. Both CONTIGUOUS in capture order:
    a story is told in the order it happened, and the same pose an hour later
    is a new photograph, not a repeat."""
    moments, cur = [], []
    for i, name in enumerate(order):
        if cur:
            prev = order[i - 1]
            gap = (times.get(name) or 0) - (times.get(prev) or 0)
            sim = float(vecs[name] @ vecs[prev]) if name in vecs and prev in vecs else 0.0
            if gap > MOMENT_GAP or sim < MOMENT_SIM:
                moments.append(cur)
                cur = []
        cur.append(name)
    if cur:
        moments.append(cur)

    twins = []
    for m in moments:
        have = [n for n in m if n in vecs]
        parent = {n: n for n in have}

        def find(n):
            while parent[n] != n:
                parent[n] = parent[parent[n]]
                n = parent[n]
            return n

        for a in range(len(have)):
            for b in range(a + 1, len(have)):
                if float(vecs[have[a]] @ vecs[have[b]]) >= TWIN_SIM:
                    parent[find(have[a])] = find(have[b])
        buckets = {}
        for n in have:
            buckets.setdefault(find(n), []).append(n)
        twins += [g for g in buckets.values() if len(g) > 1]
    return moments, twins


def _tracks(group, feats):
    tracks = []
    for n in group:
        for f in feats[n]["faces"]:
            if "iod" not in f:
                continue
            for t in tracks:
                if n not in (m for m, _ in t) and _same_person(f, t[-1][1]):
                    t.append((n, f))
                    break
            else:
                tracks.append([(n, f)])
    return tracks


def triage(paths):
    """The whole set's suggestions, from what has been analysed so far.

    Returns frames in capture order with their moment, twin group, star and
    suggestion. Frames not yet analysed come back in `pending` — never silently
    treated as clean (CLAUDE.md §3: unread is not "no problems").
    """
    feats, pending = {}, []
    for p in paths:
        f = cached(p)
        if f is None:
            pending.append(os.path.basename(p))
        else:
            feats[os.path.basename(p)] = f
    by_name = {os.path.basename(p): p for p in paths}

    unread = {n for n, f in feats.items() if f.get("error")}
    times = {n: f.get("shotTime") for n, f in feats.items()}
    order = sorted(feats, key=lambda n: (times.get(n) or 0, n))
    vecs = {}
    for n in order:
        v = embed.load_cached(by_name[n])
        if v is not None:
            vecs[n] = v.astype(np.float32)

    moments, twins = _groups(order, vecs, times)
    reasons = {n: [] for n in order}

    # Ruined exposure needs no twin.
    for n in order:
        f = feats[n]
        if n in unread:
            reasons[n].append({"code": "unread", "label": "לא ניתן לקרוא את הקובץ"})
            continue
        if f["blown"] >= FRAME_BLOWN or f["exposure"] >= FRAME_MEAN_HIGH:
            reasons[n].append({"code": "blown", "label": "הפריים שרוף"})
        elif f["crushed"] >= FRAME_CRUSHED or f["exposure"] <= FRAME_MEAN_LOW:
            reasons[n].append({"code": "dark", "label": "הפריים חשוך"})

    for group in twins:
        for track in _tracks(group, feats):
            for n, f in track:
                peers = [(m, g) for m, g in track if m != n and _same_pose(f, g)]
                if not peers:
                    continue
                # Eyes shut, where the same person in the same pose has them open.
                if f.get("iod", 0) >= MIN_IOD_EYES and f.get("blink", 0) >= BLINK_SHUT:
                    open_ = [(m, g) for m, g in peers if g.get("blink", 1) <= BLINK_OPEN]
                    if open_:
                        ref = min(open_, key=lambda x: x[1]["blink"])[0]
                        if not any(r["code"] == "eyes-shut" for r in reasons[n]):
                            reasons[n].append({"code": "eyes-shut", "label": "עיניים עצומות", "ref": ref,
                                               "face": feats[n]["faces"].index(f)})
                        continue
                # Softer than a twin — in the eyes AND the skin, or it was expression.
                # Only for the frame's MAIN faces: a person behind the subject is
                # soft because the photographer chose the depth of field.
                lead = max((g.get("iod", 0) for g in feats[n]["faces"]), default=0)
                if f.get("iod", 0) >= max(MIN_IOD_SHARP, LEAD_SHARE * lead) and f.get("eyeSharp") is not None and f.get("midSharp") is not None:
                    # Eyes shut in one and open in the other changes the eye region's
                    # texture by itself — that pair says nothing about focus.
                    sharp = [(m, g) for m, g in peers if g.get("eyeSharp") is not None and g.get("midSharp") is not None
                             and abs(g.get("blink", 0) - f.get("blink", 0)) < 0.3]
                    if sharp:
                        m, g = max(sharp, key=lambda x: x[1]["eyeSharp"] + x[1]["midSharp"])
                        if (g["eyeSharp"] - f["eyeSharp"] >= SOFT_DROP and g["midSharp"] - f["midSharp"] >= SOFT_DROP
                                and not any(r["code"] == "soft" for r in reasons[n])):
                            reasons[n].append({"code": "soft", "label": "פחות חדה", "ref": m,
                                               "face": feats[n]["faces"].index(f)})

    # The star of each twin group: no defect first, then everyone's eyes most
    # open, then the sharpest faces.
    def score(n):
        faces = [f for f in feats[n]["faces"] if "iod" in f]
        eyes = -sum(f.get("blink", 0) for f in faces)
        sharp = sum((f.get("eyeSharp") or 0) + (f.get("midSharp") or 0) for f in faces) / max(1, len(faces))
        return (0 if reasons[n] else 1, eyes, sharp)

    moment_of, twin_of, star = {}, {}, set()
    for i, m in enumerate(moments):
        for n in m:
            moment_of[n] = i
    for i, g in enumerate(twins):
        best = max(g, key=score)
        star.add(best)
        for n in g:
            twin_of[n] = i

    frames = []
    for n in order:
        g = twin_of.get(n)
        suggestion = None
        if n in unread:
            suggestion = "unread"
        elif reasons[n]:
            suggestion = "remove"
        elif g is not None and n not in star:
            suggestion = "duplicate"
            best = next(s for s in twins[g] if s in star)
            reasons[n].append({"code": "duplicate", "label": "כמעט זהה", "ref": best})
        frames.append({
            "file": n,
            "moment": moment_of[n],
            "twins": g,
            "star": n in star,
            "suggestion": suggestion,
            "reasons": reasons[n],
            "faces": [{"box": f["box"], **({"blink": f["blink"]} if "blink" in f else {})}
                      for f in feats[n]["faces"]],
        })

    return {
        "frames": frames,
        "pending": pending,
        "moments": len(moments),
        "version": TRIAGE_VERSION,
    }
