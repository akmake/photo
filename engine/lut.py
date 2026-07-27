"""Learn a colour grade as a 3D LUT, by lattice regression.

This replaces the parametric approach entirely, and it is worth stating why.
Fitting a dozen sliders to reproduce an arbitrary colour transformation stalled
at ~59% however many tools were added, for a reason that was structural rather
than a matter of tuning: one `saturation` slider cannot say "greens to grey,
skin warmer". A 3D LUT can say anything a colour transformation can say,
because it IS a colour transformation — a value for every input colour.

METHOD — lattice regression (Garcia & Gupta, NIPS 2009; refined for building
ICC profiles). Its central idea is not obvious and matters here: do NOT fit a
function and then sample it at the lattice nodes. Solve directly for the node
values that minimise error UNDER THE INTERPOLATION that will be used when the
LUT is applied. The interpolation is part of the problem, not something that
happens afterwards. Reported to cut error by ~25% against Gaussian-process
regression on the same task.

So for each observed pixel pair we write one equation

    sum_over_8_corners( trilinear_weight_i * node_i ) = observed_output

and solve the whole stack in the least-squares sense, with two priors:

  SMOOTHNESS  a 3D Laplacian, because one photograph covers a small fraction of
              the colour cube and the rest has to be inferred rather than left
              undefined.

  IDENTITY    unobserved colours default to NOT CHANGING. This is the
              difference between a LUT that leaves an unseen orange shirt alone
              and one that sends it somewhere arbitrary — and it is the
              requirement stated directly: what was not touched stays untouched.

DIAGNOSTIC — a LUT maps colour to colour and knows nothing about where a pixel
sits. If the retoucher brightened only the child, one skin tone maps to two
different outputs and the fit is forced to average them. That is measurable:
`cellSpread` reports, per lattice node, how much the observations there
disagree. Low spread means the edit really was colour-only. High spread is the
evidence that a region-limited second LUT is needed — measured, not guessed.
"""

import os

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import lsmr

# 33 is the post-production standard: 17 is for hardware with memory limits,
# 65 is for HDR work. 33^3 = 35937 nodes against a few hundred thousand
# samples, which is a comfortable ratio.
SIZE = 33

# Weights of the two priors, relative to the data term. Smoothness has to be
# strong enough to fill the large unobserved regions of the cube without being
# so strong it flattens a real, deliberate colour move.
LAMBDA_SMOOTH = 0.35
LAMBDA_IDENTITY = 0.02

MAX_SAMPLES = 400_000


def _identity_lattice(size=SIZE):
    g = np.linspace(0.0, 1.0, size, dtype=np.float64)
    r, gg, b = np.meshgrid(g, g, g, indexing="ij")
    return np.stack([r.ravel(), gg.ravel(), b.ravel()], axis=1)


def _trilinear_rows(rgb01, size=SIZE):
    """Sparse interpolation matrix: one row per sample, 8 non-zeros."""
    n = rgb01.shape[0]
    pos = np.clip(rgb01, 0.0, 1.0) * (size - 1)
    base = np.floor(pos).astype(np.int64)
    base = np.minimum(base, size - 2)
    frac = pos - base

    rows = np.repeat(np.arange(n, dtype=np.int64), 8)
    cols = np.empty(n * 8, dtype=np.int64)
    vals = np.empty(n * 8, dtype=np.float64)

    k = 0
    for dr in (0, 1):
        wr = frac[:, 0] if dr else 1.0 - frac[:, 0]
        for dg in (0, 1):
            wg = frac[:, 1] if dg else 1.0 - frac[:, 1]
            for db in (0, 1):
                wb = frac[:, 2] if db else 1.0 - frac[:, 2]
                idx = ((base[:, 0] + dr) * size + (base[:, 1] + dg)) * size + (base[:, 2] + db)
                cols[k::8] = idx
                vals[k::8] = wr * wg * wb
                k += 1

    return sp.csr_matrix((vals, (rows, cols)), shape=(n, size ** 3))


def _laplacian(size=SIZE):
    """6-neighbour 3D Laplacian over the lattice, boundary-aware."""
    n = size ** 3
    idx = np.arange(n).reshape(size, size, size)
    rows, cols, vals = [], [], []
    for axis in range(3):
        for shift in (-1, 1):
            src = idx
            dst = np.roll(idx, shift, axis=axis)
            valid = np.ones((size, size, size), bool)
            sl = [slice(None)] * 3
            sl[axis] = 0 if shift == 1 else size - 1
            valid[tuple(sl)] = False  # rolling wrapped around here
            s, d = src[valid], dst[valid]
            rows.append(s); cols.append(d); vals.append(-np.ones(s.size))
            rows.append(s); cols.append(s); vals.append(np.ones(s.size))
    return sp.csr_matrix(
        (np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))),
        shape=(n, n),
    )


def _pava(y, w=None):
    """Weighted L2 isotonic regression, non-decreasing — pool adjacent violators.

    The weights are load-bearing. Unweighted, this made the result far WORSE
    (-54.7% against +62.7% without it), and the reason is specific: with one
    photograph covering 12% of the colour cube, most nodes are inferred rather
    than observed. Pooling runs them together indiscriminately, so a long chain
    of guessed nodes drags the handful of well-measured ones to their average.

    Weighting by how much data each node actually carries lets the measured
    nodes hold their ground and the inferred ones move to satisfy the
    constraint — which is the right way round.
    """
    n = len(y)
    if w is None:
        w = np.ones(n)
    vals, wts, cnts = [], [], []
    for i in range(n):
        v, ww, c = float(y[i]), float(w[i]) + 1e-6, 1
        while vals and vals[-1] > v:
            pv, pw, pc = vals.pop(), wts.pop(), cnts.pop()
            v = (pv * pw + v * ww) / (pw + ww)
            ww += pw
            c += pc
        vals.append(v); wts.append(ww); cnts.append(c)
    out = np.empty(n)
    k = 0
    for v, c in zip(vals, cnts):
        out[k:k + c] = v
        k += c
    return out


def enforce_monotone(lut, size=SIZE, density=None):
    """Red out must not fall as red in rises, and the same per channel.

    This is the fix for the marbling. With one photograph covering 12% of the
    colour cube, the other 88% is inferred, and where sparse data meets
    extrapolation the lattice develops small non-monotonic ripples. They are
    invisible in textured areas and read as oil-on-water swirls across a smooth
    out-of-focus background — which is exactly where they appeared.

    A monotone lattice cannot ripple. This is the projection that the
    Monotonic Calibrated Interpolated Look-Up Tables line of work is built
    around, applied here as an L2 projection after the solve.
    """
    cube = lut.reshape(size, size, size, 3).copy()
    dens = (np.ones((size, size, size)) if density is None
            else density.reshape(size, size, size))
    for c in range(3):
        plane = np.moveaxis(cube[..., c], c, -1)
        wplane = np.moveaxis(dens, c, -1)
        flat = np.ascontiguousarray(plane).reshape(-1, size)
        wflat = np.ascontiguousarray(wplane).reshape(-1, size)
        for i in range(flat.shape[0]):
            flat[i] = _pava(flat[i], wflat[i])
        cube[..., c] = np.moveaxis(flat.reshape(plane.shape), -1, c)
    return cube.reshape(-1, 3)


def fit(before_rgb, after_rgb, size=SIZE, smooth=LAMBDA_SMOOTH,
        identity=LAMBDA_IDENTITY, seed=0, mask=None, monotone=True):
    """Both frames uint8 RGB, already aligned and the same shape.
    -> (lut, report). lut is (size^3, 3) float in 0..1, R-major."""
    if before_rgb.shape != after_rgb.shape:
        raise ValueError("frames must be aligned to the same shape first")

    src = before_rgb.reshape(-1, 3).astype(np.float64) / 255.0
    dst = after_rgb.reshape(-1, 3).astype(np.float64) / 255.0

    if mask is not None:
        sel = mask.reshape(-1) > 0.5
        if sel.sum() < 5000:
            raise ValueError("not enough pixels in this region to fit a LUT")
        src, dst = src[sel], dst[sel]

    if src.shape[0] > MAX_SAMPLES:
        rng = np.random.default_rng(seed)
        keep = rng.choice(src.shape[0], MAX_SAMPLES, replace=False)
        src, dst = src[keep], dst[keep]

    A = _trilinear_rows(src, size)
    n_nodes = size ** 3

    # how much of the cube this pair actually saw
    seen = np.asarray((A > 1e-4).sum(axis=0)).ravel()
    coverage = float((seen > 0).mean())

    # Solve for the CHANGE at each node, not for the colour.
    #
    # Solving for absolute colour forces an unobserved node to invent a full
    # colour, and the smoothness prior supplies one by extrapolating from its
    # neighbours — which overshoots. A sound pixel interpolated from eight
    # corners, one of them an overshooting guess, comes out wrong; that is the
    # blotching, and it destroyed a whole gallery at 9.5% cube coverage.
    #
    # Solved as a displacement field, an unobserved node's natural answer is
    # ZERO — leave this colour alone — which is both the correct default and
    # what was asked for. The field is also far smoother than the colours
    # themselves, so the Laplacian now regularises the edit rather than
    # fighting the sRGB curve.
    density = np.asarray(A.sum(axis=0)).ravel()
    quiet = 1.0 / (1.0 + density / 40.0)  # ~1 where unseen, ~0 where dense

    L = sp.diags(quiet * smooth) @ _laplacian(size)
    I = sp.diags(quiet * identity)
    ident = _identity_lattice(size)

    stack = sp.vstack([A, L, I], format="csr")
    delta = np.empty((n_nodes, 3))
    for c in range(3):
        # A @ delta = (after - before): the displacement, sampled where seen
        rhs = np.concatenate(
            [dst[:, c] - src[:, c], np.zeros(n_nodes), np.zeros(n_nodes)]
        )
        delta[:, c] = lsmr(stack, rhs, atol=1e-8, btol=1e-8, maxiter=400)[0]

    lut = np.clip(ident + delta, 0.0, 1.0)

    if monotone:
        lut = np.clip(enforce_monotone(lut, size, density), 0.0, 1.0)

    # --- diagnostics -----------------------------------------------------
    pred = A @ lut
    resid = np.linalg.norm(pred - dst, axis=1)

    # Per-node disagreement: where samples that share a colour were sent to
    # different places, the edit was not colour-only.
    nearest = np.asarray(A.argmax(axis=1)).ravel()
    spread = np.zeros(n_nodes)
    cnt = np.bincount(nearest, minlength=n_nodes)
    for c in range(3):
        s1 = np.bincount(nearest, weights=dst[:, c], minlength=n_nodes)
        s2 = np.bincount(nearest, weights=dst[:, c] ** 2, minlength=n_nodes)
        with np.errstate(invalid="ignore", divide="ignore"):
            var = s2 / np.maximum(cnt, 1) - (s1 / np.maximum(cnt, 1)) ** 2
        spread += np.maximum(var, 0)
    spread = np.sqrt(spread)
    busy = cnt >= 20

    report = {
        "size": size,
        "samples": int(src.shape[0]),
        "cubeCoverage": round(coverage, 4),
        "residualMean": round(float(resid.mean()) * 255, 3),
        "residual95": round(float(np.percentile(resid, 95)) * 255, 3),
        "cellSpreadMean": round(float(spread[busy].mean()) * 255, 3) if busy.any() else 0.0,
        "cellSpread95": round(float(np.percentile(spread[busy], 95)) * 255, 3) if busy.any() else 0.0,
        "colourOnly": bool(busy.any() and float(np.percentile(spread[busy], 95)) * 255 < 12.0),
    }
    return lut, report


def fit_regions(before_rgb, after_rgb, regions, **kw):
    """One LUT per region, for edits that colour alone cannot separate.

    A LUT is a function of colour and nothing else, so when the retoucher
    brightened only the child, one skin tone had to map to two different
    outputs and a single LUT averaged them. `fit`'s `cellSpread` reports
    exactly that disagreement — this is what to do once it does.

    regions: {name: float mask}. Each gets its own LUT fitted on its own
    pixels, so neither has to compromise for the other.
    """
    out = {}
    for name, m in regions.items():
        try:
            lut, rep = fit(before_rgb, after_rgb, mask=m, **kw)
            rep["pixels"] = int((m > 0.5).sum())
            out[name] = (lut, rep)
        except ValueError as e:
            out[name] = (None, {"error": str(e)})
    return out


def apply_regions(rgb_u8, cubes, masks):
    """Blend region LUTs through their masks. Masks should be feathered, or
    the seam between two different grades shows as a line."""
    acc = np.zeros(rgb_u8.shape, np.float32)
    total = np.zeros(rgb_u8.shape[:2], np.float32)
    for name, path in cubes.items():
        m = masks[name].astype(np.float32)
        acc += apply_cube(rgb_u8, path).astype(np.float32) * m[..., None]
        total += m
    left = np.clip(1.0 - total, 0.0, 1.0)
    acc += rgb_u8.astype(np.float32) * left[..., None]
    total += left
    return np.clip(acc / np.maximum(total, 1e-6)[..., None], 0, 255).astype(np.uint8)


# ------------------------------------------------------------------ .cube


def write_cube(lut, path, title="learned"):
    """The industry text format — readable by Resolve, Premiere, Lightroom.

    Ordering is fixed by the spec: RED varies FASTEST. Our lattice is built
    R-major (red slowest), so it is transposed on the way out; getting this
    backwards produces a LUT that looks plausible and is completely wrong.
    """
    size = int(round(len(lut) ** (1 / 3)))
    cube = lut.reshape(size, size, size, 3)  # [r, g, b]
    ordered = cube.transpose(2, 1, 0, 3).reshape(-1, 3)  # -> red fastest
    with open(path, "w", encoding="ascii") as f:
        f.write(f'TITLE "{title}"\n')
        f.write(f"LUT_3D_SIZE {size}\n")
        f.write("DOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n\n")
        for r, g, b in ordered:
            f.write(f"{r:.6f} {g:.6f} {b:.6f}\n")
    return path


# ------------------------------------------------------------------ apply

_proc_cache = {}


def _processor(cube_path):
    key = (cube_path, os.path.getmtime(cube_path))
    hit = _proc_cache.get(key)
    if hit is not None:
        return hit
    import PyOpenColorIO as ocio

    tr = ocio.FileTransform(src=cube_path, interpolation=ocio.INTERP_TETRAHEDRAL)
    cfg = ocio.Config.CreateRaw()
    proc = cfg.getProcessor(tr).getDefaultCPUProcessor()
    _proc_cache.clear()
    _proc_cache[key] = proc
    return proc


def apply_cube(rgb_u8, cube_path):
    """Tetrahedral, via OpenColorIO — ~50ms for a 4K frame.

    Tetrahedral rather than trilinear on purpose: it reaches the accuracy of a
    lattice twice the size, and trilinear's failure mode is banding in the
    midtones, which is exactly where skin lives.
    """
    proc = _processor(cube_path)
    buf = np.ascontiguousarray(rgb_u8.astype(np.float32) / 255.0)
    proc.applyRGB(buf)
    return np.clip(buf * 255.0 + 0.5, 0, 255).astype(np.uint8)
