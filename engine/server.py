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
_PROXY_VERSION = 2


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
    times more, and libjpeg can downscale while it decodes."""
    im = Image.open(path)
    im.draft("RGB", (width * 2, width * 2))
    return ImageOps.exif_transpose(im).convert("RGB")


def _render_proxy(path, width, recipe):
    im = _decode_small(path, width)
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
        im, _ = render.render(im, recipe)

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
        "params": [{"id": "strength", "min": 0, "max": 100, "default": 60}],
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
            {"id": "strength", "min": 0, "max": 100, "default": 50},
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/thumb?"):
            self._thumb()
            return
        if self.path.startswith("/preview?"):
            self._preview()
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

            im = _decode_small(path, width)
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

            proxy = _proxy_path(key or "raw", path, width)
            data = None
            try:
                with open(proxy, "rb") as fh:
                    data = fh.read()
            except OSError:
                pass

            if data is None:
                data = on_worker(_render_proxy, path, width, recipe)
                try:
                    os.makedirs(os.path.dirname(proxy), exist_ok=True)
                    with open(proxy, "wb") as fh:
                        fh.write(data)
                except OSError:
                    pass  # a cache that cannot be written still serves pixels

            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            # Safe to cache hard: the key changes whenever the recipe changes,
            # and the proxy name changes whenever the file does.
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def do_POST(self):
        if self.path == "/recipe-key":
            self._recipe_key()
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
        if self.path == "/list-images":
            self._list_images()
            return
        if self.path == "/export":
            self._export()
            return
        if self.path == "/album/analyze":
            self._album_analyze()
            return
        if self.path == "/album/finalize-jpeg":
            self._album_finalize_jpeg()
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

    def _render(self):
        """Run a whole recipe in one pass. { image|path, recipe:[...], w? }

        `w` caps the long edge BEFORE the pipeline runs. Tuning a tool means
        re-rendering on every slider move, and a 20MP frame re-rendered at full
        size to be shown in an 1100px panel is the difference between a control
        that responds and one that does not. Delivery ignores it and renders
        from the original.
        """
        try:
            body = self._body()
            if body.get("path"):
                img = common.load_image(body["path"])
            else:
                img = common.b64_to_image(body["image"])
            cap = int(body.get("w") or 0)
            if cap > 0:
                size = _fit_size(img.size, cap)
                if size != img.size:
                    img = img.resize(size, Image.LANCZOS)
            out, meta = on_worker(render.render, img, body.get("recipe", []))
            # A preview and a file the photographer keeps are not the same
            # picture. Previews stay small; `deliver` asks for the same settings
            # render.export writes to disk — q97, no chroma subsampling.
            if body.get("deliver"):
                payload = "data:image/jpeg;base64," + common.image_to_jpeg_b64(
                    out, render.DEFAULT_QUALITY, subsampling=0
                )
            else:
                payload = "data:image/jpeg;base64," + common.image_to_jpeg_b64(out)
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
            found = on_worker(
                render.detect_cleanup,
                img,
                body.get("params", {}),
                body.get("recipe", []),
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

        The dialog is owned by a TopMost form, or Windows would open it behind
        the browser and the click would look like it did nothing.
        """
        script = (
            "Add-Type -AssemblyName System.Windows.Forms;"
            "$owner = New-Object System.Windows.Forms.Form;"
            "$owner.TopMost = $true;"
            "$d = New-Object System.Windows.Forms.FolderBrowserDialog;"
            "$d.Description = 'בחר תיקייה עם תמונות הפרויקט';"
            "$d.ShowNewFolderButton = $false;"
            "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK)"
            " { [Console]::Out.Write($d.SelectedPath) };"
            "$owner.Dispose()"
        )
        try:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-STA", "-Command", script],
                capture_output=True,
                text=True,
                timeout=300,
            )
            folder = (out.stdout or "").strip()
            if not folder:
                self._json(200, {"cancelled": True})
                return
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
