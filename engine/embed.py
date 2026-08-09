"""Visual fingerprints for the album — DINOv2 ViT-S/14 (Apache 2.0) via onnxruntime.

One 384-d embedding per frame, L2-normalised. This is the semantic backbone the
whole auto-album rests on: near-duplicate detection, clustering into moments,
hero selection and the taste head are all cosine distance over these vectors.

DINOv2 and not a newer or text-aligned model, on purpose (docs/RESEARCH-album-ai.md):
it leads open models at fine-grained VISUAL similarity — telling two near-identical
frames apart — which is exactly what dedup and hero-picking need, where a CLIP/SigLIP
embedding would squash them together because they are both "a wedding". It is also
Apache 2.0 and ungated, unlike DINOv3, so it can be bundled and shipped locally.

Like depth.py, onnxruntime is imported LAZILY: its native DLL costs ~20s to load on
this machine, and the album is not touched every session. The server stays up the
moment it prints its listening line; the cost is paid on the first embed.

Embeddings are cached to disk keyed by (file, mtime, model, EMBED_VERSION): the
vector for a frame that has not changed is read back in microseconds, so a second
pass over a folder is free. The version is in the key ON PURPOSE — a cache that
outlives the code that filled it serves yesterday's numbers (the mask-cache lesson).
No pixels are cached, only the 384 floats — the photographs never leave the disk.
"""

import hashlib
import os
import threading

import numpy as np

import common

MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "dinov2_vits14.onnx")
MODEL_ID = "dinov2_vits14"
# Bump when anything about how a vector is produced changes — preprocessing, the
# model, the crop. Old cached vectors under the old key are then simply ignored.
EMBED_VERSION = 1
DIM = 384
_INPUT = 224  # 16 x 14 — a whole number of DINOv2's 14px patches

_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_lock = threading.Lock()
_session = None
_input_name = None


class ModelMissing(RuntimeError):
    """The DINOv2 weights were never fetched. A setup fact, not a per-file fault —
    the caller says it once for the whole run rather than N identical errors."""


def _session_instance():
    global _session, _input_name
    with _lock:
        if _session is None:
            if not os.path.exists(MODEL_PATH):
                raise ModelMissing(
                    "מודל DINOv2 לא הותקן. הרץ: .venv/Scripts/python setup_models.py"
                )
            import onnxruntime as ort  # lazy — see the note at the top of the file
            _session = ort.InferenceSession(
                MODEL_PATH, providers=["CPUExecutionProvider"]
            )
            _input_name = _session.get_inputs()[0].name
    return _session


def _cache_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "TEZA", "cache", "embed")


def _cache_path(path):
    """Keyed by mtime as well as path: re-editing the file in another program has
    to invalidate its vector, and the version guards against a code change.

    The path is NORMALISED first — same file, same key, whether it arrived with
    forward or back slashes and whatever the drive-letter case. On Windows the two
    spellings are the same file, and a cache keyed on the raw string would embed
    it twice and never hit."""
    try:
        norm = os.path.normcase(os.path.abspath(path))
    except (OSError, ValueError):
        norm = path
    try:
        stamp = os.path.getmtime(path)
    except OSError:
        stamp = 0
    ident = hashlib.sha1(
        f"{EMBED_VERSION}|{MODEL_ID}|{norm}|{stamp}".encode("utf-8")
    ).hexdigest()
    return os.path.join(_cache_dir(), f"{ident}.npy")


def _preprocess(path):
    """Resize the short side to 224 and centre-crop — DINOv2's own eval recipe.
    Keeping the aspect ratio matters: squashing a wide frame to a square before it
    is understood is a distortion the embedding would then be measuring."""
    import cv2

    rgb = common.to_np(common.load_image(path))  # HxWx3 uint8, EXIF-upright
    h, w = rgb.shape[:2]
    scale = _INPUT / float(min(h, w))
    rh, rw = max(_INPUT, round(h * scale)), max(_INPUT, round(w * scale))
    img = cv2.resize(rgb, (rw, rh), interpolation=cv2.INTER_AREA)
    y0, x0 = (rh - _INPUT) // 2, (rw - _INPUT) // 2
    crop = img[y0:y0 + _INPUT, x0:x0 + _INPUT].astype(np.float32) / 255.0
    crop = (crop - _IMAGENET_MEAN) / _IMAGENET_STD
    return np.transpose(crop, (2, 0, 1))[None, ...].astype(np.float32)


def embed_path(path, use_cache=True):
    """One frame -> (vector: float32[384] L2-normalised, cached: bool).

    Normalised so cosine similarity is a plain dot product downstream. Raises
    ModelMissing when the weights are absent, and any decode/inference error per
    frame to the caller — a frame that will not open must not abort the set."""
    cache_at = _cache_path(path)
    if use_cache:
        try:
            return np.load(cache_at), True
        except (OSError, ValueError):
            pass  # no cache or a corrupt one — recompute

    sess = _session_instance()
    tensor = _preprocess(path)
    out = np.asarray(sess.run(None, {_input_name: tensor})[0]).reshape(-1).astype(np.float32)
    norm = float(np.linalg.norm(out))
    if norm > 1e-8:
        out = out / norm

    try:
        os.makedirs(os.path.dirname(cache_at), exist_ok=True)
        np.save(cache_at, out)
    except OSError:
        pass  # a cache that cannot be written still returns the vector

    return out, False


def load_cached(path):
    """The stored vector for a frame, or None if it was never embedded. Lets a
    later stage (dedup, clustering) read the whole set without recomputing."""
    try:
        return np.load(_cache_path(path))
    except (OSError, ValueError):
        return None


# Cosine at or above this is "the same shot again" — a burst frame, a re-take.
# Measured (docs/RESEARCH-album-ai.md, verify_embed): exact/exposure/small-crop
# near-dups sit 0.98-1.0, a different scene sits under 0.1, so the boundary is
# wide and 0.92 sits safely inside it. Exposed so the UI can widen or tighten it.
DEDUP_THRESHOLD = 0.92


def group_near_duplicates(paths, threshold=DEDUP_THRESHOLD):
    """Cluster a set into near-duplicate groups over the cached vectors.

    Reads vectors from the cache only — קליטה must have run — so this is cheap to
    re-run at a new threshold. Frames with no vector yet come back in `missing`,
    NOT silently dropped: a frame that was never embedded is a different fact from
    a frame with no duplicate, and collapsing the two would tell the photographer
    a set is unique when it was merely unread (CLAUDE.md §3).

    Vectors are L2-normalised, so cosine is a plain dot product. A frame joins a
    group when it is within `threshold` of ANY member (single-link), which is what
    makes a slow pan across a burst end up in one group rather than a chain of
    barely-overlapping pairs. Only groups of two or more are returned — a unique
    frame is not a "group of one".
    """
    vecs, missing, embedded = {}, [], []
    for p in paths:
        v = load_cached(p)
        if v is None:
            missing.append(p)
        else:
            vecs[p] = v
            embedded.append(p)

    n = len(embedded)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    if n:
        mat = np.stack([vecs[p] for p in embedded]).astype(np.float32)
        sims = mat @ mat.T
        iu = np.triu_indices(n, k=1)
        for h in np.where(sims[iu] >= threshold)[0]:
            a, b = int(iu[0][h]), int(iu[1][h])
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

    buckets = {}
    for idx, p in enumerate(embedded):
        buckets.setdefault(find(idx), []).append(p)
    # Real duplicate groups only; keep members in the order given (capture order),
    # and put the biggest bursts first.
    groups = sorted((g for g in buckets.values() if len(g) > 1), key=lambda g: -len(g))
    in_dups = sum(len(g) for g in groups)
    return {
        "groups": groups,
        "missing": missing,
        "embedded": n,
        "duplicateFrames": in_dups,
        "threshold": float(threshold),
    }
