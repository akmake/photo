"""זהות — who this album is actually about.

The gap this closes is the worst one left in the auto-album: with only sharpness
and face size to go on, a crisp frame of a stranger at the back of the room can
win a full-spread hero while the couple gets a thumbnail. No amount of layout
quality survives that. A book has protagonists.

**No face-recognition model is downloaded, and that is a decision, not a
shortcut.** The obvious choice, InsightFace/ArcFace, ships weights licensed for
non-commercial research only — the same objection that got DINOv3 rejected from
this stack. So this runs on DINOv2, which is Apache-2.0 and already on the disk.

That is a weaker identity signal in general, and much stronger than it sounds
HERE, because the problem is far easier than face recognition in the wild:

  * one event, one day, one set of clothes, one lighting scheme
  * a handful of distinct people, not a database of millions
  * the question is "who recurs", not "who is this person"

So the crop deliberately includes hair, shoulders and clothing rather than the
face alone — within a single event those are as identifying as the face, and
DINOv2 reads them well. If a real set proves this too coarse, the interface here
does not change: only `_face_vector` gets a better model behind it.

Nothing is named. The output is "person 1 appears in 143 frames" — the
photographer attaches the names, if they want any.
"""

import hashlib
import os

import cv2
import numpy as np

import common
import embed

IDENTITY_VERSION = 1

# How much context around the face box goes into the crop, as a multiple of the
# face's own size. Generous on purpose: within one event the hair, the collar
# and the dress carry as much identity as the features do.
CROP_PAD_X = 0.9
CROP_PAD_TOP = 0.7
CROP_PAD_BOTTOM = 1.6

# A face smaller than this in the original file has no identity to read — the
# crop would be an upscaled smear. Such faces are reported, never clustered.
MIN_FACE_PX = 70

# Cosine over the crop vectors above which two faces are the same person.
# Deliberately cautious: splitting one person into two identities costs a hero
# spread, merging two people into one costs the album its protagonist.
SAME_PERSON = 0.72


def _cache_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "TEZA", "cache", "identity")


def _cache_path(path, index):
    norm = os.path.normcase(os.path.abspath(path))
    try:
        stat = os.stat(path)
        stamp = f"{stat.st_mtime_ns}:{stat.st_size}"
    except OSError:
        stamp = "0:0"
    key = hashlib.sha1(
        f"{IDENTITY_VERSION}|{norm}|{stamp}|{index}".encode("utf-8")
    ).hexdigest()
    return os.path.join(_cache_dir(), f"{key}.npy")


def _crop(rgb, box):
    """The face box, opened out to include hair, shoulders and clothing."""
    h, w = rgb.shape[:2]
    fw = box["width"] * w
    fh = box["height"] * h
    if fw < 1 or fh < 1:
        return None
    x0 = int(round(box["x"] * w - fw * CROP_PAD_X))
    x1 = int(round((box["x"] + box["width"]) * w + fw * CROP_PAD_X))
    y0 = int(round(box["y"] * h - fh * CROP_PAD_TOP))
    y1 = int(round((box["y"] + box["height"]) * h + fh * CROP_PAD_BOTTOM))
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 - x0 < 16 or y1 - y0 < 16:
        return None
    return rgb[y0:y1, x0:x1]


def _face_vector(crop_rgb):
    """A DINOv2 vector for one person-crop, L2-normalised.

    Uses the album's existing session rather than a second model — same weights,
    same preprocessing recipe, so the numbers live in one space and one download
    covers the whole pipeline."""
    size = embed._INPUT
    h, w = crop_rgb.shape[:2]
    scale = size / float(min(h, w))
    rh, rw = max(size, round(h * scale)), max(size, round(w * scale))
    img = cv2.resize(crop_rgb, (rw, rh), interpolation=cv2.INTER_AREA)
    y0, x0 = (rh - size) // 2, (rw - size) // 2
    patch = img[y0:y0 + size, x0:x0 + size].astype(np.float32) / 255.0
    patch = (patch - embed._IMAGENET_MEAN) / embed._IMAGENET_STD
    tensor = np.transpose(patch, (2, 0, 1))[None, ...].astype(np.float32)

    sess = embed._session_instance()
    out = np.asarray(
        sess.run(None, {embed._input_name: tensor})[0]
    ).reshape(-1).astype(np.float32)
    norm = float(np.linalg.norm(out))
    return out / norm if norm > 1e-8 else out


def faces_of(path, boxes, rgb=None):
    """Vectors for every readable face in one frame, cached per face.

    Returns a list aligned with `boxes`; an entry is None when the face was too
    small to read. None is a THIRD answer here — "no identity available" is not
    "not one of the principals", and the caller must not collapse them."""
    out = []
    loaded = rgb
    for index, box in enumerate(boxes):
        at = _cache_path(path, index)
        try:
            out.append(np.load(at))
            continue
        except (OSError, ValueError):
            pass

        if loaded is None:
            loaded = common.to_np(common.load_image(path))
        h, w = loaded.shape[:2]
        if box["width"] * w < MIN_FACE_PX:
            out.append(None)
            continue

        crop = _crop(loaded, box)
        if crop is None:
            out.append(None)
            continue

        vector = _face_vector(crop)
        try:
            os.makedirs(os.path.dirname(at), exist_ok=True)
            np.save(at, vector)
        except OSError:
            pass
        out.append(vector)
    return out


def load_cached(path, index):
    try:
        return np.load(_cache_path(path, index))
    except (OSError, ValueError):
        return None


def cluster(frames, threshold=SAME_PERSON):
    """Group every readable face in the set into people.

    `frames` is [{path, faces: [box, ...]}]. Single-link agglomeration over
    cosine, the same shape as the dedup clustering: a person photographed
    turning through a scene forms a chain of near-neighbours, and single link is
    what keeps that chain one person instead of five.

    Identities are ranked by how many DISTINCT FRAMES they appear in, not by how
    many faces — someone caught twice in one group shot is not twice as present.
    """
    items = []          # (path, face index, vector)
    unreadable = 0
    for frame in frames:
        path = frame["path"]
        boxes = frame.get("faces") or []
        for index in range(len(boxes)):
            vector = load_cached(path, index)
            if vector is None:
                unreadable += 1
            else:
                items.append((path, index, vector))

    n = len(items)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    if n:
        mat = np.stack([v for _, _, v in items]).astype(np.float32)
        sims = mat @ mat.T
        iu = np.triu_indices(n, k=1)
        for h in np.where(sims[iu] >= threshold)[0]:
            a, b = int(iu[0][h]), int(iu[1][h])
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

    buckets = {}
    for idx, (path, index, _) in enumerate(items):
        buckets.setdefault(find(idx), []).append((path, index))

    identities = []
    for members in buckets.values():
        paths = sorted({p for p, _ in members})
        identities.append({"frames": paths, "faces": len(members)})
    identities.sort(key=lambda d: -len(d["frames"]))

    for position, identity in enumerate(identities):
        identity["id"] = f"person-{position + 1}"

    return {
        "identities": identities,
        "readableFaces": n,
        "unreadableFaces": unreadable,
        "threshold": float(threshold),
    }


# An identity has to carry a real share of the event to be a protagonist. Below
# this it is a guest who happened to be photographed a few times.
PRINCIPAL_SHARE = 0.22
MAX_PRINCIPALS = 3


def principals(identities, total_frames):
    """Who the album is about: the identities present across enough of the event.

    Capped, because "everyone is a protagonist" is the same as none. A set where
    nobody clears the bar returns an empty list — a venue shoot or a product day
    genuinely has no protagonist, and inventing one would be worse than the
    album having no heroes to promote."""
    if not total_frames:
        return []
    out = []
    for identity in identities[:MAX_PRINCIPALS]:
        share = len(identity["frames"]) / float(total_frames)
        if share >= PRINCIPAL_SHARE:
            out.append({**identity, "share": round(share, 4)})
    return out
