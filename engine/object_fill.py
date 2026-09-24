"""The fill behind object removal: thin holes and thick holes are different jobs.

MEASURED ON A FIXED SET (docs/OBJECT-REMOVE-TIMELINE.md, 2026-09-24): 40 shapes
laid over the photographer's own frames and removed, the result compared with
what the photo really had there; plus real removals judged at 100%.

THIN (a pipe, a rope, a lead, a wire). The network sees across a hole a few
dozen pixels wide at the photo's own size and returns the photo's own grain.
The old path reduced by the hole's LENGTH (a 1400px rope was run at 900) and
then borrowed detail back; on the black pipe of 321A5078 that left a purple
smear, in 27s. At full size, tile by tile: wood grain straight through, 6.5s.
Guided patch synthesis is worse here — it searches at a quarter size, and the
full-size copy of a narrow strip mixes sources: a flat pale strip, detail 4.5
against 9.4 around it.

THICK (a person, a post, a stone). Reduction is unavoidable, and the network's
answer comes back soft or, in dense texture, as a dark average. Rebuilt out of
the photograph's own patches, steered by the network's structure
(patch_synth.py): flowers where there were flowers, a soft background kept soft.
"""

import cv2
import numpy as np

import lama_fill
import patch_synth

#: Half-thickness, as a fraction of the frame's long side, up to which a hole
#: is thin. 48px at 5472: a pipe or a lead painted with a generous brush.
THIN = 0.009
#: Native-size network tiles: core size, context around it, overlap.
TILE, TILE_CONTEXT, TILE_OVERLAP = 512, 192, 96
#: The guide for a thick hole: the network with the hole brought to this size.
GUIDE_HOLE = 512
#: Detail bands (Gaussian differences, px at this frame's size) in which the
#: network's fill and the patch synthesis are weighed against each other.
BANDS = (1, 2, 4, 8, 16, 32)
#: Band energy (levels) below which a band counts as empty — smooth background,
#: where the network's own smooth answer is kept.
BAND_FLOOR = 0.6


def _native(rgb: np.ndarray, hole: np.ndarray, unknown: np.ndarray) -> np.ndarray:
    """The network at the photo's own size, tile by tile along the hole.

    Tiles overlap and are blended, so neighbouring answers meet without a step.
    `unknown` (everything still to be removed) is what the network is told is
    missing, so a tile never reads another unfilled object as context.
    """
    net = lama_fill._model()
    h, w = hole.shape
    ys, xs = np.nonzero(hole)
    Y0, Y1, X0, X1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    acc = np.zeros((Y1 - Y0, X1 - X0, 3), np.float32)
    wt = np.zeros((Y1 - Y0, X1 - X0), np.float32)
    step = TILE - TILE_OVERLAP
    for ty in range(Y0, Y1, step):
        for tx in range(X0, X1, step):
            cy0, cy1, cx0, cx1 = ty, min(Y1, ty + TILE), tx, min(X1, tx + TILE)
            if not hole[cy0:cy1, cx0:cx1].any():
                continue
            wy0, wy1 = max(0, cy0 - TILE_CONTEXT), min(h, cy1 + TILE_CONTEXT)
            wx0, wx1 = max(0, cx0 - TILE_CONTEXT), min(w, cx1 + TILE_CONTEXT)
            pred = lama_fill._infer(net, rgb[wy0:wy1, wx0:wx1], unknown[wy0:wy1, wx0:wx1])
            p = pred[cy0 - wy0:cy1 - wy0, cx0 - wx0:cx1 - wx0].astype(np.float32)
            ry = np.arange(cy1 - cy0)
            rx = np.arange(cx1 - cx0)
            ry = np.minimum(ry + 1, ry[::-1] + 1)
            rx = np.minimum(rx + 1, rx[::-1] + 1)
            f = (np.minimum(np.minimum(ry[:, None], rx[None, :]), TILE_OVERLAP) / TILE_OVERLAP).astype(np.float32)
            acc[cy0 - Y0:cy1 - Y0, cx0 - X0:cx1 - X0] += p * f[..., None]
            wt[cy0 - Y0:cy1 - Y0, cx0 - X0:cx1 - X0] += f
    out = rgb.copy()
    box = out[Y0:Y1, X0:X1]
    sel = (hole[Y0:Y1, X0:X1] > 0) & (wt > 0)
    box[sel] = np.clip(np.rint(acc[sel] / wt[sel][:, None]), 0, 255).astype(np.uint8)
    return out


def guide(win: np.ndarray, m: np.ndarray, work_hole: int = GUIDE_HOLE) -> np.ndarray:
    """The network's answer with the hole brought to `work_hole` px, brought
    back up — and nothing else. lama_fill._fill_window adds _regrain on top,
    the very borrowing that pasted a dress's print into a gravel path; as a
    guide it would carry that print into everything built on it.
    """
    net = lama_fill._model()
    ys, xs = np.nonzero(m)
    span = max(int(np.ptp(ys)), int(np.ptp(xs))) + 1
    if span <= work_hole:
        return lama_fill._infer(net, win, m)
    scale = work_hole / span
    hh, ww = m.shape
    sw, sh = max(8, round(ww * scale)), max(8, round(hh * scale))
    small = cv2.resize(win, (sw, sh), interpolation=cv2.INTER_AREA)
    msmall = (cv2.resize(m.astype(np.uint8) * 255, (sw, sh), interpolation=cv2.INTER_LINEAR) > 40).astype(np.uint8)
    if not msmall.any():
        return lama_fill._infer(net, win, m)
    return cv2.resize(lama_fill._infer(net, small, msmall), (ww, hh), interpolation=cv2.INTER_CUBIC)


def _seamless(win: np.ndarray, hole: np.ndarray, g: np.ndarray, s: float) -> np.ndarray:
    """Carry the photo's own light across the boundary into the network's fill.

    The network ran reduced; brought back up, its rim steps against the photo:
    measured on 28 thick holes, the gradient on the hole's edge was 1.5-2.0x
    the photo's own. The step is read just outside the hole at the network's
    scale and interpolated inward (the membrane form of seamless cloning):
    ~1.2x after.
    """
    H = hole > 0
    disc = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    h8 = hole.astype(np.uint8)
    ring = (cv2.dilate(h8, disc(int(3 * s) + 2)) > 0) & ~(cv2.dilate(h8, disc(1)) > 0)
    d = cv2.GaussianBlur(win.astype(np.float32), (0, 0), s) - cv2.GaussianBlur(g.astype(np.float32), (0, 0), s)
    out = win.astype(np.float32).copy()
    for c in range(3):
        fix = patch_synth._membrane(np.where(ring, d[..., c], 0).astype(np.float32), ring)
        out[..., c][H] = g[..., c][H].astype(np.float32) + fix[H]
    return np.clip(out, 0, 255)


def _fuse(win: np.ndarray, hole: np.ndarray, g: np.ndarray, synth: np.ndarray) -> np.ndarray:
    """The network's fill for light and form, the photo's patches for texture.

    Seen at 100% on the fixed set, neither is right alone. In a smooth blurred
    background the patch synthesis is a patchwork — borrowed pieces with edges
    of their own — and the network's smooth answer is what the photo looks
    like. In bark, grass, gravel and flowers the network returns a smear and
    the photo's own patches are right. So each detail band is taken from the
    synthesis in proportion to how much of the band's EXPECTED energy (read
    around the hole, band by band) the network failed to deliver; the coarsest
    level is always the network's, so no borrowed light ever makes a blob.
    The same split as Contextual Residual Aggregation (Yi et al., CVPR 2020):
    a low-resolution fill, high-frequency residuals from the context.
    """
    H = hole > 0
    known = ~(cv2.dilate(hole.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
    ys, xs = np.nonzero(hole)
    span = max(int(np.ptp(ys)), int(np.ptp(xs))) + 1
    gg = _seamless(win, hole, g, max(2.0, span / GUIDE_HOLE))
    ss = win.astype(np.float32).copy()
    ss[H] = synth[H]

    def bands(img):
        lv = [img.astype(np.float32)] + [cv2.GaussianBlur(img.astype(np.float32), (0, 0), b) for b in BANDS]
        return [lv[i] - lv[i + 1] for i in range(len(BANDS))], lv[-1]

    def energy(b, sig):
        return np.sqrt(cv2.GaussianBlur((b * b).mean(2), (0, 0), 2 * sig + 2))

    BW, _ = bands(win)
    BG, out = bands(gg)
    BS, _ = bands(ss)
    for k, sig in enumerate(BANDS):
        expected = patch_synth._membrane(energy(BW[k], sig), known)
        w = np.clip((expected - energy(BG[k], sig)) / np.maximum(expected, BAND_FLOOR), 0, 1)
        if sig >= 4:
            # coarse bands: one source or the other, never half of each —
            # two unrelated textures averaged cancel each other out (a linear
            # blend took detail from 1.07 to 0.82), and borrowed coarse light
            # half-mixed is where a patchwork starts
            w = (w > 0.5).astype(np.float32)
        w = cv2.GaussianBlur(w, (0, 0), 2 * sig + 2)[..., None]
        if sig >= 4:
            out += (1 - w) * BG[k] + w * BS[k]
        else:
            # fine bands: the network carries little here, so the two barely
            # correlate; weights that keep the ENERGY keep the grain
            out += np.sqrt(1 - w) * BG[k] + np.sqrt(w) * BS[k]
    res = win.copy()
    res[H] = np.clip(np.rint(out[H]), 0, 255).astype(np.uint8)
    return res


def _thick(rgb: np.ndarray, hole: np.ndarray, unknown: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(hole)
    bh, bw = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
    pad = int(max(96, 0.5 * max(bh, bw)))
    h, w = hole.shape
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
    win = rgb[y0:y1, x0:x1]
    m = hole[y0:y1, x0:x1].astype(np.uint8)
    u = unknown[y0:y1, x0:x1].astype(np.uint8)
    g = guide(win, u)
    res = _fuse(win, m, g, patch_synth.synthesize(win, m, g, avoid=u & (1 - m)))
    out = rgb.copy()
    out[y0:y1, x0:x1][m > 0] = res[m > 0]
    return out


def is_thin(hole: np.ndarray) -> bool:
    r_in = float(cv2.distanceTransform(hole.astype(np.uint8), cv2.DIST_L2, 5).max())
    return r_in <= THIN * max(hole.shape)


def fill(rgb: np.ndarray, hole: np.ndarray) -> np.ndarray:
    """rgb uint8 HxWx3, hole HxW (>0 = remove). -> uint8; only hole pixels change.

    Each separate piece of the hole is judged on its own: a pipe and a stone
    removed together are one thin fill and one thick fill. Thick pieces go
    first; what is still to be removed is never offered as context or source.
    """
    mask = (hole > 0).astype(np.uint8)
    out = rgb.copy()
    if not mask.any():
        return out
    n, labels = cv2.connectedComponents(mask, connectivity=8)
    parts = [(labels == i).astype(np.uint8) for i in range(1, n)]
    thin = np.zeros_like(mask)
    unknown = mask.copy()
    for part in parts:
        if is_thin(part):
            thin |= part
            continue
        filled = _thick(out, part, unknown)
        out[part > 0] = filled[part > 0]
        unknown[part > 0] = 0
    if thin.any():
        filled = _native(out, thin, unknown)
        out[thin > 0] = filled[thin > 0]
    return out
