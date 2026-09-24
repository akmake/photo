"""Generative fill for the removals the classical fill cannot do.

WHY. A person standing in front of an object — the guide in front of the horse
in 321A5078 — leaves a hole in which part of that object has to be DRAWN: the
rump, the hind leg down to the hoof. Our own fill (network at 512 + the photo's
patches, object_fill.py; outline completion, object_remove._layered) drew a
rump that looked pasted on, a leg cut straight at the brush's edge, a tail
hanging in the air. Measured and shown 2026-09-25 (docs/OBJECT-REMOVE-TIMELINE.md).

WHAT. RORem (Li et al., CVPR 2025; Apache-2.0): SDXL inpainting fine-tuned on
human-checked removals. On the same click it returned a whole rump with real
coat, every leg attached, the fence and barrel continued. SDXL-inpainting
itself was tried as well and invented a tree stump where the guide stood —
rejected. Neither draws a missing tail; the photographer's rule is "a tail
whole or not at all", so a leftover tail is removed with one more click.

HOW.
- The model runs in its own Python (gen_worker.py) — it needs CUDA torch and
  diffusers, the engine's packaged environment has neither. The worker is
  started once and kept: loading costs 12-20s, a fill ~30s on the RTX laptop.
- A square crop around the hole, 1.5x its size, is brought to WORK_RES on the
  long side. At 1024 the redrawn leg came back soft (a 2300px crop shrunk to
  1024 and grown back 2.4x); at 1536 it has its hock and speckles.
- BAND: the object behind is repainted too, BAND px around the hole. The
  hole's edge ran down the middle of the horse's leg; half was drawn, half
  photographed, and the two halves did not meet ("a break point in the leg").
  Repainting the band lets the model draw the leg's whole width at once.
- Only the hole (and the band) change; the rest of the frame is untouched.

Configuration: `gen_fill.json` in the models folder,
    {"python": "<python.exe with torch+diffusers>", "model": "<RORem folder>"}
Absent or broken -> available() is False and removal falls back to the
classical fill, saying so in its report. How the model reaches a
photographer's machine (a download on first use) is not decided yet.
"""

import hashlib
import json
import os
import subprocess
import tempfile
import threading
from collections import OrderedDict

import cv2
import numpy as np

import paths

CONFIG = paths.model_path("gen_fill.json")
#: Long side of the crop the model works on, by device.
WORK_RES = {"cuda": 1536, "cpu": 1024}
#: How much of the scene around the hole goes into the crop (x the hole's size).
CONTEXT = 1.5
#: Repainted band of the object behind, in px at 5472 width.
BAND = 45
#: A request that takes longer than this is a hung worker.
TIMEOUT_S = 900


class GenFillError(RuntimeError):
    """The generative fill could not run; the caller falls back and reports it."""


_lock = threading.Lock()
_proc = None
_device = None
_cache: "OrderedDict[str, np.ndarray]" = OrderedDict()
_CACHE_MAX = 8


def _config():
    try:
        with open(CONFIG, encoding="utf-8") as fh:
            cfg = json.load(fh)
    except (OSError, ValueError):
        return None
    if not (os.path.isfile(cfg.get("python", "")) and os.path.isdir(cfg.get("model", ""))):
        return None
    return cfg


def available() -> bool:
    return _config() is not None


def _worker():
    """The running worker, started on first use. Under _lock."""
    global _proc, _device
    if _proc is not None and _proc.poll() is None:
        return _proc
    cfg = _config()
    if cfg is None:
        raise GenFillError("generative fill is not installed")
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen_worker.py")
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    _proc = subprocess.Popen([cfg["python"], script, cfg["model"]], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    reply = _read(_proc)
    if not reply.get("ready"):
        raise GenFillError(f"generative fill did not start: {reply}")
    _device = reply.get("device", "cpu")
    return _proc


def _read(proc) -> dict:
    line = proc.stdout.readline()
    if not line:
        raise GenFillError("generative fill worker stopped")
    try:
        return json.loads(line.decode("utf-8"))
    except ValueError as exc:
        raise GenFillError(f"generative fill worker said: {line[:200]!r}") from exc


def _ask(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Run the model on one crop (uint8 RGB, uint8 0/255). Under _lock."""
    proc = _worker()
    with tempfile.TemporaryDirectory(prefix="teza_gen_") as tmp:
        ip, mp, op = (os.path.join(tmp, n) for n in ("in.png", "mask.png", "out.png"))
        cv2.imwrite(ip, cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
        cv2.imwrite(mp, mask)
        req = json.dumps({"image": ip, "mask": mp, "out": op, "seed": 0}) + "\n"
        proc.stdin.write(req.encode("utf-8"))
        proc.stdin.flush()
        reply = _read(proc)
        if not reply.get("ok"):
            raise GenFillError(reply.get("error", "generative fill failed"))
        out = cv2.imread(op, cv2.IMREAD_COLOR)
        if out is None:
            raise GenFillError("generative fill wrote no image")
        return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)


def fill(rgb: np.ndarray, hole: np.ndarray, behind: np.ndarray = None,
         band_from: np.ndarray = None) -> np.ndarray:
    """rgb uint8 HxWx3, hole HxW bool/0-1, behind HxW (the object the hole cuts).

    `band_from`: the part of the hole the band is grown from — the removal that
    stood IN FRONT of `behind` (the guide), not every leftover drawn with it.
    Grown from the tail's hole too, the band took the visible half of the far
    hind leg in 321A5078 into the fill and the model drew it back as a ghost;
    grown from the guide's hole alone the leg stays photographed and whole.
    Default: the whole hole.

    -> uint8 HxWx3; only the hole and the band of `behind` around it change.
    Raises GenFillError when the model cannot run.
    """
    h, w = hole.shape
    hole = hole > 0
    work = hole.copy()
    if behind is not None and (behind > 0).any():
        r = max(2, round(BAND * w / 5472))
        src = hole if band_from is None else (band_from > 0)
        near = cv2.dilate(src.astype(np.uint8), cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0
        work |= near & (behind > 0)
    ys, xs = np.nonzero(work)
    if not len(ys):
        return rgb.copy()
    # The prompt image must not show what is being removed: the model is
    # shown the hole filled flat, not the photograph. With the tail's pixels
    # visible under a mask that only nearly covered them, the model kept a
    # "tail-ness" at the hoof and drew a ghost of it (321A5078).
    # Only the hole itself: the band over the object behind must stay visible,
    # it is what the model continues (hiding it too made the leg a ghost).
    shown = rgb.copy()
    wide = cv2.dilate(hole.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    shown[wide] = cv2.blur(rgb, (31, 31))[wide]
    cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
    side = int(max(np.ptp(ys), np.ptp(xs), 64) * CONTEXT)
    y0, x0 = max(0, cy - side // 2), max(0, cx - side // 2)
    y1, x1 = min(h, y0 + side), min(w, x0 + side)
    crop, mc = rgb[y0:y1, x0:x1], work[y0:y1, x0:x1]
    prompt = shown[y0:y1, x0:x1]

    with _lock:
        _worker()
        res = WORK_RES.get(_device, 1024)
        s = res / max(crop.shape[:2])
        cw = max(64, (round(crop.shape[1] * s) // 8) * 8)
        ch = max(64, (round(crop.shape[0] * s) // 8) * 8)
        small = cv2.resize(prompt, (cw, ch), interpolation=cv2.INTER_AREA)
        ms = (cv2.resize(mc.astype(np.uint8) * 255, (cw, ch), interpolation=cv2.INTER_LINEAR) > 60)
        ms = cv2.dilate(ms.astype(np.uint8), np.ones((9, 9), np.uint8)) * 255
        key = hashlib.sha1(small.tobytes() + ms.tobytes()).hexdigest()
        got = _cache.get(key)
        if got is None:
            got = _ask(small, ms)
            _cache[key] = got
            if len(_cache) > _CACHE_MAX:
                _cache.popitem(last=False)
        else:
            _cache.move_to_end(key)

    back = cv2.resize(got, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_LANCZOS4)
    k = max(3, round(9 * w / 5472)) | 1
    alpha = cv2.GaussianBlur(cv2.dilate(mc.astype(np.uint8), np.ones((k, k), np.uint8)).astype(np.float32),
                             (0, 0), max(1.0, 3 * w / 5472))[..., None]
    alpha = np.maximum(alpha, mc[..., None].astype(np.float32))   # the hole itself is fully replaced
    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(crop * (1 - alpha) + back * alpha + 0.5, 0, 255).astype(np.uint8)
    return out
