"""Rebuild a marked region with LaMa — the filler behind spot cleanup.

WHY IT REPLACED THE OLD FILL. Cleanup rebuilt a mark by classical diffusion
(tone) plus a grafted donor texture, then a colour harmoniser pulled the patch
toward the skin around it. Judged from use as "looks like pasting, uneven",
and the full-resolution comparison agreed: flat, faintly off-tone patches,
often square-edged — a smile crease, a forehead, the inside of a spectacle lens,
a small child's cheek, a dark smudge at a mouth corner. Diffusion knows the ring
of pixels around a hole and nothing else, so anything with structure or a
lighting gradient comes back as a smooth plate.

LaMa (Suvorov et al., big-lama, Apache-2.0) is a network trained to inpaint
from the whole surrounding context — texture, gradients, lines that should
continue. Same detection, same repair masks, only the filler swapped, on five
frames at full resolution: the patches are gone. Running the old colour
harmoniser on top of it did not help and sometimes brought a pale patch back,
so LaMa's output is used as it comes. Whole-frame cleanup time did not grow
(chayamushka-103 at full size: 53s -> 23s).

HOW. Each repair component gets a square window of context around it (three
times its size on every side, at least MIN_WINDOW), overlapping windows are
merged so neighbouring marks see each other, and only the MASK pixels are
written back — everything else stays bit-identical to the input. A hole wider
than WORK_HOLE is run at reduced size and regrained afterwards; see
_fill_window for why, and for the measurements.

Model file: models/big-lama.pt (TorchScript release of big-lama, from
simple-lama-inpainting; licence in models/lama-LICENSE.txt). Absent -> the
caller falls back to the old fill.
"""

import os
import threading

import cv2
import numpy as np

import paths

MODEL = paths.model_path("big-lama.pt")
CONTEXT = 3.0      # window = mark size x (1 + 2 * CONTEXT)
MIN_WINDOW = 96    # px — enough skin around a tiny speck to read its texture
WORK_HOLE = 900    # px — the widest hole the network still rebuilds as scene

_lock = threading.Lock()
_net = None


def available() -> bool:
    return os.path.exists(MODEL)


def _model():
    global _net
    with _lock:
        if _net is None:
            import torch

            _net = torch.jit.load(MODEL, map_location="cpu").eval()
    return _net


def _windows(repair: np.ndarray, context: float = None):
    h, w = repair.shape
    ctx = CONTEXT if context is None else context
    n, _, stats, _ = cv2.connectedComponentsWithStats(repair, connectivity=8)
    boxes = []
    for i in range(1, n):
        x, y, bw, bh = stats[i, :4]
        side = int(max(MIN_WINDOW, max(bw, bh) * (1 + 2 * ctx)))
        cx, cy = x + bw / 2.0, y + bh / 2.0
        boxes.append([int(max(0, cx - side / 2)), int(max(0, cy - side / 2)),
                      int(min(w, cx + side / 2)), int(min(h, cy + side / 2))])
    merged = True
    while merged:
        merged = False
        for a in range(len(boxes)):
            for b in range(a + 1, len(boxes)):
                A, B = boxes[a], boxes[b]
                if A[0] < B[2] and B[0] < A[2] and A[1] < B[3] and B[1] < A[3]:
                    boxes[a] = [min(A[0], B[0]), min(A[1], B[1]),
                                max(A[2], B[2]), max(A[3], B[3])]
                    boxes.pop(b)
                    merged = True
                    break
            if merged:
                break
    return boxes


def _infer(net, win: np.ndarray, m: np.ndarray) -> np.ndarray:
    """One forward pass over a window. -> uint8, same size as the window."""
    import torch

    hh, ww = m.shape
    # the network downsamples by 8; pad by mirroring so the edge of the
    # window reads as more of the same skin, not as a border
    ph, pw = (-hh) % 8, (-ww) % 8
    img = np.pad(win, ((0, ph), (0, pw), (0, 0)), mode="symmetric")
    msk = np.pad(m.astype(np.float32), ((0, ph), (0, pw)), mode="symmetric")
    t_img = torch.from_numpy(img.transpose(2, 0, 1).copy()).float().unsqueeze(0) / 255.0
    t_msk = torch.from_numpy(msk.copy()).float()[None, None]
    with torch.inference_mode():
        pred = net(t_img, t_msk)[0].permute(1, 2, 0).numpy()
    if pred.max() <= 1.5:  # releases differ on 0..1 vs 0..255 output
        pred = pred * 255.0
    return np.clip(np.rint(pred[:hh, :ww]), 0, 255).astype(np.uint8)


def _regrain(win: np.ndarray, coarse: np.ndarray, m: np.ndarray,
             factor: float) -> np.ndarray:
    """Lift the frame's own fine grain into an area rebuilt at reduced size.

    A hole filled at a fraction of the frame comes back correct in structure
    and short of everything finer than that fraction: beside sharp ground the
    patch reads as a smudge. The missing detail is high-frequency only, and the
    photograph already holds the right kind of it immediately beside the hole —
    the same soil, the same foliage, the same light. Take the band above the
    fill's own resolution and slide it in sideways by the hole's own width, so
    every row is served by the material at that row. Only frequencies are
    borrowed, never shapes, and the layer averages to zero, so tone and colour
    stay exactly as the network placed them.
    """
    h, w = m.shape
    xs = np.nonzero(m.any(axis=0))[0]
    shift = int(xs.max() - xs.min()) + 25
    if shift * 2 >= w:
        return coarse  # no clean material beside the hole to borrow from
    sigma = max(1.0, 0.75 * factor)
    fine = win.astype(np.float32) - cv2.GaussianBlur(win, (0, 0), sigma).astype(np.float32)
    columns = np.arange(w)[None, :, None]
    borrowed = np.where(columns - shift >= 0,
                        np.roll(fine, shift, axis=1), np.roll(fine, -shift, axis=1))
    return np.clip(coarse.astype(np.float32) + borrowed, 0, 255).astype(np.uint8)


def _fill_window(net, win: np.ndarray, m: np.ndarray) -> np.ndarray:
    """Rebuild one window, at the size the network reads a hole that big.

    WHY NOT ALWAYS NATIVE. The network was trained to see a hole against its
    surroundings; the surroundings have to fit in what it can look at. A speck
    at 24MP does. A person does not: removing one from a 5472px frame returned
    a grey vertical column where he had stood — measured on 321A5078, 62s to
    produce, unusable. Run the same window with the hole brought down to
    WORK_HOLE and the network returns foliage, fence and soil, in 4.6s; push
    the hole past about 1200px and the column starts to come back.

    So the hole, not the frame, sets the working size, and _regrain puts the
    fine detail back afterwards. A mark small enough to begin with is untouched
    by all of this and goes through exactly as before.
    """
    ys, xs = np.nonzero(m)
    span = max(int(xs.max() - xs.min()), int(ys.max() - ys.min())) + 1
    if span <= WORK_HOLE:
        return _infer(net, win, m)
    scale = WORK_HOLE / span
    hh, ww = m.shape
    sw, sh = max(8, round(ww * scale)), max(8, round(hh * scale))
    small = cv2.resize(win, (sw, sh), interpolation=cv2.INTER_AREA)
    msmall = (cv2.resize(m * 255, (sw, sh), interpolation=cv2.INTER_LINEAR) > 40).astype(np.uint8)
    if not msmall.any():
        return _infer(net, win, m)
    coarse = cv2.resize(_infer(net, small, msmall), (ww, hh), interpolation=cv2.INTER_CUBIC)
    return _regrain(win, coarse, m, 1.0 / scale)


def fill(rgb: np.ndarray, repair: np.ndarray, context: float = None) -> np.ndarray:
    """rgb uint8 HxWx3, repair HxW (>0 = rebuild). -> uint8 HxWx3.

    `context` overrides how much of the surroundings each window carries. It is
    a speed/knowledge trade and it is the caller's to make: cost grows with the
    window, and a hand-painted stroke is far larger than a detected speck (see
    manual_clean.py for the measurements). None keeps CONTEXT.
    """
    mask = (repair > 0).astype(np.uint8)
    out = rgb.copy()
    if not mask.any():
        return out
    net = _model()
    for x0, y0, x1, y1 in _windows(mask, context):
        win = rgb[y0:y1, x0:x1]
        m = mask[y0:y1, x0:x1]
        if not m.any():
            continue
        pred = _fill_window(net, win, m)
        sel = m > 0
        out[y0:y1, x0:x1][sel] = pred[sel]
    return out
