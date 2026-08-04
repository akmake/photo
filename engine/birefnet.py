"""Subject alpha from BiRefNet (ONNX, MIT) — the high-resolution mask backend.

The MediaPipe selfie segmenter this replaces takes a 256x256 input. On a
4160px frame that is one mask pixel per 16 image pixels, so hair comes back as
cardboard and any grade applied through the mask leaves a halo. BiRefNet runs
at 1024x1024 — sixteen times the mask detail — which is what makes it possible
to grade the subject and the background differently without the seam showing.

Nothing here generates pixels. The model returns one channel: how much of each
pixel belongs to the subject.

Kept deliberately dependency-light: plain onnxruntime on the same session the
rest of the engine uses, no timm, no transformers, no trust_remote_code.
"""

import hashlib
import os
import threading

import cv2
import numpy as np

MODEL = os.path.join(os.path.dirname(__file__), "models", "birefnet_lite.onnx")
SIZE = 1024

# ImageNet normalisation — from the model's own preprocessor_config.json.
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_lock = threading.Lock()
_session = None


def available() -> bool:
    return os.path.exists(MODEL)


def _instance():
    global _session
    with _lock:
        if _session is None:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            # The engine already serialises image work onto one worker thread;
            # letting ORT spawn its own pool on top just thrashes the cache.
            opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) // 2)
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            # The CPU memory arena is a false economy here. BiRefNet-lite's 1024²
            # activations are large, and ORT's BFCArena keeps every byte it ever
            # touches resident — then GROWS on the next run. Measured on a 20MP
            # frame: 6.6GB retained after one call, 11GB after two, versus a peak
            # of 9GB for the whole pipeline that was really this one arena. With
            # the arena off the buffers are freed back to the OS between runs:
            # 590MB resident, and the run is actually ~2x faster without the
            # allocator churn. We call this at most once per frame, so pooling
            # buys nothing anyway.
            opts.enable_cpu_mem_arena = False
            _session = ort.InferenceSession(
                MODEL, sess_options=opts, providers=["CPUExecutionProvider"]
            )
    return _session


def _prep(rgb: np.ndarray) -> np.ndarray:
    small = cv2.resize(rgb, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
    x = small.astype(np.float32) / 255.0
    x = (x - MEAN) / STD
    return np.ascontiguousarray(x.transpose(2, 0, 1)[None])


def _cache_path(x: np.ndarray) -> str:
    """Keyed on the model INPUT, so it is keyed on the picture and nothing else.

    Hashing the prepared tensor rather than the source frame means two requests
    that differ only in how they got here — a different display width, a
    different recipe — land on the same entry, which is the whole point: the
    subject does not move when the grade changes.
    """
    base = (
        os.environ.get("TEZA_HOME")
        or os.environ.get("LOCALAPPDATA")
        or os.path.expanduser("~")
    )
    digest = hashlib.blake2b(x.tobytes(), digest_size=16).hexdigest()
    return os.path.join(base, "TEZA", "cache", "subject", f"{digest}.npy")


def subject_alpha(rgb: np.ndarray) -> np.ndarray:
    """(H, W) float32 alpha in 0..1. Raises if the model is missing.

    THE SINGLE MOST EXPENSIVE THING IN A GRADED PREVIEW. Profiled at 6.4s of
    onnxruntime per frame, against 241ms for the colour maths the preview is
    actually there to show — and it was paid again for every width and every
    time the look changed, because nothing above this line knew it could be
    reused. It is cached at the model's own 1024px output, before the upscale
    and the edge refinement, so a cached frame goes through exactly the same
    arithmetic on the way out as a freshly inferred one.
    """
    if not available():
        raise FileNotFoundError(f"BiRefNet weights not found at {MODEL}")

    x = _prep(rgb)
    cached_at = _cache_path(x)
    out = None
    try:
        out = np.load(cached_at)
    except Exception:  # noqa: BLE001 — a bad cache file is not a failure
        out = None

    if out is None:
        sess = _instance()
        out = sess.run(None, {"input_image": x})[0]
        try:
            os.makedirs(os.path.dirname(cached_at), exist_ok=True)
            tmp = cached_at + ".tmp"
            np.save(tmp, out)
            os.replace(tmp, cached_at)
        except OSError:
            pass  # a cache that cannot be written still serves pixels

    alpha = np.squeeze(out).astype(np.float32)
    if alpha.min() < 0.0 or alpha.max() > 1.0:  # some exports emit logits
        alpha = 1.0 / (1.0 + np.exp(-alpha))

    h, w = rgb.shape[:2]
    alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LINEAR)

    # The model is sharp but works at 1024; snapping the upscaled alpha to the
    # real image edges recovers the strand detail the resize softens.
    if hasattr(cv2, "ximgproc"):
        try:
            radius = max(4, int(0.006 * max(h, w)))
            a8 = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
            refined = cv2.ximgproc.guidedFilter(rgb, a8, radius, 250.0)
            alpha = refined.astype(np.float32) / 255.0
        except cv2.error:
            pass

    return np.clip(alpha, 0.0, 1.0)
