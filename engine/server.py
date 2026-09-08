"""Local AI tool engine (sidecar).

A tiny dependency-light HTTP server the desktop app talks to over localhost.
In the packaged Electron app this process is spawned as a sidecar; images never
leave the machine. Each AI tool is dispatched under /tools/{id}/apply.
"""

import base64
import hashlib
import io
import json
import os
import subprocess
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# THE STARTUP NOISE IS NOT OURS, AND IT CANNOT BE TURNED OFF FROM HERE.
#
# Every start prints five or six lines that look like failures and are not:
#
#   W0000 ... face_landmarker_graph.cc:180] Sets FaceBlendshapesGraph
#             acceleration to xnnpack by default.
#   INFO: Created TensorFlow Lite XNNPACK delegate for CPU.
#   W0000 ... inference_feedback_manager.cc:121] Feedback manager requires a
#             model with a single signature inference.
#
# MediaPipe and TFLite talking to themselves about internal acceleration. The
# engine is fine; the line that matters is `engine listening on ...`.
#
# TRIED AND MEASURED, does not work: GLOG_minloglevel, TF_CPP_MIN_LOG_LEVEL,
# GRPC_VERBOSITY and ABSL_LOGGING_MIN_SEVERITY set before the imports. All five
# lines still appeared. They are written straight to stderr by the native layer,
# which never consults these. Silencing them needs the process's stderr file
# DESCRIPTOR redirected around every MediaPipe call — which would swallow real
# errors from the same stream, and a quiet log that hides failures is a worse
# trade than a noisy one that does not. Left alone deliberately.

from PIL import Image, ImageOps

import abpn
import blush
import common
import eyes
import hairtone
import presets
import raw
import render
import skin
import background
import cleanup
import compare
import grade_zones
import hsl
import recipe_fit
import pixel_color
import album_analysis
import album_export
import album_render
import cull
import embed
import identity
import workspace
import cloud_sources
import storage_locations
import db
import gallery
import gallery_store

PORT = 8756

# Every request arrives on a NEW thread (ThreadingHTTPServer), and MediaPipe's
# task objects are not thread-safe: masks.py locks their CREATION but the
# .detect() / .segment() calls themselves ran on whatever thread the request
# landed on, and those threads are destroyed the moment the response is sent.
# That crashed the sidecar with a segfault after a batch of renders.
#
# One long-lived worker owns all image work: MediaPipe is always entered from
# the same thread, and that thread never exits. The HTTP layer stays threaded
# so /health still answers while a render is in flight.
_WORKER = ThreadPoolExecutor(max_workers=1, thread_name_prefix="engine-image")


def on_worker(fn, *args, **kwargs):
    """Run image work on the one thread allowed to touch the models."""
    return _WORKER.submit(fn, *args, **kwargs).result()


# ------------------------------------------------------------- the warm queue
#
# The first graded view of a frame costs ~15s, nearly all of it segmentation
# (docs/BUGS.md BUG-002). The caches make that a once-per-photograph cost, but
# it was still being paid while the photographer waited for it.
#
# So it is paid in advance instead: applying a look, or opening a batch, hands
# the set to this queue and it renders ahead of where the eye is.
#
# It submits to the SAME single worker, deliberately. Rendering two frames at
# once was measured SLOWER than one after another — 7 frames took 82s in
# parallel against 48s sequentially — so a second lane would cost the
# interactive request it was meant to protect.
#
# LIFO, not FIFO: what the photographer just asked for matters more than what
# they asked for a minute ago, and a queue that answers in the order requests
# arrived makes the newest click wait longest.
_WARM_LOCK = threading.Lock()
_WARM_STACK = []          # (key, path, width) — most recent last
_WARM_SEEN = set()        # de-dupe; a set re-opened twice must not queue twice
_WARM_THREAD = None


class _Interactive:
    """How many requests a person is currently waiting on."""

    def __init__(self):
        self._n = 0
        self._lock = threading.Lock()

    @property
    def value(self):
        return self._n

    def __enter__(self):
        with self._lock:
            self._n += 1
        return self

    def __exit__(self, *exc):
        with self._lock:
            self._n -= 1
        return False


_INTERACTIVE = _Interactive()


def _warm_loop():
    while True:
        # BACK OFF WHILE SOMEONE IS WAITING. There is one worker, so a warm job
        # already running makes the next interactive render wait up to ~12s
        # behind it. Warming exists to remove waiting, so it must never be the
        # thing being waited for.
        if _INTERACTIVE.value:
            time.sleep(0.2)
            continue
        with _WARM_LOCK:
            job = _WARM_STACK.pop() if _WARM_STACK else None
        if job is None:
            time.sleep(0.35)
            continue
        key, path, width = job
        try:
            recipe = _recall_recipe(key) if key else []
            if recipe is None or not os.path.isfile(path):
                continue
            target = _proxy_path(key or "raw", path, width)
            if os.path.exists(target):
                continue
            data = on_worker(_render_proxy, path, width, recipe)
            _store_proxy(target, data)
        except Exception:  # noqa: BLE001 — warming must never take the engine down
            pass


def warm(key, paths, width=None):
    """Queue frames to be rendered before anyone asks for them."""
    global _WARM_THREAD
    width = width or _PROXY_CANON
    with _WARM_LOCK:
        for p in paths:
            token = (key, p, width)
            if token in _WARM_SEEN:
                continue
            _WARM_SEEN.add(token)
            _WARM_STACK.append(token)
        if _WARM_THREAD is None:
            _WARM_THREAD = threading.Thread(
                target=_warm_loop, name="engine-warm", daemon=True
            )
            _WARM_THREAD.start()
        return len(_WARM_STACK)


# --------------------------------------------------------------- the proxy cache
#
# A project's recipe is non-destructive: nothing is written to disk until the
# photographer asks for files. That is the whole point — but it means every
# thumbnail in a folder view is a RENDER, and a set is hundreds of frames.
# Re-rendering them on every scroll would make the model unusable, so a rendered
# proxy is cached per (recipe, file, size) and served straight from disk on the
# second look.
#
# The recipe is registered once and addressed by key afterwards, so previews stay
# GET requests: that keeps <img loading="lazy"> working, which is what stops a
# 2,000-frame folder from asking for 2,000 renders it will never show.

def _cache_root():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "TEZA", "cache")


_RECIPES = {}
_RECIPES_LOCK = threading.Lock()


def _recipe_hash(recipe):
    blob = json.dumps(recipe, sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


def _recipe_path(key):
    return os.path.join(_cache_root(), "recipes", f"{key}.json")


def _remember_recipe(recipe):
    """-> key. Persisted, so a preview URL survives an engine restart."""
    key = _recipe_hash(recipe)
    with _RECIPES_LOCK:
        _RECIPES[key] = recipe
    path = _recipe_path(key)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(recipe, fh)
    except OSError:
        pass  # the in-memory copy still answers this session
    return key


def _recall_recipe(key):
    """-> recipe, or None when this engine has never been told what `key` means.

    None is not a failure: the client re-registers and retries. Guessing an
    empty recipe instead would silently serve the RAW frame under a URL that
    promises the edit, which is the exact confusion this whole model removes.
    """
    with _RECIPES_LOCK:
        cached = _RECIPES.get(key)
    if cached is not None:
        return cached
    try:
        with open(_recipe_path(key), "r", encoding="utf-8") as fh:
            recipe = json.load(fh)
    except (OSError, ValueError):
        return None
    with _RECIPES_LOCK:
        _RECIPES[key] = recipe
    return recipe


# Bump when anything about how a proxy is produced changes — sizing, quality,
# the pipeline. The recipe key covers the RECIPE changing and the mtime covers
# the FILE changing, but neither notices that the engine now draws it
# differently, and a cache that outlives the code it came from serves
# yesterday's pixels under today's key. Caught exactly that way: a sizing fix
# looked like it had not worked, because the stale proxy was still being served.
_PROXY_VERSION = 3

# THE ONE SIZE A GRADED FRAME IS EVER RENDERED AT.
#
# Rendering is not proportional to the output size — it is dominated by a fixed
# per-frame cost. `pixel-color` needs subject, skin and material masks to know
# what to protect, and those come from MobileSAM and MediaPipe: measured at
# ~11-12s for a frame it has not seen, against 241ms for the colour maths
# itself. The masks depend on the PICTURE, not on how big it is being shown.
#
# So a width-keyed cache made the product pay that ~12s once per width. The
# strip asks for 200, the picker 320, the contact sheet 520 — three full
# segmentations of the same photograph, ~36s a frame, and seven frames took the
# minutes that were reported.
#
# Now: render once at this width, cache THAT, and derive every requested size
# from it by resizing — which costs single-digit milliseconds. 640 because it is
# the floor the masks are already computed at (see _render_proxy) and it covers
# every grid and strip in the product; anything larger is a rarity and is
# rendered on demand at its own size.
_PROXY_CANON = 640


def _proxy_path(key, src_path, width):
    """Keyed by mtime as well as path: editing the file in another program has
    to invalidate the proxy, or the set would keep showing yesterday's frame."""
    try:
        stamp = os.path.getmtime(src_path)
    except OSError:
        stamp = 0
    ident = hashlib.sha1(
        f"{_PROXY_VERSION}|{src_path}|{stamp}|{width}".encode("utf-8")
    ).hexdigest()
    return os.path.join(_cache_root(), "proxy", key, f"{ident}.jpg")


def _read_proxy(p):
    try:
        with open(p, "rb") as fh:
            return fh.read()
    except OSError:
        return None


def _store_proxy(p, blob):
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(blob)
    except OSError:
        pass  # a cache that cannot be written still serves pixels


def _shrink(data, width):
    """Re-size an already-rendered proxy. Milliseconds, and no masks."""
    im = Image.open(io.BytesIO(data))
    size = _fit_size(im.size, width)
    if size != im.size:
        im = im.convert("RGB").resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=82)
    return buf.getvalue()


def _fit_size(size, width):
    """The box a frame lands in at `width`, long edge.

    ONE rule, used by /thumb and /preview alike. They used to size themselves
    independently — thumbnail() twice for the preview, once for the thumb — and
    the two roundings disagreed by a pixel (213 vs 214 on the same file). In a
    grid that is a row of frames that do not line up, and between the raw frame
    and the graded one it makes an A/B comparison impossible.
    """
    w, h = size
    longest = max(w, h)
    if longest <= width:
        return (w, h)
    scale = width / float(longest)
    return (max(1, round(w * scale)), max(1, round(h * scale)))


def _decode_small(path, width):
    """Decode small. Reading a 20MP frame to show it at 320px costs about twenty
    times more, and libjpeg can downscale while it decodes.

    Returns the frame and THE FILE'S OWN long edge, read before the draft throws
    it away. Everything downstream that asks "is this face big enough" needs it:
    without it the tools answer about the proxy, and a strip drawn at 320px
    would report every face in the set as too small to touch. Rotation does not
    change a long edge, so this survives `exif_transpose`.
    """
    im = Image.open(path)
    source_long = max(im.size)
    im.draft("RGB", (width * 2, width * 2))
    return ImageOps.exif_transpose(im).convert("RGB"), source_long


def _render_proxy(path, width, recipe):
    im, source_long = _decode_small(path, width)
    # Decided BEFORE rendering, from the frame as decoded — so the answer does
    # not depend on how many times the image was resized on the way here.
    out_size = _fit_size(im.size, width)

    if recipe:
        # Rendered a little larger than it is shown: face and subject masks get
        # unreliable below a few hundred pixels, and a proxy that disagrees with
        # the delivered file about WHERE a tool landed is worse than a slow one.
        work = _fit_size(im.size, max(width, 640))
        if work != im.size:
            im = im.resize(work, Image.LANCZOS)
        im, _ = render.render(im, recipe, source_long / float(max(im.size)))

    if im.size != out_size:
        im = im.resize(out_size, Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82)
    return buf.getvalue()

# Tool registry (mirrors the front-end registry; source of truth for the engine).
TOOLS = [
    {
        "id": "face-retouch",
        "kind": "ai",
        "category": "local-ai",
        "params": [{"id": "strength", "min": 0, "max": 100, "default": 70}],
    },
    {
        "id": "skin-cleanup",
        "kind": "ai",
        "category": "local-ai",
        # Two operators, two dials — see cleanup._params. `strength` is still
        # accepted as a master fallback so older recipes keep rendering.
        #
        # NOTE: this list and src/toolRegistry.ts are the SAME contract declared
        # twice, and they had silently drifted: the UI kept showing one slider at
        # 60 and treating the tool as experimental long after the engine could do
        # better. That is not a cosmetic mismatch — it is the reason a working
        # tool looked broken from the front end. Change both, together.
        "params": [
            {"id": "redness", "min": 0, "max": 100, "default": 90},
            {"id": "spots", "min": 0, "max": 100, "default": 25},
        ],
    },
    {
        "id": "skin",
        "kind": "ai",
        "category": "local-ai",
        # All five, not just `strength`. `skin.apply` has always read `scale`,
        # `evenness`, `texture` and `body` (see skin.py) — only this declaration
        # omitted them, so /tools under-reported the tool by four controls.
        "params": [
            {"id": "strength", "min": 0, "max": 100, "default": 60},
            {"id": "scale", "min": 0, "max": 100, "default": 50},
            {"id": "evenness", "min": 0, "max": 100, "default": 50},
            {"id": "texture", "min": 0, "max": 100, "default": 100},
            {"id": "body", "min": 0, "max": 100, "default": 0},
        ],
    },
    {
        "id": "blush",
        "kind": "ai",
        "category": "local-ai",
        "params": [
            {"id": "strength", "min": 0, "max": 100, "default": 45},
            {"id": "size", "min": 0, "max": 100, "default": 50},
            {"id": "warmth", "min": 0, "max": 100, "default": 35},
        ],
    },
    {
        "id": "eye-sparkle",
        "kind": "ai",
        "category": "local-ai",
        "params": [
            {"id": "strength", "min": 0, "max": 100, "default": 50},
            {"id": "whites", "min": 0, "max": 100, "default": 40},
            {"id": "sparkle", "min": 0, "max": 100, "default": 45},
        ],
    },
    {
        "id": "hair-tones",
        "kind": "ai",
        "category": "local-ai",
        "params": [
            # 45, matching the UI. The two drifted to 50/45, so "reset to
            # default" meant something different depending on which side reset.
            {"id": "strength", "min": 0, "max": 100, "default": 45},
            {"id": "warmth", "min": -100, "max": 100, "default": 40},
            {"id": "shine", "min": 0, "max": 100, "default": 35},
            {"id": "richness", "min": 0, "max": 100, "default": 40},
        ],
    },
    {
        "id": "background-blur",
        "kind": "ai",
        "category": "scene",
        "params": [
            {"id": "amount", "min": 0, "max": 100, "default": 60},
            {"id": "bokeh", "min": 0, "max": 100, "default": 50},
            {"id": "feather", "min": 0, "max": 100, "default": 40},
        ],
    },
]

# id -> callable(image_b64, params) -> (out_b64, meta)
DISPATCH = {
    "face-retouch": abpn.process,
    "skin-cleanup": cleanup.process,
    "skin": skin.process,
    "blush": blush.process,
    "eye-sparkle": eyes.process,
    "hair-tones": hairtone.process,
    "background-blur": background.process,
    "hsl": hsl.process,
    "grade-zones": grade_zones.process,
}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Gallery-Token, X-Teza-Admin",
        )
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self._gallery_api("GET"):
            return
        if self.path.startswith("/gallery-files/"):
            self._gallery_file()
            return
        if self.path.startswith("/oauth/callback/"):
            self._oauth_callback()
            return
        if self.path.startswith("/thumb?"):
            self._thumb()
            return
        if self.path.startswith("/preview?"):
            self._preview()
        if self.path == "/db/health":
            # never 500s: "cannot reach the database" is an ANSWER the screen
            # has to show, not a failure the client should guess at
            self._json(200, db.health())
            return
        if self.path == "/health":
            self._json(200, {"status": "ok", "tools": [t["id"] for t in TOOLS]})
        elif self.path == "/tools":
            self._json(200, {"tools": TOOLS})
        elif self.path == "/presets":
            # One dial for the whole skin stack — see presets.py for why the
            # three strengths are not exposed as three separate decisions.
            self._json(200, {
                "portrait": {
                    "levels": list(presets.PORTRAIT_LEVELS),
                    "default": presets.DEFAULT_LEVEL,
                    "recipes": {
                        name: presets.portrait(name)
                        for name in presets.PORTRAIT_LEVELS
                    },
                }
            })
        else:
            self._json(404, {"error": "not found"})

    def _thumb(self):
        r"""GET /thumb?path=<abs path>&w=<px> -> a JPEG thumbnail.

        The renderer cannot read D:\Shoots\... — a browser has no access to
        the disk, and the whole point of this product is that the files stay
        there. So the engine, which does have access, serves the pixels.

        Thumbnails are generated with draft-mode JPEG decoding: reading a 20MP
        frame in full to show it at 320px costs about twenty times more than
        letting libjpeg downscale while it decodes, and a folder view asks for
        hundreds of these at once.
        """
        try:
            query = urllib.parse.urlparse(self.path).query
            args = urllib.parse.parse_qs(query)
            path = (args.get("path") or [""])[0]
            width = int((args.get("w") or ["320"])[0])
            if not path or not os.path.isfile(path):
                self._json(404, {"error": "not found"})
                return

            im, _ = _decode_small(path, width)  # a thumb runs no tools
            # the same rule /preview uses, so a raw frame and a graded one are
            # never a pixel apart
            size = _fit_size(im.size, width)
            if im.size != size:
                im = im.resize(size, Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=82)
            data = buf.getvalue()

            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            # The file on disk does not change under a stable path, and a folder
            # view re-requests the same frames constantly.
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _preview(self):
        r"""GET /preview?path=<abs>&w=<px>&key=<recipe key> -> a rendered JPEG.

        The same job /thumb does, except the frame is shown AS THE PROJECT'S
        RECIPE LEAVES IT. This is what makes "open the tool and see the edited
        set" true without a single file being written: there is no edited
        folder, there is a recipe, and this endpoint is where it becomes pixels.

        409 means the key is unknown to this engine — the client re-registers
        the recipe and retries. See _recall_recipe for why it is not an empty
        recipe instead.
        """
        try:
            args = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            path = (args.get("path") or [""])[0]
            width = int((args.get("w") or ["320"])[0])
            key = (args.get("key") or [""])[0]
            if not path or not os.path.isfile(path):
                self._json(404, {"error": "not found"})
                return
            recipe = _recall_recipe(key) if key else []
            if recipe is None:
                self._json(409, {"error": "unknown recipe key"})
                return

            read, store = _read_proxy, _store_proxy
            data = read(_proxy_path(key or "raw", path, width))
            graded = data is not None

            # `fast` — answer NOW with whatever is true, and say which it is.
            #
            # A grid of 300 frames must not be 300 blocking 15-second renders.
            # With fast=1 a frame that is not rendered yet comes back as the RAW
            # file immediately, marked X-Teza-Graded: 0, and is queued to be
            # rendered. The client shows it as pending and re-requests when the
            # real one exists.
            #
            # The marking is not optional. Serving an ungraded frame under a URL
            # that promises the edit, with nothing saying so, is exactly the
            # confusion the recipe model exists to remove — so the header is the
            # contract, and the UI is required to show it.
            # Warming renders at the canonical width, so a frame can be fully
            # graded and still have no entry at the width being asked for.
            # Deriving from the canonical costs milliseconds — checking for it
            # here is the difference between a needless raw flash and none.
            if data is None and width <= _PROXY_CANON:
                canon = read(_proxy_path(key or "raw", path, _PROXY_CANON))
                if canon is not None:
                    data = canon if width == _PROXY_CANON else _shrink(canon, width)
                    store(_proxy_path(key or "raw", path, width), data)
                    graded = True

            if data is None and args.get("fast") and recipe:
                warm(key, [path])
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("X-Teza-Graded", "0")
                self.send_header("Access-Control-Expose-Headers", "X-Teza-Graded")
                # Never cached: the next request for this URL must be able to
                # come back graded.
                self.send_header("Cache-Control", "no-store")
                # OFF the worker, deliberately. An empty recipe touches no
                # model — `_render_proxy` is a decode and a resize — so the
                # thread-safety reason the worker exists does not apply, and
                # going through it would queue this reply behind a 12s warm
                # render. Measured before this line: 35s for seven frames to
                # show anything at all.
                raw_bytes = _render_proxy(path, width, [])
                self.send_header("Content-Length", str(len(raw_bytes)))
                self.end_headers()
                self.wfile.write(raw_bytes)
                return

            if data is None:
                # EVERY size below the canonical one is derived from a SINGLE
                # render. Rendering is dominated by per-frame segmentation
                # (~12s), not by output size, so rendering per width paid that
                # cost once per width — three times over for the strip, the
                # picker and the contact sheet. See _PROXY_CANON.
                if width <= _PROXY_CANON:
                    canon_at = _proxy_path(key or "raw", path, _PROXY_CANON)
                    canon = read(canon_at)
                    if canon is None:
                        with _INTERACTIVE:
                            canon = on_worker(_render_proxy, path, _PROXY_CANON, recipe)
                        store(canon_at, canon)
                    data = canon if width == _PROXY_CANON else _shrink(canon, width)
                else:
                    with _INTERACTIVE:
                        data = on_worker(_render_proxy, path, width, recipe)
                store(_proxy_path(key or "raw", path, width), data)

            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-Teza-Graded", "1" if (graded or recipe) else "0")
            self.send_header("Access-Control-Expose-Headers", "X-Teza-Graded")
            # Safe to cache hard: the key changes whenever the recipe changes,
            # and the proxy name changes whenever the file does.
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _preview_ready(self):
        """Which of these frames are rendered — so the client can stop guessing.

        Reading a header off an <img> is not possible, so readiness is asked for
        in one call for a whole screenful rather than inferred per element.
        """
        try:
            body = self._body()
            key = body.get("key") or ""
            paths = body.get("paths") or []
            width = int(body.get("w") or _PROXY_CANON)
            ready = {}
            for p in paths:
                target = _proxy_path(key or "raw", p, width)
                canon = _proxy_path(key or "raw", p, _PROXY_CANON)
                ready[p] = os.path.exists(target) or os.path.exists(canon)
            with _WARM_LOCK:
                pending = len(_WARM_STACK)
            self._json(200, {"ready": ready, "pending": pending})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _preview_warm(self):
        """Render these frames ahead of being asked for them."""
        try:
            body = self._body()
            key = body.get("key") or ""
            paths = body.get("paths") or []
            if not key:
                self._json(200, {"queued": 0})
                return
            queued = warm(key, paths)
            self._json(200, {"queued": queued})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def do_POST(self):
        if self._gallery_api("POST"):
            return
        if self.path == "/recipe-key":
            self._recipe_key()
            return
        if self.path == "/preview/ready":
            self._preview_ready()
            return
        if self.path == "/preview/warm":
            self._preview_warm()
            return
        if self.path == "/decode":
            self._decode()
            return
        if self.path == "/render":
            self._render()
            return
        if self.path == "/cleanup/detect":
            self._cleanup_detect()
            return
        if self.path == "/compare":
            self._compare()
            return
        if self.path == "/fit-recipe":
            self._fit_recipe()
            return
        if self.path == "/learn-color":
            self._learn_color()
            return
        if self.path == "/apply-color":
            self._apply_color()
            return
        if self.path == "/export-color":
            self._export_color()
            return
        if self.path == "/pick-folder":
            self._pick_folder()
            return
        if self.path == "/storage-locations":
            self._storage_locations()
            return
        if self.path == "/list-images":
            self._list_images()
            return
        if self.path == "/workspace":
            self._workspace()
            return
        if self.path == "/cloud/status":
            self._cloud_status()
            return
        if self.path == "/cloud/connect":
            self._cloud_connect()
            return
        if self.path == "/cloud/disconnect":
            self._cloud_disconnect()
            return
        if self.path == "/cloud/list":
            self._cloud_list()
            return
        if self.path == "/project/import-cloud":
            self._project_import_cloud()
            return
        if self.path == "/project/init":
            self._project_init()
            return
        if self.path == "/project/import":
            self._project_import()
            return
        if self.path == "/project/frames":
            self._project_frames()
            return
        if self.path == "/project/state":
            self._project_state()
            return
        if self.path == "/project/apply":
            self._project_apply()
            return
        if self.path == "/export":
            self._export()
            return
        if self.path.startswith("/db/"):
            self._db(self.path[len("/db/"):])
            return
        if self.path == "/album/analyze":
            self._album_analyze()
            return
        if self.path == "/album/finalize-jpeg":
            self._album_finalize_jpeg()
            return
        if self.path == "/album/embed":
            self._album_embed()
            return
        if self.path == "/album/dedup":
            self._album_dedup()
            return
        if self.path == "/album/moments":
            self._album_moments()
            return
        if self.path == "/album/cull":
            self._album_cull()
            return
        if self.path == "/album/identities":
            self._album_identities()
            return
        if self.path == "/album/render":
            self._album_render()
            return
        if self.path == "/album/pdf":
            self._album_pdf()
            return

        parts = self.path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "tools" and parts[2] == "apply":
            tool_id = parts[1]
            fn = DISPATCH.get(tool_id)
            if fn is None:
                self._json(404, {"error": f"unknown tool {tool_id}"})
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length))
                out_b64, meta = on_worker(fn, body["image"], body.get("params", {}))
                self._json(
                    200,
                    {"image": "data:image/png;base64," + out_b64, "meta": meta},
                )
            except Exception as e:  # noqa: BLE001 - surface errors to the client
                self._json(500, {"error": str(e)})
        else:
            self._json(404, {"error": "not found"})

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length))

    def _gallery_api(self, method):
        """The client gallery, mounted here.

        gallery.py owns its own routing and knows nothing about this socket, so
        the same module serves the sidecar during development and a standalone
        process wherever this finally runs. Returns False when the path is not
        the gallery's, and the handler falls through to everything else.
        """
        parsed = urllib.parse.urlparse(self.path)
        body = {}
        if method == "POST":
            try:
                body = self._body()
            except Exception:  # noqa: BLE001
                body = {}
        if not isinstance(body, dict):
            body = {}
        for key, values in urllib.parse.parse_qs(parsed.query).items():
            body.setdefault(key, values[0])

        answered = gallery.handle(method, parsed.path, body, dict(self.headers))
        if answered is None:
            return False
        status, payload = answered
        self._json(status, payload)
        return True

    def _gallery_file(self):
        """Objects, when the gallery's store is this machine's own disk.

        With a bucket in front this route is never reached - the manifest hands
        out URLs that point at the bucket or its CDN instead.
        """
        path = urllib.parse.urlparse(self.path).path
        key = urllib.parse.unquote(path[len("/gallery-files/"):])
        try:
            data = gallery_store.store().get(key)
        except gallery_store.StoreUnavailable as e:
            # "cannot reach the store" is an answer, never an empty gallery
            self._json(503, {"error": str(e)})
            return
        if data is None:
            self._json(404, {"error": "not found"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        # An object under a given key never changes: a new version is a new key.
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(data)

    def _db(self, action):
        """The studio's records. See db.py for why they live here and not in
        the browser.

        A database that cannot be reached answers 503 and NOT an empty result.
        The difference matters more than anything else in this handler: an
        empty list tells the photographer their studio is empty, and that is a
        sentence the tool must never say unless it is true.
        """
        try:
            body = self._body() if action != "health" else {}
            if action == "health":
                self._json(200, db.health())
            elif action == "find":
                self._json(
                    200,
                    {"docs": db.find(body["collection"], body.get("where"))},
                )
            elif action == "save":
                self._json(200, db.save(body["collection"], body["doc"]))
            elif action == "save-many":
                self._json(200, db.save_many(body["collection"], body["docs"]))
            elif action == "delete":
                self._json(200, db.remove(body["collection"], body["id"]))
            elif action == "delete-where":
                self._json(
                    200, db.remove_where(body["collection"], body.get("where"))
                )
            elif action == "import":
                self._json(200, {"report": db.import_once(body.get("collections"))})
            else:
                self._json(404, {"error": f"unknown db action: {action}"})
        except db.DatabaseUnavailable as e:
            self._json(503, {"error": f"מסד הנתונים אינו זמין: {e}"})
        except (KeyError, ValueError) as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _render(self):
        """Run a whole recipe in one pass. { image|path, recipe:[...], w? }

        `w` caps the long edge BEFORE the pipeline runs. Tuning a tool means
        re-rendering on every slider move, and a 20MP frame re-rendered at full
        size to be shown in an 1100px panel is the difference between a control
        that responds and one that does not. Delivery ignores it and renders
        from the original.

        And the pipeline is TOLD about that cap. Every face tool has a floor
        below which it refuses to work, and a capped frame put those floors on
        the wrong side of the truth: the panel reported `faceTooSmall` for the
        very faces the export was retouching. `sourceScale` in the body covers
        the case where the CLIENT did the shrinking and only sent us the result.
        """
        try:
            body = self._body()
            if body.get("path"):
                img = common.load_image(body["path"])
            else:
                img = common.b64_to_image(body["image"])
            # What the caller already shrank before we ever saw the frame.
            scale = max(1.0, float(body.get("sourceScale") or 1.0))

            cap = int(body.get("w") or 0)
            # THE frame being edited, and the one place worth keeping the file
            # in hand for: a face the proxy is too small to serve is worked from
            # these pixels instead of refused. Thumbnails go through /preview and
            # deliberately do not get this.
            source = img
            if cap > 0:
                size = _fit_size(img.size, cap)
                if size != img.size:
                    scale *= max(img.size) / float(max(size))
                    img = img.resize(size, Image.LANCZOS)
            out, meta = on_worker(
                render.render, img, body.get("recipe", []), scale,
                source if img is not source else None,
            )
            # A preview and a file the photographer keeps are not the same
            # picture. Previews stay small; `deliver` asks for the same settings
            # render.export writes to disk — q97, no chroma subsampling.
            #
            # But NO CHROMA SUBSAMPLING EITHER WAY. This branch used the library
            # default, 4:2:0, which throws away half the colour resolution — on
            # the one screen where a photographer judges colour work. Blush and
            # the redness pass are a* pushes of a few Lab units across a cheek,
            # and 4:2:0 is exactly the thing that softens them. Reported from
            # use as "what I see is blurrier than the original". q92 keeps the
            # payload sane; the subsampling is what mattered.
            if body.get("deliver"):
                payload = "data:image/jpeg;base64," + common.image_to_jpeg_b64(
                    out, render.DEFAULT_QUALITY, subsampling=0
                )
            else:
                payload = "data:image/jpeg;base64," + common.image_to_jpeg_b64(
                    out, 92, subsampling=0
                )
            self._json(200, {"image": payload, "meta": meta})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _cleanup_detect(self):
        """Outline what the cleanup tool found. { image|path, params, recipe? }

        No image comes back. Detection returns GEOMETRY — one outline per
        candidate, normalised to the frame — so the UI draws the marks over the
        photo it already has, and the same outlines go back in a recipe as the
        selection. Rendering a marked-up JPEG here would have been easier and
        useless: nobody can click a pixel in a picture of a click.
        """
        try:
            body = self._body()
            if body.get("path"):
                img = common.load_image(body["path"])
            else:
                img = common.b64_to_image(body["image"])
            # `w` caps the frame exactly as /render does, and for the same
            # reason: the marking view runs on the picture the panel is showing,
            # and detecting on a 20MP frame to draw outlines over an 1400px one
            # costs a wait nobody asked for. The outlines come back normalised,
            # so they are valid on the file either way.
            scale = max(1.0, float(body.get("sourceScale") or 1.0))
            cap = int(body.get("w") or 0)
            if cap > 0:
                size = _fit_size(img.size, cap)
                if size != img.size:
                    scale *= max(img.size) / float(max(size))
                    img = img.resize(size, Image.LANCZOS)
            found = on_worker(
                render.detect_cleanup,
                img,
                body.get("params", {}),
                body.get("recipe", []),
                # Marking and applying have to agree about which faces are in
                # play; the size gates decide that, and they need the scale.
                scale,
            )
            self._json(200, found)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _compare(self):
        """Read an edit. { before, after } -> report + annotated overlay."""
        try:
            body = self._body()

            # The BEFORE frame is chosen from the project, so the renderer has
            # its path and not its bytes — and pushing a 25MB raw file through
            # base64 to reach a process that can just open it is waste. The
            # AFTER frame comes from wherever the photographer edited it, so it
            # still arrives as data.
            def _read(key):
                path_key = key + "Path"
                if body.get(path_key):
                    return common.to_np(common.load_image(body[path_key]))
                return common.to_np(common.b64_to_image(body[key]))

            before = _read("before")
            after = _read("after")
            report, marked = on_worker(compare.analyze, before, after)
            self._json(
                200,
                {
                    "report": report,
                    "overlay": "data:image/jpeg;base64,"
                    + common.image_to_jpeg_b64(common.to_pil(marked), 92),
                },
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _fit_recipe(self):
        """Learn a runnable recipe from a before/after pair, and report how
        much of the edit it actually reproduces."""
        try:
            body = self._body()

            # The BEFORE frame is chosen from the project, so the renderer has
            # its path and not its bytes — and pushing a 25MB raw file through
            # base64 to reach a process that can just open it is waste. The
            # AFTER frame comes from wherever the photographer edited it, so it
            # still arrives as data.
            def _read(key):
                path_key = key + "Path"
                if body.get(path_key):
                    return common.to_np(common.load_image(body[path_key]))
                return common.to_np(common.b64_to_image(body[key]))

            before = _read("before")
            after = _read("after")
            params, report, fitted = on_worker(recipe_fit.fit, before, after)
            self._json(
                200,
                {
                    "recipe": recipe_fit.to_recipe(params),
                    "params": params,
                    "fit": report,
                    "preview": "data:image/jpeg;base64,"
                    + common.image_to_jpeg_b64(common.to_pil(fitted), 92),
                },
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _learn_color(self):
        """Learn a transferable paired-pixel colour model.

        { before, after } -> compact model + validation report + preview.
        """
        try:
            body = self._body()

            # The BEFORE frame is chosen from the project, so the renderer has
            # its path and not its bytes — and pushing a 25MB raw file through
            # base64 to reach a process that can just open it is waste. The
            # AFTER frame comes from wherever the photographer edited it, so it
            # still arrives as data.
            def _read(key):
                path_key = key + "Path"
                if body.get(path_key):
                    return common.to_np(common.load_image(body[path_key]))
                return common.to_np(common.b64_to_image(body[key]))

            before = _read("before")
            after = _read("after")
            model, report, preview = on_worker(pixel_color.fit, before, after)
            self._json(
                200,
                {
                    "model": model,
                    "report": report,
                    "preview": "data:image/jpeg;base64,"
                    + common.image_to_jpeg_b64(common.to_pil(preview), 94),
                },
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _apply_color(self):
        """Apply a learned colour model. { image|path, model, deliver }"""
        try:
            body = self._body()
            if body.get("path"):
                image = common.load_image(body["path"])
            else:
                image = common.b64_to_image(body["image"])
            output, meta = on_worker(
                pixel_color.apply,
                common.to_np(image),
                body["model"],
            )
            output_image = common.to_pil(output)
            if body.get("deliver"):
                payload = "data:image/jpeg;base64," + common.image_to_jpeg_b64(
                    output_image,
                    render.DEFAULT_QUALITY,
                    subsampling=0,
                )
            else:
                payload = "data:image/jpeg;base64," + common.image_to_jpeg_b64(
                    output_image
                )
            self._json(200, {"image": payload, "meta": meta})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _pick_folder(self):
        """Open the real Windows folder dialog and return the path chosen.

        A browser cannot hand out an absolute path — by design, and no amount of
        UI work changes that. But the engine is a local process on the user's
        own machine, so IT can raise the native dialog and report the answer.
        That is the difference between "paste a path" and "choose a folder", and
        the second one is the only acceptable version.

        This is the Vista-style picker (IFileOpenDialog + FOS_PICKFOLDERS) — the
        same window Explorer itself uses — not System.Windows.Forms.FolderBrowserDialog,
        whose tree view predates XP and has no search, no Quick access, no preview.

        The dialog is owned by a TopMost form, or Windows would open it behind
        the browser and the click would look like it did nothing.
        """
        script = r"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace TezaDialog {
    [ComImport]
    [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    internal class FileOpenDialogRCW { }

    [ComImport]
    [Guid("d57c7288-d4ad-4768-be02-9d969532d960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise([MarshalAs(UnmanagedType.Interface)] object pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder([MarshalAs(UnmanagedType.Interface)] IShellItem psi);
        void SetFolder([MarshalAs(UnmanagedType.Interface)] IShellItem psi);
        void GetFolder([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
        void GetCurrentSelection([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
        void AddPlace([MarshalAs(UnmanagedType.Interface)] IShellItem psi, uint alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter([MarshalAs(UnmanagedType.Interface)] object pFilter);
        void GetResults([MarshalAs(UnmanagedType.Interface)] out object ppenum);
        void GetSelectedItems([MarshalAs(UnmanagedType.Interface)] out object ppsai);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IShellItem
    {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, out IntPtr ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare([MarshalAs(UnmanagedType.Interface)] IShellItem psi, uint hint, out int piOrder);
    }

    public static class ModernFolderBrowser
    {
        public static string Show(string title, IntPtr owner)
        {
            const uint FOS_PICKFOLDERS = 0x20;
            const uint FOS_FORCEFILESYSTEM = 0x40;
            const uint FOS_NOVALIDATE = 0x100;
            const uint FOS_NOTESTFILECREATE = 0x10000;
            const uint FOS_DONTADDTORECENT = 0x2000000;
            const uint SIGDN_FILESYSPATH = 0x80058000;

            var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
            dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOVALIDATE | FOS_NOTESTFILECREATE | FOS_DONTADDTORECENT);
            if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
            int hr = dialog.Show(owner);
            if (hr != 0) return null;
            IShellItem item;
            dialog.GetResult(out item);
            IntPtr pszPath;
            item.GetDisplayName(SIGDN_FILESYSPATH, out pszPath);
            string path = Marshal.PtrToStringUni(pszPath);
            Marshal.FreeCoTaskMem(pszPath);
            return path;
        }
    }
}
"@

$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$ownerHandle = $owner.Handle
$path = [TezaDialog.ModernFolderBrowser]::Show('בחר תיקייה עם תמונות הפרויקט', $ownerHandle)
$owner.Dispose()
# BASE64, not the path itself. PowerShell writes stdout through the console
# code page and Python reads it back through the system one; neither is UTF-8
# on a Hebrew Windows, so "D:\צילומים\חתונה" came back as "D:\??????\?????" —
# a path that does not exist. The import then failed on a folder the
# photographer had just pointed at. Base64 is ASCII, so it survives both.
if ($path) {
  [Console]::Out.Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($path)))
}
"""
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-STA", "-Command", script],
                capture_output=True,
                text=True,
                timeout=300,
            )
            encoded = (out.stdout or "").strip()
            if not encoded:
                # A CRASH IS NOT A CANCELLATION. Both produce empty stdout, and
                # reporting the crash as "the photographer changed their mind"
                # is what made a broken import look like a dead button: the
                # caller returns quietly on a cancel, by design.
                if out.returncode != 0 or (out.stderr or "").strip():
                    self._json(500, {
                        "error": "חלון בחירת התיקייה נכשל: "
                                 + ((out.stderr or "").strip().splitlines() or ["?"])[0]
                    })
                    return
                self._json(200, {"cancelled": True})
                return
            folder = base64.b64decode(encoded).decode("utf-8")
            self._json(200, {"folder": folder, "cancelled": False})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _recipe_key(self):
        """POST { recipe:[...] } -> { key }. Register a recipe for /preview."""
        try:
            body = self._body()
            self._json(200, {"key": _remember_recipe(body.get("recipe", []))})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _list_images(self):
        """List the image files in a folder.

        Plumbing, not a tool: a browser cannot enumerate a directory, and the
        engine already has disk access. The batch screens need the real paths
        so the work can be handed to /export-color file by file — which is what
        makes progress reportable in ITEMS instead of a spinner.
        """
        try:
            body = self._body()
            folder = (body.get("folder") or "").strip().strip('"')
            if not folder or not os.path.isdir(folder):
                self._json(400, {"error": f"לא נמצאה תיקייה: {folder}"})
                return
            exts = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp",
                    ".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf"}
            names = sorted(
                n for n in os.listdir(folder)
                if os.path.splitext(n)[1].lower() in exts
            )
            files = [os.path.join(folder, n) for n in names]
            self._json(200, {"folder": folder, "files": files, "count": len(files)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    # ------------------------------------------------------------ the project
    #
    # A project is a folder (workspace.py). These endpoints are the only way the
    # front end touches it: the browser cannot create a directory, copy a file,
    # or read a JSON off D:\ — and the whole model rests on it being able to.

    def _oauth_callback(self):
        """Finish a system-browser OAuth flow and send the photographer back."""
        parsed = urllib.parse.urlparse(self.path)
        provider = parsed.path.rsplit("/", 1)[-1]
        args = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        try:
            cloud_sources.finish(provider, args)
            title = "החיבור הושלם"
            message = "אפשר לסגור את החלון ולחזור ל־TEZA."
        except Exception as exc:  # noqa: BLE001
            title = "החיבור לא הושלם"
            message = str(exc)
        escaped = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        payload = (
            "<!doctype html><meta charset=utf-8><title>TEZA</title>"
            "<style>body{font:18px system-ui;display:grid;place-items:center;"
            "min-height:90vh;background:#f5f3ef;color:#171717}main{text-align:center;"
            "max-width:34rem}p{color:#666}</style><main dir=rtl><h1>"
            + title + "</h1><p>" + escaped + "</p></main>"
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _cloud_status(self):
        try:
            self._json(200, {"providers": cloud_sources.status()})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})

    def _cloud_connect(self):
        try:
            self._json(200, cloud_sources.begin(self._body().get("provider")))
        except cloud_sources.CloudError as exc:
            self._json(exc.status, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})

    def _cloud_disconnect(self):
        try:
            self._json(200, cloud_sources.disconnect(self._body().get("provider")))
        except cloud_sources.CloudError as exc:
            self._json(exc.status, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})

    def _cloud_list(self):
        try:
            body = self._body()
            self._json(200, cloud_sources.list_folder(body.get("provider"), body.get("folder")))
        except cloud_sources.CloudError as exc:
            self._json(exc.status, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})

    def _project_import_cloud(self):
        try:
            body = self._body()
            result = cloud_sources.import_image(
                body.get("provider"), body.get("id"), body.get("name"),
                body.get("size"), body.get("rawDir"),
            )
            self._json(200, result)
        except cloud_sources.CloudError as exc:
            self._json(exc.status, {"error": str(exc)})
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})

    def _workspace(self):
        """Read or set the projects root. { folder? } -> { root }

        No folder in the body is a READ. Sending one is the one-time answer to
        "where do projects live", and it is remembered for the installation —
        asking per project would be asking the same question 200 times.
        """
        try:
            body = self._body()
            folder = body.get("folder")
            root = workspace.set_root(folder) if folder else workspace.get_root()
            self._json(200, {"root": root})
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _project_init(self):
        """Create or adopt <root>/<name>/. { name, root? } -> paths

        Idempotent: opening a project that already exists must not be a
        different path through the code from creating one, or the second
        session behaves differently from the first.
        """
        try:
            body = self._body()
            self._json(200, workspace.init_project(body.get("name", ""), body.get("root")))
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _project_import(self):
        """Copy ONE frame into the project. { src, rawDir } -> { file, skipped }

        One per call so the screen counts in items. 300 RAW frames off a card
        is minutes of copying, and a bar that moves is the difference between
        waiting and force-quitting.
        """
        try:
            body = self._body()
            self._json(200, workspace.import_file(body["src"], body["rawDir"]))
        except ValueError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _project_frames(self):
        """The set, in capture order. { home } -> { frames, raw, edited }

        Read fresh every time and never cached: the disk is the authority on
        what exists, and a cached listing is wrong the first time a file is
        moved in Explorer. Each frame reports the file to SHOW — the edited
        copy when there is one, the raw when there is not.
        """
        try:
            body = self._body()
            p = workspace.paths(body["home"])
            frames = workspace.list_frames(p["raw"], p["edited"])
            self._json(200, {"frames": frames, "raw": p["raw"], "edited": p["edited"]})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _project_state(self):
        """Read or write project.json. { home, state? } -> state

        No `state` in the body is a read. This is the project's memory and it
        lives INSIDE the project folder on purpose: copy the folder and the
        batches, assignments and recipe come with it.
        """
        try:
            body = self._body()
            home = body["home"]
            if body.get("state") is not None:
                workspace.write_state(home, body["state"])
            self._json(200, workspace.read_state(home))
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _project_apply(self):
        """Render one frame from the RAW and replace its file in `תמונות`.

        { src, editedDir, recipe, quality? } -> { file }

        The replacement is computed from the raw through the WHOLE current
        recipe — never from the file already sitting there. That is the one
        decision that keeps a fifth tool from being the fifth JPEG generation,
        and keeps any step removable after the fact. The output overwrites in
        place: one current version per frame, no version folders.
        """
        try:
            body = self._body()
            out_path, _ = on_worker(
                render.export,
                body["src"],
                body.get("recipe", []),
                body["editedDir"],
                "jpeg",
                int(body.get("quality", render.DEFAULT_QUALITY)),
            )
            self._json(200, {"file": out_path})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _export_color(self):
        """Apply one learned colour model to files on disk."""
        try:
            body = self._body()
            files = body.get("files", [])
            model = body["model"]
            destination = body["dest"]
            fmt = body.get("format", "jpeg")
            quality = int(body.get("quality", render.DEFAULT_QUALITY))
            written, errors = [], []
            for path in files:
                try:
                    output_path, _ = on_worker(
                        pixel_color.export,
                        path,
                        model,
                        destination,
                        fmt,
                        quality,
                    )
                    written.append(output_path)
                except Exception as e:  # noqa: BLE001
                    errors.append({"file": path, "error": str(e)})
            self._json(
                200,
                {"written": written, "errors": errors, "count": len(written)},
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _export(self):
        """Render files from disk and save them. { files:[paths], recipe|perFile,
        dest, format, quality }"""
        try:
            body = self._body()
            files = body.get("files", [])
            dest = body["dest"]
            fmt = body.get("format", "jpeg")
            quality = int(body.get("quality", render.DEFAULT_QUALITY))
            per_file = body.get("perFile") or {}
            default_recipe = body.get("recipe", [])

            written, errors = [], []
            for path in files:
                try:
                    recipe = per_file.get(path, default_recipe)
                    out_path, _ = on_worker(
                        render.export, path, recipe, dest, fmt, quality
                    )
                    written.append(out_path)
                except Exception as e:  # noqa: BLE001 - one bad file must not
                    errors.append({"file": path, "error": str(e)})  # kill the batch
            self._json(
                200, {"written": written, "errors": errors, "count": len(written)}
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _album_analyze(self):
        """Analyse one photo for safe album placement. { image|path }"""
        try:
            body = self._body()
            image = (
                common.load_image(body["path"])
                if body.get("path")
                else common.b64_to_image(body["image"])
            )
            self._json(200, on_worker(album_analysis.analyze, image))
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _album_embed(self):
        """Visual fingerprints for a set. { paths:[...] } -> per-path results.

        The first stage of the auto-album: a 384-d DINOv2 vector per frame, the
        ground everything downstream (dedup, moments, hero) stands on. Called
        with a CHUNK of paths at a time so the UI shows a real counter in items,
        not a spinner, and a cancel between chunks means something. Cached
        vectors come back instantly; the first pass pays DINOv2 once per frame,
        and never again unless the file changes.

        A missing model is a fact about the whole run, not a per-file failure:
        it answers 503 once (run setup_models.py) instead of N identical errors.
        The pixels never cross the wire — the engine opens each file itself and
        stores only the 384 floats.
        """
        try:
            body = self._body()
            paths = body.get("paths", [])
            results = []
            embedded = cached = 0
            for p in paths:
                try:
                    _, was_cached = on_worker(embed.embed_path, p)
                    results.append({"path": p, "ok": True, "cached": was_cached})
                    if was_cached:
                        cached += 1
                    else:
                        embedded += 1
                except embed.ModelMissing as e:
                    self._json(503, {"error": str(e)})
                    return
                except Exception as e:  # noqa: BLE001 — one bad frame, not the set
                    results.append({"path": p, "ok": False, "error": str(e)})
            self._json(
                200,
                {"results": results, "embedded": embedded, "cached": cached, "dim": embed.DIM},
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _album_dedup(self):
        """Near-duplicate groups over the set's cached vectors.

        { paths:[...], threshold? } -> { groups, missing, embedded, ... }

        Reads only the cache — קליטה supplies the vectors — so it is instant and
        cheap to re-run at a new threshold. `missing` names frames not embedded
        yet, kept apart from "has no duplicate" on purpose (CLAUDE.md §3). No
        pixels move; the answer is paths.
        """
        try:
            body = self._body()
            paths = body.get("paths", [])
            threshold = float(body.get("threshold", embed.DEDUP_THRESHOLD))
            self._json(200, embed.group_near_duplicates(paths, threshold))
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _album_moments(self):
        """Split the set into the scenes it was shot in.

        { paths:[...], times?:[...], threshold?, timeGap? } -> { moments, ... }

        Reads the cached vectors only, like /album/dedup — קליטה supplies them —
        so it is instant and cheap to re-run at a different threshold.
        """
        try:
            body = self._body()
            self._json(200, embed.group_moments(
                body.get("paths", []),
                body.get("times"),
                float(body.get("threshold", embed.MOMENT_THRESHOLD)),
                float(body.get("timeGap", embed.MOMENT_TIME_GAP)),
            ))
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _album_identities(self):
        """Cluster every readable face in the set into people.

        { frames:[{path, faces:[box,...]}], threshold?, totalFrames? }
          -> { identities, principals, ... }

        Reads the vectors the culling pass already stored, so it is instant and
        cheap to re-run at a different threshold. Nobody is named: the answer is
        "person 1 appears in 143 frames".
        """
        try:
            body = self._body()
            frames = body.get("frames", [])
            result = identity.cluster(
                frames,
                float(body.get("threshold", identity.SAME_PERSON)),
            )
            result["principals"] = identity.principals(
                result["identities"],
                int(body.get("totalFrames") or len(frames)),
            )
            self._json(200, result)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _album_cull(self):
        """Judge a chunk of frames for the album. { paths:[...] } -> results.

        One pass per frame answers both questions the album asks: is this frame
        good enough to print, and what is its geometry. Finding the face
        landmarks is the expensive part and both answers come out of it, so
        splitting this into two endpoints would double the slowest stage.

        A frame that fails is reported as a failure against its own path — the
        set keeps going. `verdict` is never a deletion; the caller shows it and
        the photographer overrides it.
        """
        try:
            body = self._body()
            paths = body.get("paths", [])
            results = []
            for p in paths:
                try:
                    results.append({"path": p, "ok": True, "data": on_worker(cull.judge, p)})
                except Exception as e:  # noqa: BLE001 — one bad frame, not the set
                    results.append({"path": p, "ok": False, "error": str(e)})
            self._json(200, {"results": results})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _album_render(self):
        """Render the album to print-ready JPEGs on disk.

        { spec, spreads, outDir, ppi?, background?, naming? } -> manifest

        The browser cannot write to D:\\Albums and cannot read the originals, so
        the whole job belongs here: source pixels in, finished sRGB JPEG out, one
        resample and one encode. Files land in a folder the photographer picked;
        the engine never invents a destination.
        """
        try:
            body = self._body()
            out_dir = body.get("outDir") or ""
            if not out_dir or not os.path.isdir(out_dir):
                self._json(400, {"error": "תיקיית היעד לא קיימת"})
                return
            manifest = on_worker(
                album_render.render_album,
                body["spec"],
                body.get("spreads", []),
                out_dir,
                body.get("ppi"),
                body.get("background", "#ffffff"),
                body.get("naming", "spread-{index}.jpg"),
                body.get("startIndex", 1),
                body.get("manifestFiles"),
                bool(body.get("writeManifest", True)),
            )
            self._json(200, manifest)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _album_pdf(self):
        """One PDF of the whole album, at the album's real page size.

        { spec, spreads, outDir, name?, ppi? } -> report

        A viewing document, not the print package — see album_render.render_pdf.
        """
        try:
            body = self._body()
            out_dir = body.get("outDir") or ""
            if not out_dir or not os.path.isdir(out_dir):
                self._json(400, {"error": "תיקיית היעד לא קיימת"})
                return
            name = os.path.basename(body.get("name") or "album.pdf")
            if not name.lower().endswith(".pdf"):
                name += ".pdf"
            report = on_worker(
                album_render.render_pdf,
                body["spec"],
                body.get("spreads", []),
                os.path.join(out_dir, name),
                body.get("ppi"),
                body.get("background", "#ffffff"),
            )
            self._json(200, report)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _album_finalize_jpeg(self):
        """Encode a rendered spread as full-quality JPEG with embedded sRGB."""
        try:
            body = self._body()
            payload, meta = on_worker(
                album_export.finalize_srgb_jpeg,
                body["image"],
                body.get("ppi", 300),
            )
            self._json(
                200,
                {"image": "data:image/jpeg;base64," + payload, "meta": meta},
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _decode(self):
        """RAW -> preview JPEG. Accepts { path } or { image: base64 }, maxDim."""
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            max_dim = int(body.get("maxDim", 0))
            if body.get("path"):
                img = on_worker(raw.decode_path, body["path"], max_dim)
            else:
                data = base64.b64decode(body["image"].split(",", 1)[-1])
                img = on_worker(raw.decode_bytes, data, max_dim)
            self._json(
                200,
                {
                    "image": "data:image/jpeg;base64," + common.image_to_jpeg_b64(img),
                    "width": img.width,
                    "height": img.height,
                },
            )
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _json(self, code, obj):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass  # keep the console quiet


class Server(ThreadingHTTPServer):
    # Windows lets a second process bind a port that is already listening, and
    # then routes requests to whichever socket it feels like. That is not a
    # theoretical problem: it cost this project two debugging sessions, once
    # answering with two-day-old code and once running a fit against a stale
    # build. Refuse to start instead of starting wrong.
    allow_reuse_address = False

    if hasattr(__import__("socket"), "SO_EXCLUSIVEADDRUSE"):
        import socket as _s

        def server_bind(self):
            self.socket.setsockopt(self._s.SOL_SOCKET, self._s.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()


if __name__ == "__main__":
    import sys

    try:
        srv = Server(("127.0.0.1", PORT), Handler)
    except OSError as e:
        sys.exit(
            f"port {PORT} is already in use — another engine is running.\n"
            f"Stop it first; two engines on one port serve requests at random.\n"
            f"({e})"
        )
    print(f"engine listening on http://127.0.0.1:{PORT}")

    # Warm the depth model in the background. onnxruntime's native DLL costs ~20s
    # to load on this machine, so it is kept out of import (see depth.py) — the
    # server is up and answering the moment the line above prints. This thread
    # then pays that cost off the hot path, so the first depth-of-field or dehaze
    # request finds the session already built instead of stalling on it.
    def _warm_depth():
        try:
            import depth
            t = time.perf_counter()
            depth._session_instance()
            print(f"depth model warm ({time.perf_counter() - t:.1f}s)")
        except Exception as e:  # a warm-up must never take the server down
            print(f"depth warm-up skipped: {e}")

    threading.Thread(target=_warm_depth, name="warm-depth", daemon=True).start()

    srv.serve_forever()
