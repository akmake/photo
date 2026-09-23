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
BORROW = 8.0       # everything finer than this (x the reduction) is borrowed, not invented
MATERIAL_TOL = 26.0  # levels apart at which a source stops counting as the same material
PATCH = 33         # px — the patch the match is judged over, and voted across
OFFSET_STEPS = 13  # candidate shifts per axis
BETA = 0.45        # how sharply a pixel prefers the shift that fits it best
MAX_LIFT = 2.0     # ceiling on restoring the contrast that averaging costs

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


def _box(a: np.ndarray, k: int = PATCH) -> np.ndarray:
    return cv2.boxFilter(a, -1, (k, k), normalize=True, borderType=cv2.BORDER_REPLICATE)


def _translations(bw: int, bh: int):
    """Shifts worth trying: far enough to clear the hole, near enough to be
    the same corner of the scene."""
    out = []
    for dy in np.unique(np.round(np.linspace(-1.1 * bh, 1.1 * bh, OFFSET_STEPS)).astype(int)):
        for dx in np.unique(np.round(np.linspace(-1.6 * bw, 1.6 * bw, OFFSET_STEPS)).astype(int)):
            if abs(int(dx)) < 12 and abs(int(dy)) < 12:
                continue
            out.append((int(dy), int(dx)))
    return out


def _regrain(win: np.ndarray, coarse: np.ndarray, m: np.ndarray,
             factor: float) -> np.ndarray:
    """Put the photograph's own detail into an area rebuilt at reduced size.

    WHAT IS MISSING AND WHY. A hole filled at a fraction of the frame comes
    back right in structure and short of everything finer than that fraction.
    Beside sharp soil the patch reads as a smudge, and that softness is what a
    photographer sees first. Measured on 321A5078 against the real background
    standing at the same rows: the network's answer carries 60-72% of its
    detail, and it was judged from use as blurred, correctly.

    WHERE THE DETAIL COMES FROM. Not from invention — from this photograph.
    The same soil, the same foliage, the same light stand a few hundred pixels
    away, already sharp. Copying them is what Content-Aware Fill has always
    done, and copying alone reaches 93% here while pasting a second horse into
    the frame: it knows how to be sharp and not what belongs. The network knows
    what belongs. So the network keeps the structure and the photograph lends
    the detail.

    WHY NOT BLOCK BY BLOCK. Three attempts failed the same way, each the
    textbook artefact of deciding per block: one source per block printed a
    grid (99% detail, unusable), forcing a block to continue its neighbour
    printed a repeating streak (85%), averaging several sources blurred it
    worse than the network (51%).

    SO IT IS DECIDED PER PIXEL. A set of candidate shifts is scored everywhere
    at once — a box filter gives every patch's distance in one pass — each
    pixel leans on the shifts that describe what the network drew there, and
    the weights are blurred across the patch, which is the voting step of
    patch-based synthesis. Nothing is tiled because nothing is placed. The
    averaging costs contrast, so the borrowed layer is rescaled to the energy
    its sources actually carry, and where no shift resembles the network's
    answer at all — white horse against a dark rail — the borrowing fades out
    and the network's answer stands, soft but never foreign. 95% of real
    detail on 321A5078, no grid, no streak, no glitter on the animal.
    """
    h, w = m.shape
    ys, xs = np.nonzero(m)
    by0, by1 = int(ys.min()), int(ys.max()) + 1
    bx0, bx1 = int(xs.min()), int(xs.max()) + 1
    pad = PATCH * 2
    ry0, ry1 = max(0, by0 - pad), min(h, by1 + pad)
    rx0, rx1 = max(0, bx0 - pad), min(w, bx1 + pad)

    sigma = max(1.0, BORROW * factor)
    low_src = cv2.GaussianBlur(win, (0, 0), sigma).astype(np.float32)
    detail_src = win.astype(np.float32) - low_src
    intact = (m == 0).astype(np.float32)
    target = cv2.GaussianBlur(coarse, (0, 0), sigma).astype(np.float32)[ry0:ry1, rx0:rx1]
    rh, rw = target.shape[:2]

    def at(dy, dx):
        sy, sx = ry0 + dy, rx0 + dx
        if sy < 0 or sx < 0 or sy + rh > h or sx + rw > w:
            return None
        cut = (slice(sy, sy + rh), slice(sx, sx + rw))
        return low_src[cut], detail_src[cut], intact[cut]

    shifts = [o for o in _translations(bx1 - bx0, by1 - by0) if at(*o) is not None]
    if not shifts:
        return coarse  # no clean material beside the hole to borrow from

    best = np.full((rh, rw), np.inf, np.float32)
    apart = []
    for dy, dx in shifts:
        s_low, _, s_intact = at(dy, dx)
        d = _box(((target - s_low) ** 2).sum(axis=2))
        d = np.where(_box(s_intact) > 0.999, d, np.inf).astype(np.float32)
        apart.append(d)
        np.minimum(best, d, out=best)
    reachable = np.isfinite(best)
    best = np.where(reachable, best, 0.0)

    num = np.zeros((rh, rw, 3), np.float32)
    want = np.zeros((rh, rw), np.float32)
    den = np.zeros((rh, rw, 1), np.float32)
    floor = float(np.median(best[reachable])) * 0.25 + 1e-3 if reachable.any() else 1e-3
    for (dy, dx), d in zip(shifts, apart):
        _, s_detail, _ = at(dy, dx)
        weight = np.exp(-(d - best) / (BETA * (best + floor)))
        weight[~np.isfinite(weight)] = 0.0
        weight = _box(weight)
        num += weight[:, :, None] * s_detail
        want += weight * (s_detail ** 2).sum(axis=2)
        den += weight[:, :, None]
    den = np.maximum(den, 1e-6)
    lent = num / den
    have = _box((lent ** 2).sum(axis=2))
    lent *= np.sqrt(np.clip(_box(want / den[:, :, 0]) / np.maximum(have, 1e-6),
                            1.0, MAX_LIFT ** 2))[:, :, None]
    trust = np.clip(1.0 - np.sqrt(np.maximum(best, 0.0) / 3.0) / MATERIAL_TOL, 0.0, 1.0)
    lent *= (_box(trust) * reachable)[:, :, None]

    out = coarse.astype(np.float32).copy()
    out[ry0:ry1, rx0:rx1] += lent
    return np.clip(out, 0, 255).astype(np.uint8)


def _fill_window(net, win: np.ndarray, m: np.ndarray, work_hole: int = WORK_HOLE) -> np.ndarray:
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

    `work_hole` lets a caller that has already taken the object out of the
    context (object_remove's layered fill) ask for a smaller working size.
    """
    ys, xs = np.nonzero(m)
    span = max(int(xs.max() - xs.min()), int(ys.max() - ys.min())) + 1
    if span <= work_hole:
        return _infer(net, win, m)
    scale = work_hole / span
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
