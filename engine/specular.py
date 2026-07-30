"""Specular highlight reduction — wet lips, oily forehead, shiny nose.

The class of blemish this handles is not a mark and not a shape: it is a
REFLECTION. Saliva on a lip, sweat on a temple and sebum on a nose all do the
same physical thing — they make a small patch of the surface mirror-like, so it
returns the colour of the LIGHT instead of the colour of the skin.

That gives the cleanest signature in this whole pipeline, and it is a pair:

    lightness goes UP        (it is returning a light source)
    chroma goes DOWN         (the light is neutral; the surface's pigment is
                              being drowned out, not replaced)

Nothing else on a face does both at once. Pigment raises chroma. A crease lowers
lightness. Bright skin texture keeps its chroma. So the two-sided test is what
makes this specific, and it is the same argument as `skinmodel.W_A = 1.0` read
backwards: there, colour identified a mark; here, colour LEAVING identifies a
reflection.

Why this is a different operator from `_fluid_trails`, which kept failing on the
case that produced it: that detector looks for a thin strand which has left an
orifice and runs down the face, and it therefore excludes the lips by
construction (`orifice == 0`). Measured on a drooling baby, its three largest
candidates were both eyes and a nostril, and the drool itself scored nothing at
all — the model was wrong, not the thresholds.

    THE THING THIS MUST NOT DO: make a lip matte.

Lips are naturally glossy and a lip with its highlight removed does not read as
clean, it reads as painted. So the specular map is FREQUENCY SEPARATED, and that
is the heart of this module rather than a refinement:

    broad, smooth sheen following the curve of the lip   -> natural gloss, KEPT
    small sharp bright blobs sitting on top of it        -> saliva, REDUCED

Because the broad component is subtracted out before anything is reduced, the
natural highlight is preserved BY CONSTRUCTION — the operator is mathematically
unable to flatten it, in the same way `pigment.even_pigment` is unable to
neutralise blush.

Nothing here reconstructs a pixel. Like the pigment operator, the worst failure
available to it is "did not do enough", never "invented something".
"""

from __future__ import annotations

import cv2
import numpy as np

import skinmodel

# Lab units. The most lightness this may ever pull out of a highlight.
MAX_REDUCE_L = 26.0

# Where "normal variation" of the surface's own lightness ends, in robust sigmas.
KNEE_SIGMA = 0.6

# How far the chroma must fall (in robust sigmas of the local chroma drop) for
# the gate to open fully. Bright skin that KEEPS its colour is not a reflection.
CHROMA_SIGMA = 0.8

# Scale of the natural sheen, as a fraction of the masked region's own size.
# Anything broader than this is the surface's shape and is never touched.
#
# Measured, and the first value was wrong in an instructive way: 0.30 on a
# 249px face put the split at ~16px, and the wet band across a baby's lower lip
# is BROADER than that — so the gloss-preserving term classified the drool as
# natural gloss and preserved it (mean reduction 0.31 L units, i.e. nothing).
# Natural gloss is at the scale of the WHOLE surface, not a fraction of it: one
# smooth band following the lip's curve. Anything smaller is sitting on top.
GLOSS_SCALE = 0.90


def _chroma(lab: np.ndarray) -> np.ndarray:
    """Distance from neutral in a*/b*. OpenCV Lab centres both at 128."""
    da = lab[..., 1] - 128.0
    db = lab[..., 2] - 128.0
    return np.sqrt(da * da + db * db)


def reduce_specular(
    rgb: np.ndarray,
    mask: np.ndarray,
    strength: float = 1.0,
    max_reduce: float = MAX_REDUCE_L,
):
    """Reduce sharp specular highlights inside `mask`, keeping the broad sheen.

    mask: float 0..1 — the surface to work on. Deliberately generic: the lips
          for drool, face skin for an oily forehead. The operator knows nothing
          about which, because the physics is the same.
    """
    if strength <= 0 or mask.max() <= 0:
        return rgb, {"specularPx": 0}

    support = (mask > 0.35).astype(np.float32)
    area = float(support.sum())
    if area < 64:
        return rgb, {"specularPx": 0}

    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    # Radius from the REGION's own size, not the face's: a lip and a forehead
    # differ by an order of magnitude and the sheen scales with the surface.
    extent = float(np.sqrt(area))
    radius = max(5, int(extent * GLOSS_SCALE)) | 1

    # The surface's own diffuse appearance, robust so a highlight cannot pull its
    # own reference up (the same substitution that unblocked the skin detector).
    diffuse_l = skinmodel.normalized_median(lab[..., 0], support, radius)
    chroma = _chroma(lab)
    diffuse_c = skinmodel.normalized_median(chroma, support, radius)

    inside = support > 0.5
    excess = lab[..., 0] - diffuse_l  # +ve: brighter than its own surface
    drop = diffuse_c - chroma  # +ve: less saturated than its own surface

    knee_c = skinmodel._robust_sigma(drop[inside]) * CHROMA_SIGMA

    # Two-sided test. Brightness alone is skin texture or a pale patch; chroma
    # loss alone is a washed-out shadow. A reflection is both.
    gate = np.clip(drop / max(1e-3, knee_c * 2.0), 0.0, 1.0)
    gate = gate * gate * (3 - 2 * gate)

    # The lightness knee is estimated from the surface's NON-REFLECTIVE pixels —
    # the fourth appearance of the same law in this pipeline (see
    # skinmodel.normalized_median, its sigma clipping, and pigment's L knee):
    # a reference estimated from data containing the outliers is pulled by them.
    # Measured here: taken over the whole lip the knee read 16.9 L units against a
    # peak excess of 82, so a full-strength pass removed 0.41 on average — the
    # highlight was setting its own bar out of reach. The chroma gate already
    # names the population that is not a reflection, so it is the honest sample.
    matte = inside & (gate < 0.25)
    if matte.sum() < 64:
        matte = inside
    knee_l = skinmodel._robust_sigma(excess[matte]) * KNEE_SIGMA
    spec = np.maximum(excess - knee_l, 0.0) * gate * support

    # --- the part that keeps a lip a lip -----------------------------------
    # Natural gloss is a wide, smooth band that follows the surface's curvature.
    # Saliva and sebum sit on top of it as small sharp blobs. Subtracting the
    # smooth component means the natural highlight is not "protected by tuning" —
    # it is not present in the signal being reduced at all.
    broad = cv2.GaussianBlur(spec, (radius, radius), 0)
    blobs = np.maximum(spec - broad, 0.0)

    reduce = np.minimum(blobs, max_reduce) * strength
    fr = max(3, int(extent * 0.05)) | 1
    reduce = cv2.GaussianBlur(reduce, (fr, fr), 0) * (support > 0.5)

    out = lab.copy()
    out[..., 0] = lab[..., 0] - reduce
    # A reflection drowns the surface's colour; taking the reflection out should
    # give the colour back. Pull a*/b* toward the surface's own local hue in
    # proportion to how much lightness was removed — never past it.
    give_back = np.clip(reduce / max(1e-3, max_reduce), 0.0, 1.0)[..., None]
    ref_a = skinmodel.normalized_median(lab[..., 1], support, radius)
    ref_b = skinmodel.normalized_median(lab[..., 2], support, radius)
    ref = np.stack([ref_a, ref_b], axis=2)
    out[..., 1:] = lab[..., 1:] + (ref - lab[..., 1:]) * give_back

    corrected = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
    meta = {
        "specularPx": int((reduce > 0.5).sum()),
        "specKneeL": round(float(knee_l), 2),
        "specKneeC": round(float(knee_c), 2),
        "specMaxReduce": round(float(reduce.max()), 2),
        "specMeanReduce": round(float(reduce[inside].mean()), 2),
        "glossKept": round(float(broad[inside].mean()), 2),
    }
    return corrected, meta
