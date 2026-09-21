"""The background preparer — work done BEFORE the photographer asks for it.

Opening a frame for the first time in the edit screen cost ~18s, and 15 of them
were one question: where is the subject (BiRefNet matting). The answer depends
only on the photograph, it is cached on disk forever after, and it was being
computed at the one moment someone was waiting for it.

Professional editors solve this the same way: Lightroom builds its previews and
Capture One its proxies in the background after import, at low priority, so
that by the time a frame is opened the expensive analysis already exists. This
is that, for our caches:

  * thumbnails at the widths the screens ask for (previews.cached_thumb), and
  * the masks every retouch tool reads (subject, face features, skin/hair
    classes), at the exact working frame the edit screen renders, so the
    engine's cache lookups hit bit-for-bit.

WHY A SEPARATE PROCESS, AT BELOW-NORMAL PRIORITY. The engine has one worker
thread by design (MediaPipe is not thread-safe, and two renders at once were
measured slower than one after another). A second thread in the engine would
fight that worker for the same interpreter. A separate process has its own
models and its own interpreter, and Windows' scheduler gives the engine the
CPU first whenever both want it — so preparation can never be the thing the
photographer's slider waits for, on a 4-core laptop or a 24-core desktop.

Protocol: the engine writes one JSON object per line to stdin —
    {"paths": [...], "w": 1400, "thumbs": [320, 1200], "recipe": [...],
     "triage": [...]}

`triage` names frames for the work stage's analysis (triage.analyze), which
runs before the masks: it is cheap and it is the next thing a screen shows.

With a `recipe`, preparing a frame means RENDERING it with that recipe, exactly
as the engine will — which fills every cache the tools read, including the
per-face ones cleanup and retouch build on their own crops, with no list of
mask kinds to keep in sync. Without one, only the whole-frame masks are made.
The most recent request is served first (a stack of requests), and within a
request, in the order given. EOF on stdin means the engine is gone: exit.
Nothing is written back; the product is the cache files.
"""

import json
import os
import sys
import threading
import time
import traceback

os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.getcwd())

import common  # noqa: E402
import masks  # noqa: E402
import previews  # noqa: E402
import render  # noqa: E402
import triage  # noqa: E402

# The kinds the edit screen's tools read from the whole frame. `face-skin`
# brings `body-skin` and `hair` with it — they share one segmentation.
MASK_KINDS = ("subject", "face-features", "face-skin")

_stack = []            # [(kind, path, arg)], served from the end
_recipes = {}          # (path, width) -> the latest recipe sent for it, as text
_lock = threading.Lock()
_eof = threading.Event()


def _push(request):
    paths = [p for p in (request.get("paths") or []) if isinstance(p, str)]
    width = int(request.get("w") or 0)
    thumbs = [int(t) for t in (request.get("thumbs") or []) if int(t) > 0]
    recipe = request.get("recipe") or []
    # A job is named by the TOOLS, not the slider positions (see _do), so the
    # same frame sent again after a nudge is the same job — moved up, not added.
    tools = ",".join(sorted({str(t.get("toolId")) for t in recipe if t.get("enabled", True)}))
    recipe_text = json.dumps(recipe, sort_keys=True)
    jobs = []
    # Thumbnails first — milliseconds each, and they are what a grid shows —
    # then the masks, in the order the paths were given.
    for p in paths:
        for t in thumbs:
            jobs.append(("thumb", p, t))
    # The work stage's analysis: ~1s a frame against ~15s for masks, and it is
    # what the very next screen after import shows — so it goes before them.
    for p in request.get("triage") or []:
        if isinstance(p, str):
            jobs.append(("triage", p, 0))
    if width > 0:
        for p in paths:
            jobs.append(("masks", p, (width, tools)))
    with _lock:
        for p in paths:
            _recipes[(p, width)] = recipe_text
        # A repeated job moves to the front rather than running twice.
        again = set(jobs)
        _stack[:] = [j for j in _stack if j not in again]
        _stack.extend(reversed(jobs))


def _reader():
    stream = sys.stdin.buffer
    for raw in stream:
        try:
            _push(json.loads(raw.decode("utf-8")))
        except Exception:  # noqa: BLE001 — one bad line must not stop the reader
            traceback.print_exc()
    _eof.set()


def _do(job):
    kind, path, arg = job
    if not os.path.isfile(path):
        return
    if kind == "thumb":
        previews.cached_thumb(path, arg)
        return
    if kind == "triage":
        if triage.cached(path) is None:
            try:
                triage.analyze(path)
            except Exception as e:  # noqa: BLE001 — answered as unread, not pending forever
                triage.store_failure(path, e)
        return
    width, tools = arg
    with _lock:
        recipe = json.loads(_recipes.get((path, width), "[]"))
    # Ready means "these TOOLS have their caches for this frame", not "this
    # exact slider position": a screen re-sends its batch on every move, and a
    # nudged exposure must not re-prepare four hundred frames. The masks a
    # tool reads do not depend on where its sliders sit.
    marker = previews.prep_marker(path, width, tools)
    if marker and os.path.exists(marker):
        return
    source, img, scale = previews.working_frame(path, width)
    key = previews.photo_key(path)
    if recipe:
        # The same call server._render makes, so every cache key matches.
        render.render(img, recipe, scale, source if img is not source else None, key=key)
        render.clear_stage_cache()  # pixels are not the product here
    else:
        rgb = common.to_np(img)
        masks.set_source(rgb, key)
        try:
            for k in MASK_KINDS:
                masks.get_mask(rgb, k)
        finally:
            masks.clear_source()
    # Ready means ON DISK: the engine reads these files, not this process.
    masks.flush_writes()
    if marker:
        os.makedirs(os.path.dirname(marker), exist_ok=True)
        open(marker, "wb").close()


def main():
    threading.Thread(target=_reader, name="prep-stdin", daemon=True).start()
    done = set()
    while True:
        with _lock:
            job = _stack.pop() if _stack else None
        if job is None:
            if _eof.is_set():
                return
            time.sleep(0.25)
            continue
        if job in done:
            continue
        try:
            _do(job)
        except Exception:  # noqa: BLE001 — a bad file must not stop the queue
            traceback.print_exc()
        done.add(job)
        # Memory: nothing in the in-process caches is read again here — the
        # product is on disk — and a set of 400 frames would otherwise hold
        # every mask of every one of them.
        masks._CACHE.clear()
        masks._CAT_CACHE.clear()


if __name__ == "__main__":
    main()
