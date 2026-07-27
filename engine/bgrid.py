"""Bilateral grid of affine colour transforms — a grade that knows WHERE it is.

A 3D LUT maps colour to colour and nothing else. Three galleries in a row broke
on the same wall because of it: a light gradient across a poppy field, a haze
that is strong near the sun and weak away from it, a subject brightened while
its background was not. In every case one input colour needed two different
outputs, the LUT averaged them, and the result blotched. No lattice size fixed
it — 9^3 saved the foliage and turned skin pink, 33^3 saved the skin and
destroyed the foliage. It was never a resolution problem. The model simply had
no word for "where".

So the lattice gains two spatial axes:

    (x, y, luma)  ->  a 3x4 affine colour transform per cell

This is the representation from HDRNet (Gharbi et al., SIGGRAPH 2017) and the
bilateral-grid 3D-LUT work that followed. Luma is in there as well as x and y
because it is what keeps edges sharp: a cell covers a wide area of the frame,
and splitting it by brightness means the bright side of an edge and the dark
side get their own transforms instead of one smeared average.

It is still one sparse least-squares solve, the same machinery as lut.py, with
two extra dimensions. And it degrades correctly: on an edit that really is
colour-only, the spatial axes come out uniform and nothing is lost.
"""

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import lsmr

# Chosen by HELD-OUT error, not by fit. Fitting the whole frame picked 32x32,
# which scored 80.4% on the frame it was fitted to and then put purple blotches
# on the paths and green casts on faces in every other frame of the gallery: at
# that resolution a cell is small enough to memorise "this spot is dirt in haze",
# and in the next photograph that spot is a dress.
#
# Scoring on strips of the frame the fit never saw ranks them the other way, and
# the overfitting is visible as a widening seen/unseen gap:
#
#     4x4  gap  9.7      6x6  gap 10.9      32x32  gap 19.2
#
# 6x6 is deliberately too coarse to hold a composition. It can say "brighter
# toward the sun" and nothing narrower — which is exactly the class of thing a
# grade does and a 3D LUT could not express. The luma axis stays deep at 16:
# most of a grade is a function of brightness, only some of it of position.
SX = SY = 6
SL = 16

# Spatial smoothness has to be strong. A grade varies gently across a frame;
# anything that varies quickly is content, and fitting content is how a grid
# stops transferring to the next photograph.
LAMBDA_SPACE = 6.0
LAMBDA_LUMA = 2.0
LAMBDA_IDENTITY = 0.8
# Off-diagonal terms — red out taken from blue in — are what let a cell invent a
# hue that was never in the photograph. A grade almost never needs them, and an
# under-observed cell that has them produces neon foliage and magenta skin,
# which is exactly what a full affine did on every unseen frame. Held near zero.
LAMBDA_CROSS = 12.0

MAX_SAMPLES = 600_000
LUM = np.array([0.2126, 0.7152, 0.0722])


def _cells():
    return SX * SY * SL


def _weights(rgb01, xy01):
    """Trilinear membership over (x, y, luma) — 8 cells per sample."""
    n = rgb01.shape[0]
    lum = rgb01 @ LUM
    pos = np.stack([
        np.clip(xy01[:, 0], 0, 1) * (SX - 1),
        np.clip(xy01[:, 1], 0, 1) * (SY - 1),
        np.clip(lum, 0, 1) * (SL - 1),
    ], axis=1)
    base = np.minimum(np.floor(pos).astype(np.int64), [SX - 2, SY - 2, SL - 2])
    frac = pos - base

    rows = np.repeat(np.arange(n, dtype=np.int64), 8)
    cols = np.empty(n * 8, np.int64)
    vals = np.empty(n * 8, np.float64)
    k = 0
    for dx in (0, 1):
        wx = frac[:, 0] if dx else 1 - frac[:, 0]
        for dy in (0, 1):
            wy = frac[:, 1] if dy else 1 - frac[:, 1]
            for dl in (0, 1):
                wl = frac[:, 2] if dl else 1 - frac[:, 2]
                cols[k::8] = ((base[:, 0] + dx) * SY + (base[:, 1] + dy)) * SL + (base[:, 2] + dl)
                vals[k::8] = wx * wy * wl
                k += 1
    return rows, cols, vals


def _smoothness():
    """Penalise change between neighbouring cells, separately per axis so the
    spatial axes can be held much stiffer than the luma axis."""
    idx = np.arange(_cells()).reshape(SX, SY, SL)
    blocks = []
    for axis, lam in ((0, LAMBDA_SPACE), (1, LAMBDA_SPACE), (2, LAMBDA_LUMA)):
        a = np.moveaxis(idx, axis, 0)
        s, d = a[:-1].ravel(), a[1:].ravel()
        m = s.size
        rows = np.concatenate([np.arange(m), np.arange(m)])
        cols = np.concatenate([s, d])
        vals = np.concatenate([np.full(m, lam), np.full(m, -lam)])
        blocks.append(sp.csr_matrix((vals, (rows, cols)), shape=(m, _cells())))
    return sp.vstack(blocks, format="csr")


def fit(before_rgb, after_rgb, seed=0):
    """Both frames uint8 RGB, aligned, same shape. -> (grid, report).

    grid is (cells, 4, 3): rows [R, G, B, 1] of the affine transform.
    """
    if before_rgb.shape != after_rgb.shape:
        raise ValueError("frames must be aligned to the same shape first")
    h, w = before_rgb.shape[:2]

    src = before_rgb.reshape(-1, 3).astype(np.float64) / 255.0
    dst = after_rgb.reshape(-1, 3).astype(np.float64) / 255.0
    yy, xx = np.mgrid[0:h, 0:w]
    xy = np.stack([xx.ravel() / max(w - 1, 1), yy.ravel() / max(h - 1, 1)], axis=1)

    if src.shape[0] > MAX_SAMPLES:
        rng = np.random.default_rng(seed)
        keep = rng.choice(src.shape[0], MAX_SAMPLES, replace=False)
        src, dst, xy = src[keep], dst[keep], xy[keep]

    n = src.shape[0]
    rows, cols, vals = _weights(src, xy)

    # Each sample constrains its 8 cells' affine transforms. The unknown vector
    # holds 4 coefficients per cell per output channel; the design matrix is the
    # membership weight times the input feature [R, G, B, 1].
    feat = np.concatenate([src, np.ones((n, 1))], axis=1)  # (n, 4)
    C = _cells()
    A_blocks = []
    for f in range(4):
        A_blocks.append(sp.csr_matrix(
            (vals * feat[rows, f], (rows, cols)), shape=(n, C)))
    A = sp.hstack(A_blocks, format="csr")  # (n, 4C)

    S = _smoothness()
    S4 = sp.block_diag([S] * 4, format="csr")

    density = np.asarray(A_blocks[3].sum(axis=0)).ravel()  # membership mass
    quiet = 1.0 / (1.0 + density / 60.0)

    # Solve for the DEPARTURE from identity, so an unobserved cell's natural
    # answer is "leave this alone" rather than an invented affine transform.
    grid = np.zeros((C, 4, 3))
    for c in range(3):
        # per-feature penalty: the channel's own gain and its offset may move,
        # the two cross-channel terms are pinned
        pens = []
        for f in range(4):
            lam = LAMBDA_IDENTITY if (f == c or f == 3) else LAMBDA_CROSS
            pens.append(sp.diags(quiet * lam + lam * 0.15))
        P = sp.block_diag(pens, format="csr")

        stack = sp.vstack([A, S4, P], format="csr")
        ident = np.zeros(4 * C)
        ident[c * C:(c + 1) * C] = 1.0          # gain 1 on its own channel
        rhs = np.concatenate([
            dst[:, c] - A @ ident,               # residual against identity
            np.zeros(S4.shape[0]),
            np.zeros(4 * C),
        ])
        sol = lsmr(stack, rhs, atol=1e-8, btol=1e-8, maxiter=500)[0] + ident
        grid[:, :, c] = sol.reshape(4, C).T

    out = apply_samples(src, xy, grid)
    resid = float(np.linalg.norm(out - dst, axis=1).mean()) * 255

    # how much the grid actually varies across the frame — if this is near zero
    # the edit was colour-only after all, and we have lost nothing by asking
    g = grid.reshape(SX, SY, SL, 4, 3)
    spatial = float(np.abs(g - g.mean(axis=(0, 1), keepdims=True)).mean())

    return grid, {
        "cells": [SX, SY, SL],
        "samples": int(n),
        "residualMean": round(resid, 3),
        "spatialVariation": round(spatial, 4),
        "usesSpace": bool(spatial > 0.01),
    }


def apply_samples(rgb01, xy01, grid):
    rows, cols, vals = _weights(rgb01, xy01)
    n = rgb01.shape[0]
    feat = np.concatenate([rgb01, np.ones((n, 1))], axis=1)
    out = np.zeros((n, 3))
    for k in range(8):
        c = cols[k::8]
        wgt = vals[k::8][:, None]
        m = grid[c]  # (n, 4, 3)
        out += wgt * np.einsum("nf,nfc->nc", feat, m)
    return out


def apply(rgb_u8, grid, tile=512):
    """Apply to a full frame, in row bands so a 26MP image stays in memory."""
    h, w = rgb_u8.shape[:2]
    out = np.empty_like(rgb_u8)
    xs = np.arange(w) / max(w - 1, 1)
    for y0 in range(0, h, tile):
        y1 = min(h, y0 + tile)
        band = rgb_u8[y0:y1].reshape(-1, 3).astype(np.float64) / 255.0
        yy = np.repeat(np.arange(y0, y1) / max(h - 1, 1), w)
        xy = np.stack([np.tile(xs, y1 - y0), yy], axis=1)
        res = apply_samples(band, xy, grid)
        out[y0:y1] = np.clip(res * 255.0 + 0.5, 0, 255).astype(np.uint8).reshape(y1 - y0, w, 3)
    return out
