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
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

import paths

MODEL = paths.model_path("birefnet_lite.onnx")
# The same network with its deformable convolutions run as GridSample — ~1.9x
# faster, alpha within 1e-4 (birefnet_fast.py). Used whenever setup_models.py
# has derived it; the original stays the fallback and the source of truth.
FAST_MODEL = paths.model_path("birefnet_lite_fast.onnx")
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
                FAST_MODEL if os.path.exists(FAST_MODEL) else MODEL,
                sess_options=opts, providers=["CPUExecutionProvider"]
            )
    return _session


def _prep(rgb: np.ndarray) -> np.ndarray:
    small = cv2.resize(rgb, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
    x = small.astype(np.float32) / 255.0
    x = (x - MEAN) / STD
    return np.ascontiguousarray(x.transpose(2, 0, 1)[None])


def _cache_path(x: np.ndarray, rgb: np.ndarray, key=None) -> str:
    """Keyed on the PHOTOGRAPH when it has a name, else on the model input.

    Hashing the prepared tensor made the key depend on the width the frame
    arrived at: the strip (640) and the edit screen (~1200) resize to 1024 from
    different pixels, so the same photograph was inferred twice (measured on
    disk: two `subject` files per frame, ~3s each). A named photograph -- path,
    mtime and size, see previews._photo_key -- is the same subject at every
    width, so it is inferred once. Unnamed pixels keep the tensor hash.
    """
    base = (
        os.environ.get("TEZA_HOME")
        or os.environ.get("LOCALAPPDATA")
        or os.path.expanduser("~")
    )
    if key:
        h, w = rgb.shape[:2]
        name = f"id-{hashlib.blake2b(f'{key}|{round(w / float(h), 2)}'.encode('utf-8'), digest_size=16).hexdigest()}"
    else:
        name = hashlib.blake2b(x.tobytes(), digest_size=16).hexdigest()
    return os.path.join(base, "TEZA", "cache", "subject", f"{name}.npy")


def _whole_frame_key():
    """The photograph being rendered, unless this call is on a named crop."""
    import masks

    if getattr(masks._source, "scope", ()):
        return None
    return getattr(masks._source, "key", None)


def _infer(x: np.ndarray, cached_at: str) -> np.ndarray:
    try:
        out = _instance().run(None, {"input_image": x})[0]
        try:
            os.makedirs(os.path.dirname(cached_at), exist_ok=True)
            # ".tmp.npy", not ".tmp": np.save APPENDS ".npy" to any name that
            # lacks it, so this wrote "<digest>.npy.tmp.npy" and the replace
            # below renamed a path that did not exist. The OSError went into
            # the handler underneath and the cache stored nothing, ever — every
            # file in the subject cache was an orphaned temp, and the 6.4s
            # below was paid again on every single frame.
            tmp = f"{cached_at}.{os.getpid()}.{threading.get_ident()}.tmp.npy"
            np.save(tmp, out)
            os.replace(tmp, cached_at)
        except OSError:
            pass  # a cache that cannot be written still serves pixels
        return out
    finally:
        with _inflight_lock:
            _inflight.pop(cached_at, None)


# ---------------------------------------------------------------- starting early
#
# Opening a frame nobody prepared runs the retouch tools first and reaches the
# subject mask seconds later, and only THEN pays ~3.3s for it — although the
# answer depends on nothing but the photograph, and was knowable the moment the
# frame was opened. `start()` begins that inference on a thread of its own as
# soon as a render begins, so it runs WHILE the face tools do; when the pipeline
# gets to it, `subject_alpha` waits for the run already under way.
#
# Identical by construction: the same input tensor, the same session, and the
# waiting call receives that very output. It is safe off the image worker
# because onnxruntime's `run` is thread-safe — unlike MediaPipe, which is why
# only THIS model is started early.
_inflight = {}                 # cache path -> Future of the raw output
_inflight_lock = threading.Lock()
_early = ThreadPoolExecutor(max_workers=1, thread_name_prefix="subject-early")


def start(rgb: np.ndarray, key=None) -> bool:
    """Begin inferring `rgb` in the background, unless it is cached or running.

    `rgb` must be the frame `subject_alpha` will later be asked about — the
    mask-resolution frame, `common.downscale` of the source. -> True if started.
    """
    if not available():
        return False
    x = _prep(rgb)
    cached_at = _cache_path(x, rgb, key)
    if os.path.exists(cached_at):
        return False
    with _inflight_lock:
        if cached_at in _inflight:
            return False
        _inflight[cached_at] = _early.submit(_infer, x, cached_at)
    return True


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
    cached_at = _cache_path(x, rgb, _whole_frame_key())
    out = None
    try:
        out = np.load(cached_at)
    except Exception:  # noqa: BLE001 — a bad cache file is not a failure
        out = None

    if out is None:
        # Already being inferred — started early by `start()` — so wait for
        # that run instead of paying for a second one.
        with _inflight_lock:
            running = _inflight.get(cached_at)
        if running is not None:
            out = running.result()
        else:
            # it may have finished between the read above and the lookup
            try:
                out = np.load(cached_at)
            except Exception:  # noqa: BLE001
                out = _infer(x, cached_at)

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
