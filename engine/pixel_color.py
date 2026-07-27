"""Learn a transferable colour model from one aligned before/after pair.

The model is deliberately layered:

1. a bounded global white-balance/exposure base;
2. stratified paired-pixel colour anchors with confidence;
3. a monotone luminance curve;
4. identity fallback for colours the reference never showed;
5. a protected subject path.

The compact anchor model is compiled to two 33^3 LUTs when applied. One carries
the full learned palette and one carries only the safe global base. A subject
mask blends toward the protected LUT, while low-chroma and unfamiliar colours
are already protected inside the full LUT.
"""

import hashlib
import json
import os
import time

import cv2
import numpy as np

import common
import compare
import globals_py
import masks as masks_mod
import regions as regions_mod


WORK_MAX = 900
BASE_MAX = 480
CLUSTERS = 24
MAX_SAMPLES = 150_000
# The following five constants were each chosen once, by inspection, and
# never swept against an alternative the way MAX_ANCHOR_DELTA and
# _STRENGTH_TRUST_SCALE were (see the holdout sweeps documented next to
# those two). They gate or shape every single correction the model makes,
# so a wrong value here is not cosmetic -- but nobody has actually measured
# whether these specific numbers are better than a neighbouring value.
# Promoted to module constants (were inline literals) so experiments/
# holdout.py can patch and sweep them the same way as every validated one.
#
# Relative weight of lightness vs. chroma in the feature space _features()
# builds -- used for BOTH the k-means clustering in _fit_anchors and the
# Gaussian-kernel distance in _palette_delta.
_FEATURE_L_WEIGHT = 0.28
# Confidence formula in _fit_anchors/_fit_material_anchors: how many Lab
# units of within-cluster spread it takes to halve confidence, and how many
# member pixels it takes to stop discounting confidence for low support.
_CONFIDENCE_SPREAD_SCALE = 28.0
_CONFIDENCE_SUPPORT_SCALE = 2200.0
# chroma_gate in _palette_delta/_material_pixel_delta: pixels below this
# much chroma get zero correction; the gate ramps to full strength this many
# units later. Protects near-neutral pixels from arbitrary hue rotation.
_CHROMA_GATE_FLOOR = 5.0
_CHROMA_GATE_SPAN = 13.0
# familiarity in _palette_delta: a pixel this far (in feature-space units)
# from every anchor gets zero correction -- the model refuses to extrapolate
# to colours the teach pair never showed it.
_FAMILIARITY_RADIUS = 34.0

# `_fit_base` is one global temperature/exposure grid search shared by the
# whole frame -- when background and subject need to move in OPPOSITE
# directions (a poppy field crushed dark+desaturated while the child in it
# is warmed and lifted, see the plan doc's problem 3), the single global
# search finds whatever the majority of the frame wants, and the subject
# gets that same wrong answer even through the "protected" safety path,
# because "protected" mode still tones with the one shared `base`. Measured
# on a real pair: retoucher lifted the subject +22.3 L, the shared-base
# engine output moved it -14.9 L -- not just less-good, backwards. Gated
# off by default; when enabled, `fit()` runs the exact same `_fit_base`
# grid search a second time, restricted to the subject mask, and
# `_apply_model_samples`'s "protected" mode uses that instead of the shared
# base -- reusing existing code with a different mask, no new model.
SUBJECT_BASE_ENABLED = False
_MIN_SUBJECT_BASE_PX = 400
# A hue rotation like magenta->rust needs ~95 in Lab. At 46 the model could not
# express it and cranked global strength to the rail instead. See
# experiments/holdout.py: on unseen pairs this is +8pt overall, +38pt on
# saturated colour, and neutral on sets that never hit the cap.
MAX_ANCHOR_DELTA = 110.0
CUBE_SIZE = 33
SUBJECT_PROTECTION = 0.92
RNG_SEED = 5208
# Retouchers remove people and objects. Those pixels still carry the graded
# palette, but they are not a before/after *pair* -- a removed blue shirt sitting
# under brown foliage would teach "blue becomes brown" and poison every blue in
# the shoot. Paired learning needs correspondence; palette statistics do not.
#
# OFF: measured and rejected. The premise holds -- on set `33`, the one with a
# person removed, this lifted saturated colour 77.3% -> 82.1%. But _correspondence
# is far too eager: it kept only 59% of that frame when the real damage is ~20%,
# and the lost training data cost -2.4pt on `22` and -1.1pt on `jm` holdout, where
# nothing was removed at all. Re-enable only behind a much more conservative
# detector, and only after experiments/holdout.py is green on all three sets.
LEARN_ONLY_MATCHED = False
# `_fit_anchors` excludes the whole subject from the general palette (see
# below), so the "full" cube carries zero real evidence about how skin was
# graded -- skin gets the safe base-only fallback whether or not the retoucher
# touched it at all. When there are enough real skin pixels in the pair, fit a
# second, skin-only anchor set from them and blend it in at SKIN_PROTECTION
# instead of the base-only fallback. Toggle for experiments/holdout.py A/B runs.
SKIN_MODEL_ENABLED = True
# Skin pixels are typically a small fraction of a frame, so this needs far
# fewer samples to trust than the background fit -- but too few and a couple
# of stray face-skin misclassifications become a whole "anchor".
MIN_SKIN_SAMPLES = 1500
# Lower than SUBJECT_PROTECTION: the skin cube is learned from the skin itself
# in this exact pair, not a guess. Still nonzero because per-pair skin sample
# counts are small relative to the background fit. Tune via holdout.py.
SKIN_PROTECTION = 0.35
# `_fit_anchors` groups pixels by colour alone, so two unrelated materials
# that coincide in Lab space (flowers vs. a similarly-toned wall, say) merge
# into one anchor with a delta that fits neither -- and because the learned
# model compiles to a colour-only LUT, no amount of within-teach-photo
# reclustering can fix this on a NEW photo (see docs/opo.md sections 8/10).
# Segmenting every applied photo with a class-agnostic model (regions.py,
# backed by MobileSAM) and matching its regions to fit-time material anchors
# by colour+texture gives materials the same cross-photo, runtime location
# awareness the skin model already has.
MATERIAL_MODEL_ENABLED = True
# A region smaller than this many *valid* (non-subject, non-rim, non-neutral)
# pixels in the teach pair is too little evidence to trust as its own anchor.
MIN_MATERIAL_REGION_PX = 600
# Lower than SUBJECT_PROTECTION/SKIN_PROTECTION for the same reason skin's is:
# each material anchor is learned from a single region in a single photo, not
# thousands of samples -- start conservative, tune via holdout.py.
MATERIAL_PROTECTION = 0.35
# How far (in the same weighted Lab feature space _features() produces) a new
# photo's region can sit from a material anchor's colour and still count as a
# match. Texture only breaks near-ties, so this gate is colour-first.
_MATERIAL_MATCH_MAX_DISTANCE = 14.0
_MATERIAL_TEXTURE_WEIGHT = 0.15
# Each anchor from _fit_anchors carries one constant delta (the cluster's
# median target-source shift) -- CLUSTERS caps the whole model at ~24 such
# constants per photo, regardless of how smoothly _palette_delta blends
# between them. That is a real, separate ceiling from anything about
# alignment or element identity: on `33`'s own flower pixels (chroma>55),
# only 43% of the colour gap closed because one cluster has to speak for a
# whole range of in-cluster shades with a single number (docs/opo.md
# section 13). LOCAL_SLOPE_ENABLED lets an anchor's delta vary LINEARLY with
# colour around its own centre -- still a pure function of the pixel's own
# colour, so it stays compatible with the compiled 33^3 LUT the same way the
# constant delta is (see _compile_processors: it evaluates the model on a
# synthetic colour cube with no spatial structure at all, which is exactly
# why a *spatial* feature could never be compiled this way and would have to
# run per-photo like material anchors already do). Off by default; validate
# via experiments/holdout.py the same way every prior change here was.
LOCAL_SLOPE_ENABLED = False
# An anchor needs this many of its own training pixels before a per-anchor
# slope is fit at all -- a handful of points cannot support a 3x3 regression
# without just fitting noise.
_MIN_SLOPE_SAMPLES = 40
# Same empirical-Bayes shape as _STRENGTH_TRUST_SCALE: trust = support /
# (support + K). A cluster with little evidence keeps slope near zero (i.e.
# today's constant-delta behaviour); one with lots of real evidence (a
# flower filling a fifth of the frame) earns a slope closer to its own fit.
_SLOPE_TRUST_SCALE = 6000.0
# Offsets from an anchor's own centre are clipped to this radius (same units
# as _features()) before the slope is applied, so a stray training pixel far
# from its cluster centre cannot make the linear term extrapolate to an
# absurd correction. The existing MAX_ANCHOR_DELTA cap in _palette_delta is
# still the final backstop regardless.
_SLOPE_TRUST_RADIUS = 40.0

_CUBE_CACHE = {}


def _resize(rgb, cap):
    height, width = rgb.shape[:2]
    scale = min(1.0, float(cap) / max(height, width))
    if scale >= 1.0:
        return rgb
    return cv2.resize(
        rgb,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )


def _lab(rgb):
    return cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)


def _look_lab(rgb):
    return cv2.GaussianBlur(_lab(rgb), (0, 0), 2.0)


def _features(lab):
    return np.stack(
        (
            (lab[..., 0] - 128.0) * _FEATURE_L_WEIGHT,
            lab[..., 1] - 128.0,
            lab[..., 2] - 128.0,
        ),
        axis=-1,
    )


def _subject_mask(rgb):
    masks_mod.set_source(rgb)
    try:
        return masks_mod.get_mask(rgb, "subject").astype(np.float32)
    except Exception:
        return np.zeros(rgb.shape[:2], np.float32)
    finally:
        masks_mod.clear_source()


def _fast_subject_mask(rgb):
    small = common.downscale(rgb, 1200)
    mask = _subject_mask(small)
    return common.upscale_to(mask, rgb.shape).astype(np.float32)


def _skin_mask(rgb):
    masks_mod.set_source(rgb)
    try:
        face = masks_mod.get_mask(rgb, "face-skin")
        body = masks_mod.get_mask(rgb, "body-skin")
        return np.maximum(face, body).astype(np.float32)
    except Exception:
        return np.zeros(rgb.shape[:2], np.float32)
    finally:
        masks_mod.clear_source()


def _fast_skin_mask(rgb):
    small = common.downscale(rgb, 1200)
    mask = _skin_mask(small)
    return common.upscale_to(mask, rgb.shape).astype(np.float32)


def _tone(rgb, params):
    output, _ = globals_py.tone_color(rgb, params)
    return output


def _correspondence(before, after):
    """True where both frames still show the same thing.

    Compares local gradient structure, which survives any colour grade but not
    a removed subject or a border smeared by warping a crop back into place.
    """

    def edges(rgb):
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
        return np.hypot(
            cv2.Sobel(gray, cv2.CV_32F, 1, 0, 3),
            cv2.Sobel(gray, cv2.CV_32F, 0, 1, 3),
        )

    left, right = edges(before), edges(after)
    window = (31, 31)
    mean_left, mean_right = cv2.blur(left, window), cv2.blur(right, window)
    std_left = np.sqrt(np.maximum(cv2.blur(left * left, window) - mean_left ** 2, 1e-6))
    std_right = np.sqrt(np.maximum(cv2.blur(right * right, window) - mean_right ** 2, 1e-6))
    correlation = (cv2.blur(left * right, window) - mean_left * mean_right) / (
        std_left * std_right
    )
    mismatch = cv2.blur((correlation < 0.25).astype(np.float32), (41, 41)) > 0.20
    return ~mismatch


def _fit_base(before, after, matched=None, restrict=None):
    before_small = _resize(before, BASE_MAX)
    after_small = _resize(after, BASE_MAX)
    target = _look_lab(after_small)

    height, width = before_small.shape[:2]
    rim = max(3, round(min(height, width) * 0.03))
    valid = np.ones((height, width), bool)
    valid[:rim] = False
    valid[-rim:] = False
    valid[:, :rim] = False
    valid[:, -rim:] = False
    if matched is not None:
        resized = cv2.resize(
            matched.astype(np.uint8), (width, height), interpolation=cv2.INTER_NEAREST
        ).astype(bool)
        if resized.sum() > valid.sum() * 0.15:
            valid &= resized
    if restrict is not None:
        # Unlike `matched` above, a deliberate restriction (e.g. to just the
        # subject) is not skipped for covering "too little" of the frame --
        # a person filling 5% of a wide shot is the normal case this exists
        # for, not a data-loss risk to guard against. Only refuse if there is
        # too little absolute evidence to fit two parameters at all.
        resized_restrict = cv2.resize(
            restrict.astype(np.uint8), (width, height), interpolation=cv2.INTER_NEAREST
        ).astype(bool)
        restricted = valid & resized_restrict
        if restricted.sum() >= _MIN_SUBJECT_BASE_PX:
            valid = restricted

    def score(params):
        delta = np.sqrt(((_look_lab(_tone(before_small, params)) - target) ** 2).sum(2))
        return float(delta[valid].mean())

    best = (score({}), {"temperature": 0.0, "exposure": 0.0})
    for temperature in np.linspace(-80, 80, 17):
        for exposure in np.linspace(-30, 30, 13):
            params = {
                "temperature": float(temperature),
                "exposure": float(exposure),
            }
            value = score(params)
            if value < best[0]:
                best = (value, params)

    center_temperature = best[1]["temperature"]
    center_exposure = best[1]["exposure"]
    for temperature in np.linspace(center_temperature - 10, center_temperature + 10, 9):
        for exposure in np.linspace(center_exposure - 5, center_exposure + 5, 9):
            params = {
                "temperature": float(np.clip(temperature, -100, 100)),
                "exposure": float(np.clip(exposure, -50, 50)),
            }
            value = score(params)
            if value < best[0]:
                best = (value, params)
    return best[1], best[0]


def _stratified_positions(lab, valid):
    light = np.clip((lab[..., 0] / 256.0 * 8).astype(np.int32), 0, 7)
    aa = np.clip(((lab[..., 1] - 64.0) / 128.0 * 8).astype(np.int32), 0, 7)
    bb = np.clip(((lab[..., 2] - 64.0) / 128.0 * 8).astype(np.int32), 0, 7)
    bins = (light * 64 + aa * 8 + bb).reshape(-1)
    positions = np.flatnonzero(valid.reshape(-1))
    occupied = np.unique(bins[positions])
    per_bin = max(80, MAX_SAMPLES // max(len(occupied), 1))
    rng = np.random.default_rng(RNG_SEED)
    selected = []
    for bin_id in occupied:
        candidates = positions[bins[positions] == bin_id]
        if len(candidates) > per_bin:
            candidates = rng.choice(candidates, per_bin, replace=False)
        selected.append(candidates)
    if not selected:
        raise ValueError("reference pair has no usable colour samples")
    result = np.concatenate(selected)
    if len(result) > MAX_SAMPLES:
        result = rng.choice(result, MAX_SAMPLES, replace=False)
    return result


def _cap_vectors(vectors, limit):
    length = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors * np.minimum(1.0, limit / np.maximum(length, 1e-6))


def _fit_anchors(source_lab, target_lab, valid):
    positions = _stratified_positions(source_lab, valid)
    width = source_lab.shape[1]
    yy = positions // width
    xx = positions % width
    holdout = ((xx // 56 + yy // 56) % 5) == 0
    train_positions = positions[~holdout]
    validation_positions = positions[holdout]
    if len(validation_positions) < 1000:
        validation_positions = positions[::5]
        train_positions = positions[np.arange(len(positions)) % 5 != 0]

    all_features = _features(source_lab).reshape(-1, 3)
    delta = (target_lab - source_lab).reshape(-1, 3)
    train_features = all_features[train_positions].astype(np.float32)

    cluster_count = min(CLUSTERS, max(8, len(train_features) // 2500))
    criteria = (
        cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER,
        80,
        0.05,
    )
    # Unseeded, cv2.kmeans draws on OpenCV's global RNG, whose state (and thus
    # the resulting clusters) depends on how many other kmeans calls already
    # ran in this process -- fitting the same pair twice in one run of
    # experiments/holdout.py could silently pick different anchors. Reset it
    # so a fit only ever depends on its own inputs.
    cv2.setRNGSeed(RNG_SEED)
    _, labels, centers = cv2.kmeans(
        train_features,
        cluster_count,
        None,
        criteria,
        6,
        cv2.KMEANS_PP_CENTERS,
    )
    labels = labels.reshape(-1)

    deltas = []
    confidences = []
    supports = []
    slopes = []
    for index in range(cluster_count):
        selected = labels == index
        values = delta[train_positions][selected]
        median = np.median(values, axis=0)
        spread = float(np.median(np.linalg.norm(values - median, axis=1)))
        support = int(selected.sum())
        confidence = float(np.clip(1.0 - spread / _CONFIDENCE_SPREAD_SCALE, 0.08, 1.0))
        confidence *= float(np.clip(support / _CONFIDENCE_SUPPORT_SCALE, 0.2, 1.0))
        deltas.append(median)
        confidences.append(confidence)
        supports.append(support)
        if LOCAL_SLOPE_ENABLED and support >= _MIN_SLOPE_SAMPLES:
            offset = np.clip(
                train_features[selected] - centers[index],
                -_SLOPE_TRUST_RADIUS,
                _SLOPE_TRUST_RADIUS,
            )
            residual = values - median
            fit_slope, *_ = np.linalg.lstsq(
                offset.astype(np.float64), residual.astype(np.float64), rcond=None,
            )
            trust = support / (support + _SLOPE_TRUST_SCALE)
            slopes.append((fit_slope * trust).astype(np.float32))
        else:
            slopes.append(np.zeros((3, 3), np.float32))

    model = {
        "anchors": centers.astype(np.float32),
        "deltas": _cap_vectors(
            np.asarray(deltas, np.float32),
            MAX_ANCHOR_DELTA,
        ),
        "confidences": np.asarray(confidences, np.float32),
        "supports": np.asarray(supports, np.int32),
    }
    if LOCAL_SLOPE_ENABLED:
        model["slopes"] = np.asarray(slopes, np.float32)
    return model, validation_positions, len(positions)


def _palette_delta(lab_values, model, strengths, sigma):
    values = _features(lab_values.reshape(-1, 1, 3)).reshape(-1, 3)
    anchors = model["anchors"]
    offset = values[:, None, :] - anchors[None, :, :]
    distance2 = (offset ** 2).sum(axis=2)
    nearest = np.sqrt(distance2.min(axis=1))
    weights = np.exp(-distance2 / (2.0 * sigma * sigma))
    weights *= model["confidences"][None, :]
    weight_sum = np.maximum(weights.sum(1, keepdims=True), 1e-6)
    slopes = model.get("slopes")
    if slopes is not None and LOCAL_SLOPE_ENABLED:
        # Each anchor's delta becomes deltas[i] + slopes[i] @ (colour offset
        # from that anchor's own centre), still purely a function of the
        # pixel's own colour -- see LOCAL_SLOPE_ENABLED for why that matters.
        clipped_offset = np.clip(offset, -_SLOPE_TRUST_RADIUS, _SLOPE_TRUST_RADIUS)
        linear = np.einsum("pnj,njk->pnk", clipped_offset, slopes)
        local_deltas = model["deltas"][None, :, :] + linear
        delta = (weights[:, :, None] * local_deltas).sum(1) / weight_sum
    else:
        delta = weights @ model["deltas"] / weight_sum
    # A pixel's effective strength is blended from nearby anchors the same way
    # the delta itself is, so two anchors with different calibrated strengths
    # (see _calibrate_anchor_strengths) meet at a smooth transition, not a seam.
    strength_field = weights @ np.asarray(strengths, np.float32).reshape(-1, 1) / weight_sum

    chroma = np.hypot(lab_values[:, 1] - 128.0, lab_values[:, 2] - 128.0)
    chroma_gate = np.clip((chroma - _CHROMA_GATE_FLOOR) / _CHROMA_GATE_SPAN, 0.0, 1.0)
    familiarity = np.clip(1.0 - nearest / _FAMILIARITY_RADIUS, 0.0, 1.0)
    result = delta * (chroma_gate * familiarity)[:, None] * strength_field
    # MAX_ANCHOR_DELTA already bounds each LEARNED anchor delta to the most
    # extreme shift a real regrade should need. `strength` multiplies AFTER
    # that cap and the safety search below only ever checks chroma (a/b) --
    # nothing stopped a pixel whose blended delta leans on lightness from
    # being pushed past the cap by strength alone. Re-applying the same bound
    # to what's actually applied, not just what was learned, closes that gap
    # regardless of how strength was chosen (global or per-anchor).
    return _cap_vectors(result, MAX_ANCHOR_DELTA)


_STRENGTH_GRID = (0.65, 0.9, 1.2, 1.5, 1.8, 2.15, 2.5)
# A 95th-percentile read from fewer points than this is too noisy to use as a
# per-anchor safety ceiling at all -- below it, an anchor is pure global.
_MIN_ANCHOR_VALIDATION = 20
# Empirical-Bayes-style shrinkage: trust = count / (count + STRENGTH_TRUST_SCALE).
# An anchor needs about this many of its OWN validation pixels before its local
# read gets equal say with the whole-image strength. Within-photo validation is
# a sample of one shoot's one teach photo, not the whole shoot -- a cluster that
# looks great on its own few hundred pixels can still be a photo-specific fluke
# that a strict CONFIDENCE-only shrink (spread/support from TRAINING data) let
# through too easily and cost holdout accuracy on unseen photos.
#
# Validated on experiments/holdout.py across 4000-15000 (a stable plateau, not
# a lucky point): +3.4 to +3.7pt saturated-colour on `33`'s own teach pair,
# essentially bit-identical overall/vivid/skin on `22` and `jm` holdout (9 and
# 10 unseen pairs) versus no per-anchor calibration at all. Patchable there as
# pixel_color._STRENGTH_TRUST_SCALE.
_STRENGTH_TRUST_SCALE = 6000.0


def _best_uniform_strength(source, target, model, strengths_template, sigma, safe_ceiling):
    """The single strength (broadcast to every entry of strengths_template)
    that minimises error on these pixels without exceeding safe_ceiling.
    Used both for the whole-image reference and, with a 1-anchor model and
    template, for one cluster's own local read."""
    best = (float("inf"), float(strengths_template[0]))
    for strength in _STRENGTH_GRID:
        strengths = np.full_like(strengths_template, strength)
        output = np.clip(source + _palette_delta(source, model, strengths, sigma), 0, 255)
        error = float(np.linalg.norm(output - target, axis=1).mean())
        chroma95 = float(np.percentile(np.hypot(output[:, 1] - 128.0, output[:, 2] - 128.0), 95))
        if chroma95 <= safe_ceiling and error < best[0]:
            best = (error, strength)
    return best[1]


def _calibrate_anchor_strengths(source_values, target_values, nearest, model, sigma, global_chroma95):
    """One strength per anchor instead of one for the whole photo.

    A single shared knob has to average over every colour in the frame, so
    it's set by whatever's most common -- a small but important region (say,
    the one saturated colour the retoucher nearly desaturated) gets stopped
    halfway there to avoid overcorrecting the rest of the image. Each anchor
    is instead validated against only the pixels closest to IT, capped by
    what THAT region's own target actually looks like, and shrunk toward the
    whole-image strength in proportion to how much of its own validation
    evidence it actually has (see _STRENGTH_TRUST_SCALE).
    """
    anchors = model["anchors"]
    n = len(anchors)
    global_strength = _best_uniform_strength(
        source_values, target_values, model, np.ones(n, np.float32), sigma, global_chroma95 + 5.0,
    )
    strengths = np.full(n, global_strength, np.float32)
    for index in range(n):
        cluster = nearest == index
        count = int(cluster.sum())
        if count < _MIN_ANCHOR_VALIDATION:
            continue
        cluster_source = source_values[cluster]
        cluster_target = target_values[cluster]
        cluster_chroma95 = float(
            np.percentile(np.hypot(cluster_target[:, 1] - 128.0, cluster_target[:, 2] - 128.0), 95)
        )
        single = {
            "anchors": anchors[index : index + 1],
            "deltas": model["deltas"][index : index + 1],
            "confidences": model["confidences"][index : index + 1],
        }
        # If this anchor also carries a local-slope term, the strength found
        # here must be calibrated against the SAME delta(colour) function
        # apply-time actually uses -- otherwise strength is tuned for a
        # slope-less anchor while a non-zero slope gets multiplied by it
        # anyway, exactly the "two mechanisms disagreeing about the model"
        # bug class already caught twice in this file (skin blend, material
        # replace-vs-residual).
        if "slopes" in model:
            single["slopes"] = model["slopes"][index : index + 1]
        local_strength = _best_uniform_strength(
            cluster_source, cluster_target, single, np.ones(1, np.float32), sigma,
            cluster_chroma95 + 5.0,
        )
        trust = count / (count + _STRENGTH_TRUST_SCALE)
        strengths[index] = trust * local_strength + (1.0 - trust) * global_strength
    return strengths


def _choose_palette(source_lab, target_lab, positions, model):
    source_values = source_lab.reshape(-1, 3)[positions]
    target_values = target_lab.reshape(-1, 3)[positions]
    baseline = float(np.linalg.norm(source_values - target_values, axis=1).mean())
    target_chroma95 = float(
        np.percentile(
            np.hypot(target_values[:, 1] - 128.0, target_values[:, 2] - 128.0),
            95,
        )
    )

    features = _features(source_values.reshape(-1, 1, 3)).reshape(-1, 3)
    distance2 = ((features[:, None, :] - model["anchors"][None, :, :]) ** 2).sum(axis=2)
    nearest = distance2.argmin(axis=1)

    trials = []
    candidates = []
    for sigma in (6.0, 8.0, 11.0, 15.0, 19.0):
        strengths = _calibrate_anchor_strengths(
            source_values, target_values, nearest, model, sigma, target_chroma95,
        )
        output = np.clip(
            source_values + _palette_delta(source_values, model, strengths, sigma), 0, 255,
        )
        error = float(np.linalg.norm(output - target_values, axis=1).mean())
        chroma95 = float(
            np.percentile(np.hypot(output[:, 1] - 128.0, output[:, 2] - 128.0), 95)
        )
        safe = chroma95 <= target_chroma95 + 5.0
        trials.append(
            {
                "sigma": sigma,
                "meanStrength": round(float(strengths.mean()), 3),
                "error": round(error, 4),
                "chroma95": round(chroma95, 3),
                "safe": bool(safe),
            }
        )
        candidates.append((safe, error, sigma, strengths, chroma95))

    safe_candidates = [c for c in candidates if c[0]]
    pool = safe_candidates if safe_candidates else candidates
    key = (lambda c: c[1]) if safe_candidates else (lambda c: (c[4], c[1]))
    _, error, sigma, strengths, _ = min(pool, key=key)

    return {
        "error": float(error),
        "strength": float(strengths.mean()),
        "strengths": strengths,
        "sigma": float(sigma),
        "baseline": baseline,
        "trials": trials,
    }


def _material_pixel_delta(lab_values, delta, strength):
    """A material anchor's delta, applied uniformly to pixels already KNOWN
    (via real segmentation, not colour-nearest) to belong to it.

    Unlike _palette_delta there is no "familiarity"/nearest-anchor blending
    to do -- segment membership already answered that question. The chroma
    gate and MAX_ANCHOR_DELTA cap are still real safety nets (protect
    near-neutral pixels inside the segment; stop `strength` from pushing the
    applied shift past what a real regrade should need, same bug class as
    section 14 of docs/opo.md) so both are kept.
    """
    chroma = np.hypot(lab_values[:, 1] - 128.0, lab_values[:, 2] - 128.0)
    chroma_gate = np.clip((chroma - _CHROMA_GATE_FLOOR) / _CHROMA_GATE_SPAN, 0.0, 1.0)
    result = delta[None, :] * strength * chroma_gate[:, None]
    return _cap_vectors(result, MAX_ANCHOR_DELTA)


def _best_material_strength(source_values, target_values, delta, safe_ceiling):
    """Grid-search the scalar strength for one material anchor's own known
    member pixels. No colour-nearest search needed (see _material_pixel_delta)."""
    best = (float("inf"), _STRENGTH_GRID[0])
    for strength in _STRENGTH_GRID:
        applied = _material_pixel_delta(source_values, delta, strength)
        output = np.clip(source_values + applied, 0, 255)
        error = float(np.linalg.norm(output - target_values, axis=1).mean())
        chroma95 = float(
            np.percentile(np.hypot(output[:, 1] - 128.0, output[:, 2] - 128.0), 95)
        )
        if chroma95 <= safe_ceiling and error < best[0]:
            best = (error, strength)
    return best[1]


def _fit_material_anchors(before, general_lab, target_lab, valid, general_strength):
    """One anchor per class-agnostic region from regions.get_regions(before),
    instead of per colour cluster -- see MATERIAL_MODEL_ENABLED's comment for
    why this is the only thing that can give materials cross-photo awareness.

    `general_lab` is what the already-fitted general (+skin) model produces
    for this exact teach photo (palette_lab in fit()) -- deltas are learned
    as the RESIDUAL against that, not against the raw base-corrected source,
    so a material anchor only has to express what the general per-colour
    model still gets wrong, not redo work it already does well.

    Returns None when nothing in the teach pair had enough real evidence.
    """
    regions_mod.set_source(before)
    try:
        labels, region_stats = regions_mod.get_regions(before)
    finally:
        regions_mod.clear_source()

    delta_map = target_lab - general_lab
    anchors, deltas, confidences, supports, textures, strengths = [], [], [], [], [], []
    for stat in region_stats:
        member = (labels == stat["id"]) & valid
        support = int(member.sum())
        if support < MIN_MATERIAL_REGION_PX:
            continue

        values = delta_map[member]
        median = np.median(values, axis=0)
        spread = float(np.median(np.linalg.norm(values - median, axis=1)))
        confidence = float(np.clip(1.0 - spread / _CONFIDENCE_SPREAD_SCALE, 0.08, 1.0))
        confidence *= float(np.clip(support / _CONFIDENCE_SUPPORT_SCALE, 0.2, 1.0))
        capped_delta = _cap_vectors(median.reshape(1, 3), MAX_ANCHOR_DELTA)[0]

        source_values = general_lab[member]
        target_values = target_lab[member]
        target_chroma95 = float(
            np.percentile(
                np.hypot(target_values[:, 1] - 128.0, target_values[:, 2] - 128.0), 95,
            )
        )
        local_strength = _best_material_strength(
            source_values, target_values, capped_delta, target_chroma95 + 5.0,
        )
        # Same empirical-Bayes shrink as the general model's per-anchor
        # strength (_STRENGTH_TRUST_SCALE): thin evidence stays close to the
        # already-safety-vetted whole-image strength, a well-evidenced
        # region (the flower filling a chunk of the frame) gets to express
        # its own correction.
        trust = support / (support + _STRENGTH_TRUST_SCALE)
        strength = trust * local_strength + (1.0 - trust) * general_strength

        anchors.append(
            _features(np.asarray(stat["meanLab"], np.float32).reshape(1, 1, 3)).reshape(3)
        )
        deltas.append(capped_delta)
        confidences.append(confidence)
        supports.append(support)
        textures.append(stat["texture"])
        strengths.append(strength)

    if not anchors:
        return None

    strengths = np.asarray(strengths, np.float32)
    return {
        "materialAnchors": np.asarray(anchors, np.float32),
        "materialDeltas": np.asarray(deltas, np.float32),
        "materialConfidences": np.asarray(confidences, np.float32),
        "materialSupports": np.asarray(supports, np.int32),
        "materialTextures": np.asarray(textures, np.float32),
        "materialStrengths": strengths,
        "materialStrength": float(strengths.mean()),
        "materialProtection": MATERIAL_PROTECTION,
    }


def _apply_material(full, rgb, model, subject):
    """Segment the actual TARGET photo (not the teach pair) and match its
    own regions against the model's material anchors by colour+texture --
    not via the colour-only LUT, since a material anchor's identity is not a
    function of colour alone (docs/opo.md sections 8/10). Unmatched regions
    (or none found) get material_confidence 0, the same fallback-to-existing-
    result pattern every other tier of this engine already follows.

    `full` is the already-computed general(+skin-blended) render -- base
    tone, general per-colour anchors and the luma curve all already applied.
    Material anchors were fit as a RESIDUAL against that same quantity (see
    _fit_material_anchors), so this ADDS on top of it instead of rebuilding
    from raw `rgb`, the same "never replace the existing safety net, only
    refine it" rule the skin blend follows. An earlier version rebuilt from
    base-tone alone and threw away the general model's own correction --
    regressed every holdout set, because materials (unlike skin) are NOT
    excluded from the general anchor fit and that correction was often
    already good.

    Returns (material_rgb, material_confidence), both full-frame, for
    _blend_protected to layer on top of the full/skin/protected result
    exactly like the skin cube does.
    """
    regions_mod.set_source(rgb)
    try:
        labels, region_stats = regions_mod.get_regions(rgb)
    finally:
        regions_mod.clear_source()

    height, width = rgb.shape[:2]
    confidence = np.zeros((height, width), np.float32)
    if not region_stats:
        return full, confidence

    anchors = model["materialAnchors"]
    deltas = model["materialDeltas"]
    textures = model["materialTextures"]
    strengths = _resolved_strengths(
        model, len(anchors), "materialStrengths", "materialStrength"
    )

    lab = _lab(full)
    material_lab = lab.copy()
    not_subject = subject < 0.25
    feather = max(3, round(min(height, width) * 0.004))

    for stat in region_stats:
        member = (labels == stat["id"]) & not_subject
        if not member.any():
            continue
        mean_feature = _features(
            np.asarray(stat["meanLab"], np.float32).reshape(1, 1, 3)
        ).reshape(3)
        colour_dist = np.linalg.norm(anchors - mean_feature[None, :], axis=1)
        texture_dist = np.abs(textures - stat["texture"]) * _MATERIAL_TEXTURE_WEIGHT
        index = int(np.argmin(colour_dist + texture_dist))
        if colour_dist[index] > _MATERIAL_MATCH_MAX_DISTANCE:
            continue

        segment_lab = lab[member]
        applied = _material_pixel_delta(segment_lab, deltas[index], strengths[index])
        material_lab[member] = np.clip(segment_lab + applied, 0, 255)
        soft = cv2.GaussianBlur(member.astype(np.float32), (0, 0), feather)
        confidence = np.maximum(confidence, soft)

    material_rgb = cv2.cvtColor(
        np.clip(material_lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB
    )
    return material_rgb, confidence


def _fit_luma_curve(source_lab, target_lab, valid):
    source_l = source_lab[..., 0].astype(np.uint8)
    target_l = target_lab[..., 0]
    curve = np.full(256, np.nan, np.float32)
    for level in range(256):
        selected = (source_l == level) & valid
        if selected.sum() >= 40:
            curve[level] = np.median(target_l[selected])
    known = np.isfinite(curve)
    if known.sum() < 8:
        return np.arange(256, dtype=np.float32)
    levels = np.arange(256)
    curve = np.interp(levels, levels[known], curve[known]).astype(np.float32)
    curve = cv2.GaussianBlur(curve.reshape(-1, 1), (0, 0), 2.2).reshape(-1)
    curve = np.maximum.accumulate(curve)
    identity = levels.astype(np.float32)
    return np.clip(identity + np.clip(curve - identity, -38.0, 38.0), 0, 255)


def _resolved_strengths(model, count, strengths_key, scalar_key):
    """Per-anchor strengths if the model has them, else the old scalar broadcast.

    Older serialized models only ever carried one shared `strength`/`skinStrength`
    float -- they still load and render identically to how they always did.
    """
    strengths = model.get(strengths_key)
    if strengths is not None:
        return np.asarray(strengths, np.float32)
    return np.full(count, float(model[scalar_key]), np.float32)


def _apply_model_samples(rgb_values, model, mode="full"):
    """mode: 'full' (background+general anchors), 'protected' (base only), or
    'skin' (the separate anchor set learned from face/body skin pixels, if any)."""
    shape = rgb_values.shape
    rgb = rgb_values.reshape(-1, 1, 3).astype(np.uint8)
    # "protected" exists so the subject can fall back to something safe when
    # the general anchors are not trusted there -- but until subjectBase, it
    # fell back to the SAME shared base as "full", so a scene where subject
    # and background need opposite exposure/temperature (see
    # SUBJECT_BASE_ENABLED) got the wrong answer even on the "safe" path.
    base_params = (
        model.get("subjectBase", model["base"]) if mode == "protected" else model["base"]
    )
    corrected = _tone(rgb, base_params)
    lab = _lab(corrected).reshape(-1, 3)
    if mode == "full":
        strengths = _resolved_strengths(model, len(model["anchors"]), "strengths", "strength")
        lab += _palette_delta(lab, model, strengths, model["sigma"])
    elif mode == "skin":
        skin_model = {
            "anchors": model["skinAnchors"],
            "deltas": model["skinDeltas"],
            "confidences": model["skinConfidences"],
        }
        if "skinSlopes" in model:
            skin_model["slopes"] = model["skinSlopes"]
        strengths = _resolved_strengths(
            model, len(model["skinAnchors"]), "skinStrengths", "skinStrength",
        )
        lab += _palette_delta(lab, skin_model, strengths, model["skinSigma"])
    lab = np.clip(lab, 0, 255)
    source_l = lab[:, 0].astype(np.uint8)
    curve = model["lumaCurve"]
    mapped = curve[source_l]
    lab[:, 0] = np.clip(
        lab[:, 0] + (mapped - lab[:, 0]) * model["lumaStrength"],
        0,
        255,
    )
    output = cv2.cvtColor(
        lab.reshape(-1, 1, 3).astype(np.uint8),
        cv2.COLOR_LAB2RGB,
    ).reshape(shape)
    return output


# Present only when fit() found enough real skin pixels to trust a second,
# skin-only anchor set (see SKIN_MODEL_ENABLED). Absent on every older model.
# Present only on models fit by a newer engine version than what produced
# them -- skin fields need enough real skin pixels (SKIN_MODEL_ENABLED), and
# `strengths`/`skinStrengths` are the per-anchor calibration that superseded a
# single scalar `strength`/`skinStrength` (still written, now as their mean,
# so older engine code and old models both keep working unchanged).
_OPTIONAL_ARRAY_KEYS = (
    "skinAnchors", "skinDeltas", "skinConfidences", "skinSupports",
    "strengths", "skinStrengths", "slopes", "skinSlopes",
    "materialAnchors", "materialDeltas", "materialConfidences",
    "materialSupports", "materialTextures", "materialStrengths",
)


def _model_arrays(model):
    result = dict(model)
    for key in ("anchors", "deltas", "confidences", "supports", "lumaCurve"):
        result[key] = np.asarray(result[key])
    for key in _OPTIONAL_ARRAY_KEYS:
        if key in result:
            result[key] = np.asarray(result[key])
    return result


def serialize(model):
    output = dict(model)
    for key in ("anchors", "deltas", "confidences", "supports", "lumaCurve"):
        output[key] = np.asarray(output[key]).tolist()
    for key in _OPTIONAL_ARRAY_KEYS:
        if key in output:
            output[key] = np.asarray(output[key]).tolist()
    return output


def deserialize(model):
    output = dict(model)
    output["anchors"] = np.asarray(output["anchors"], np.float32)
    output["deltas"] = np.asarray(output["deltas"], np.float32)
    output["confidences"] = np.asarray(output["confidences"], np.float32)
    output["supports"] = np.asarray(output["supports"], np.int32)
    output["lumaCurve"] = np.asarray(output["lumaCurve"], np.float32)
    for key in (
        "skinAnchors", "skinDeltas", "skinConfidences", "strengths", "skinStrengths",
        "materialAnchors", "materialDeltas", "materialConfidences", "materialTextures",
        "materialStrengths",
    ):
        if key in output:
            output[key] = np.asarray(output[key], np.float32)
    for key in ("skinSupports", "materialSupports"):
        if key in output:
            output[key] = np.asarray(output[key], np.int32)
    return output


def fit(before_rgb, after_rgb):
    started = time.time()
    before = _resize(before_rgb, WORK_MAX)
    after = _resize(after_rgb, WORK_MAX)
    after, geometry = compare.align(before, after)

    matched = _correspondence(before, after) if LEARN_ONLY_MATCHED else None
    base, base_error = _fit_base(before, after, matched)
    corrected = _tone(before, base)
    source_lab = _lab(corrected)
    target_lab = _lab(after)
    subject = _subject_mask(before)
    chroma = np.hypot(source_lab[..., 1] - 128.0, source_lab[..., 2] - 128.0)

    subject_base = None
    if SUBJECT_BASE_ENABLED and subject.max() > 0.5:
        subject_base, _ = _fit_base(before, after, matched, restrict=subject > 0.5)

    height, width = before.shape[:2]
    rim = max(4, round(min(height, width) * 0.03))
    valid = np.ones((height, width), bool)
    valid[:rim] = False
    valid[-rim:] = False
    valid[:, :rim] = False
    valid[:, -rim:] = False
    valid &= subject < 0.25
    valid &= chroma > 5.0
    if matched is not None and (valid & matched).sum() > valid.sum() * 0.15:
        valid &= matched

    # Skin is only worth its own fit when there is a subject at all -- this
    # also keeps callers/tests that stub out _subject_mask (no person in the
    # pair) from paying for a second segmentation model for nothing.
    skin = (
        _skin_mask(before)
        if SKIN_MODEL_ENABLED and subject.max() > 0.5
        else np.zeros((height, width), np.float32)
    )
    valid_skin = np.ones((height, width), bool)
    valid_skin[:rim] = False
    valid_skin[-rim:] = False
    valid_skin[:, :rim] = False
    valid_skin[:, -rim:] = False
    valid_skin &= skin > 0.5
    valid_skin &= chroma > 5.0
    if matched is not None and (valid_skin & matched).sum() > valid_skin.sum() * 0.15:
        valid_skin &= matched

    anchor_model, validation_positions, sample_count = _fit_anchors(
        source_lab,
        target_lab,
        valid,
    )
    selection = _choose_palette(
        source_lab,
        target_lab,
        validation_positions,
        anchor_model,
    )
    model = {
        "version": 1,
        "base": base,
        **anchor_model,
        "strength": selection["strength"],
        "strengths": selection["strengths"],
        "sigma": selection["sigma"],
        "subjectProtection": SUBJECT_PROTECTION,
    }
    if subject_base is not None:
        model["subjectBase"] = subject_base

    skin_sample_count = int(valid_skin.sum())
    if skin_sample_count >= MIN_SKIN_SAMPLES:
        skin_anchor_model, skin_validation_positions, _ = _fit_anchors(
            source_lab,
            target_lab,
            valid_skin,
        )
        skin_selection = _choose_palette(
            source_lab,
            target_lab,
            skin_validation_positions,
            skin_anchor_model,
        )
        model["skinAnchors"] = skin_anchor_model["anchors"]
        model["skinDeltas"] = skin_anchor_model["deltas"]
        model["skinConfidences"] = skin_anchor_model["confidences"]
        model["skinSupports"] = skin_anchor_model["supports"]
        if "slopes" in skin_anchor_model:
            model["skinSlopes"] = skin_anchor_model["slopes"]
        model["skinStrength"] = skin_selection["strength"]
        model["skinStrengths"] = skin_selection["strengths"]
        model["skinSigma"] = skin_selection["sigma"]
        model["skinProtection"] = SKIN_PROTECTION

    palette_rgb = _apply_model_samples(before, {
        **model,
        "lumaCurve": np.arange(256, dtype=np.float32),
        "lumaStrength": 0.0,
    })
    palette_lab = _lab(palette_rgb)

    if MATERIAL_MODEL_ENABLED:
        # A material anchor's delta is fit as a RESIDUAL against what the
        # general per-colour model (palette_lab) already produces here, not
        # against the raw base-corrected source. Materials are NOT excluded
        # from the general anchor fit the way skin is, so `full` already
        # carries a real, often-good per-colour correction in these regions
        # (see holdout numbers before this fix: vivid was already 80%+) --
        # fitting against raw source and later REPLACING that correction at
        # apply time regressed every dataset, the same "replace instead of
        # add on top of the safety net" bug class the skin blend once had.
        material_fields = _fit_material_anchors(
            before, palette_lab, target_lab, valid, selection["strength"],
        )
        if material_fields is not None:
            model.update(material_fields)

    luma_curve = _fit_luma_curve(palette_lab, target_lab, valid)
    model["lumaCurve"] = luma_curve

    baseline_look = _look_lab(before)
    target_look = _look_lab(after)
    subject_sel = subject > 0.5

    def weighted_error(rgb):
        delta = np.sqrt(((_look_lab(rgb) - target_look) ** 2).sum(2))
        if subject_sel.any() and (~subject_sel).any():
            return float(0.5 * delta[subject_sel].mean() + 0.5 * delta[~subject_sel].mean())
        return float(delta.mean())

    has_skin_model = "skinAnchors" in model
    has_material_model = "materialAnchors" in model

    luma_trials = []
    best_luma = None
    for strength in (0.35, 0.55, 0.75, 1.0, 1.2):
        trial_model = {**model, "lumaStrength": strength}
        # Preview/reference scoring uses the exact same blend as apply().
        full_img = _apply_model_samples(before, trial_model, mode="full")
        protected_img = _apply_model_samples(before, trial_model, mode="protected")
        skin_img = (
            _apply_model_samples(before, trial_model, mode="skin")
            if has_skin_model
            else None
        )
        material_img, material_conf = (
            _apply_material(full_img, before, trial_model, subject)
            if has_material_model
            else (None, None)
        )
        output = _blend_protected(
            full_img,
            protected_img,
            subject,
            SUBJECT_PROTECTION,
            skin if has_skin_model else None,
            skin_img,
            SKIN_PROTECTION,
            material_img,
            material_conf,
            MATERIAL_PROTECTION,
        )
        error = weighted_error(output)
        luma_trials.append({"strength": strength, "error": round(error, 4)})
        if best_luma is None or error < best_luma[0]:
            best_luma = (error, strength, output)
    model["lumaStrength"] = best_luma[1]
    preview = best_luma[2]

    baseline_error = weighted_error(before)
    report = {
        "fitSeconds": round(time.time() - started, 2),
        "fitSize": [int(width), int(height)],
        "geometry": geometry,
        "base": {key: round(float(value), 3) for key, value in base.items()},
        "baseSearchError": round(base_error, 4),
        "samples": int(sample_count),
        "validationSamples": int(len(validation_positions)),
        "clusters": int(len(model["anchors"])),
        "meanAnchorConfidence": round(float(model["confidences"].mean()), 4),
        "validationGapClosed": round(
            max(0.0, 1.0 - selection["error"] / max(selection["baseline"], 1e-6)),
            4,
        ),
        "lookBaseline": round(baseline_error, 4),
        "lookError": round(best_luma[0], 4),
        "gapClosed": round(max(0.0, 1.0 - best_luma[0] / max(baseline_error, 1e-6)), 4),
        "selectedStrength": model["strength"],
        "minStrength": round(float(model["strengths"].min()), 3),
        "maxStrength": round(float(model["strengths"].max()), 3),
        "selectedSigma": model["sigma"],
        "selectedLumaStrength": model["lumaStrength"],
        "lumaTrials": luma_trials,
        "subjectBaseModel": subject_base is not None,
        "skinModel": has_skin_model,
        "skinSamples": skin_sample_count,
        "meanSkinAnchorConfidence": (
            round(float(model["skinConfidences"].mean()), 4) if has_skin_model else None
        ),
        "materialModel": has_material_model,
        "materialAnchorCount": (
            int(len(model["materialAnchors"])) if has_material_model else 0
        ),
        "meanMaterialAnchorConfidence": (
            round(float(model["materialConfidences"].mean()), 4)
            if has_material_model
            else None
        ),
        "safe": bool(
            selection["error"] < selection["baseline"]
            and best_luma[0] < baseline_error
            and model["confidences"].mean() >= 0.12
        ),
    }
    return serialize(model), report, preview


def _model_key(model):
    serial = json.dumps(serialize(model), sort_keys=True, separators=(",", ":"))
    return hashlib.sha1(serial.encode("utf-8")).hexdigest()


def _processor_from_cube(cube):
    try:
        import PyOpenColorIO as ocio
    except ImportError:
        return None
    size = cube.shape[0]
    transform = ocio.Lut3DTransform(gridSize=size)
    transform.setInterpolation(ocio.INTERP_TETRAHEDRAL)
    values = cube.astype(np.float32) / 255.0
    for red in range(size):
        for green in range(size):
            for blue in range(size):
                value = values[red, green, blue]
                transform.setValue(
                    red,
                    green,
                    blue,
                    float(value[0]),
                    float(value[1]),
                    float(value[2]),
                )
    config = ocio.Config.CreateRaw()
    return config.getProcessor(transform).getDefaultCPUProcessor()


def _compile_processors(model, size=CUBE_SIZE):
    model = _model_arrays(model)
    key = (_model_key(model), int(size))
    cached = _CUBE_CACHE.get(key)
    if cached is not None:
        return cached

    levels = np.linspace(0, 255, size, dtype=np.float32)
    red, green, blue = np.meshgrid(levels, levels, levels, indexing="ij")
    grid = np.stack((red, green, blue), axis=-1).astype(np.uint8)
    full = _apply_model_samples(grid, model, mode="full")
    protected = _apply_model_samples(grid, model, mode="protected")
    compiled = [
        (_processor_from_cube(full), full),
        (_processor_from_cube(protected), protected),
    ]
    if "skinAnchors" in model:
        skin = _apply_model_samples(grid, model, mode="skin")
        compiled.append((_processor_from_cube(skin), skin))
    compiled = tuple(compiled)
    _CUBE_CACHE.clear()
    _CUBE_CACHE[key] = compiled
    return compiled


def _apply_cube(rgb, cube, tile_rows=256):
    size = cube.shape[0]
    height, width = rgb.shape[:2]
    output = np.empty_like(rgb)
    for y0 in range(0, height, tile_rows):
        y1 = min(height, y0 + tile_rows)
        values = rgb[y0:y1].astype(np.float32) / 255.0 * (size - 1)
        lower = np.floor(values).astype(np.int32)
        lower = np.clip(lower, 0, size - 2)
        fraction = values - lower
        upper = lower + 1

        result = np.zeros_like(values, np.float32)
        for dr in (0, 1):
            rr = upper[..., 0] if dr else lower[..., 0]
            wr = fraction[..., 0] if dr else 1.0 - fraction[..., 0]
            for dg in (0, 1):
                gg = upper[..., 1] if dg else lower[..., 1]
                wg = fraction[..., 1] if dg else 1.0 - fraction[..., 1]
                for db in (0, 1):
                    bb = upper[..., 2] if db else lower[..., 2]
                    wb = fraction[..., 2] if db else 1.0 - fraction[..., 2]
                    result += cube[rr, gg, bb].astype(np.float32) * (
                        wr * wg * wb
                    )[..., None]
        output[y0:y1] = np.clip(result + 0.5, 0, 255).astype(np.uint8)
    return output


def _apply_compiled(rgb, compiled, tile_rows=512):
    processor, cube = compiled
    if processor is None:
        return _apply_cube(rgb, cube, tile_rows=max(128, tile_rows // 2))
    height = rgb.shape[0]
    output = np.empty_like(rgb)
    for y0 in range(0, height, tile_rows):
        y1 = min(height, y0 + tile_rows)
        buffer = np.ascontiguousarray(
            rgb[y0:y1].astype(np.float32) / 255.0
        )
        processor.applyRGB(buffer)
        output[y0:y1] = np.clip(buffer * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return output


def _blend_protected(
    full, protected, subject, protection,
    skin=None, skin_out=None, skin_protection=0.0,
    material=None, material_confidence=None, material_protection=0.0,
):
    """The one blend the engine uses everywhere: background stays 'full'.

    First reproduce today's plain subject/background blend (full -> protected
    by subject*protection) -- that result is the floor. THEN, where a separate
    skin cube was learned, pull skin pixels further toward it by skin_protection.
    At skin_protection == 0 this must come out bit-identical to the two-way
    blend, since skin is still `subject`: the skin cube only ever ADDS
    correction on top of the existing safety net, it never removes it.

    Material works the same way, layered on top of whatever came before it:
    `material_confidence` is 0 wherever regions.py found nothing or nothing
    matched a fit-time material anchor closely enough, so at
    material_protection == 0 (or an all-zero confidence map) this is a no-op,
    same guarantee as skin_protection == 0.
    """
    if protection <= 0 and skin_out is None and material is None:
        return full

    output = full.astype(np.float32)
    if protection > 0:
        subject_amount = np.clip(subject * protection, 0.0, 1.0)[..., None]
        output = output * (1.0 - subject_amount) + protected.astype(np.float32) * subject_amount

    if skin_out is not None:
        skin_amount = np.clip(skin * skin_protection, 0.0, 1.0)[..., None]
        output = output * (1.0 - skin_amount) + skin_out.astype(np.float32) * skin_amount

    if material is not None:
        material_amount = np.clip(
            material_confidence * material_protection, 0.0, 1.0
        )[..., None]
        output = output * (1.0 - material_amount) + material.astype(np.float32) * material_amount

    return np.clip(output, 0, 255).astype(np.uint8)


def apply(rgb, model):
    started = time.time()
    model = deserialize(model)
    compiled = _compile_processors(model)
    has_skin = len(compiled) > 2
    has_material = "materialAnchors" in model
    full = _apply_compiled(rgb, compiled[0])
    protection = float(model.get("subjectProtection", SUBJECT_PROTECTION))
    skin_protection = float(model.get("skinProtection", SKIN_PROTECTION)) if has_skin else 0.0
    material_protection = (
        float(model.get("materialProtection", MATERIAL_PROTECTION)) if has_material else 0.0
    )

    if protection <= 0 and not has_skin and material_protection <= 0:
        output = full
    else:
        subject = _fast_subject_mask(rgb)
        protected = _apply_compiled(rgb, compiled[1])
        skin = _fast_skin_mask(rgb) if has_skin else None
        skin_out = _apply_compiled(rgb, compiled[2]) if has_skin else None
        if has_material and material_protection > 0:
            material_out, material_confidence = _apply_material(full, rgb, model, subject)
        else:
            material_out, material_confidence = None, None
        output = _blend_protected(
            full, protected, subject, protection,
            skin, skin_out, skin_protection,
            material_out, material_confidence, material_protection,
        )

    return output, {
        "ms": int((time.time() - started) * 1000),
        "cubeSize": CUBE_SIZE,
        "subjectProtection": protection,
        "skinProtection": skin_protection,
        "materialProtection": material_protection,
    }


def export(src_path, model, dest_dir, fmt="jpeg", quality=97):
    image = common.load_image(src_path)
    output, meta = apply(common.to_np(image), model)
    output_image = common.to_pil(output)

    os.makedirs(dest_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(src_path))[0]
    extension = {"png": "png", "tif": "tif", "tiff": "tif"}.get(fmt.lower(), "jpg")
    destination = os.path.join(dest_dir, f"{stem}.{extension}")
    if extension == "jpg":
        output_image.save(
            destination,
            format="JPEG",
            quality=int(quality),
            subsampling=0,
            optimize=True,
            progressive=True,
            icc_profile=image.info.get("icc_profile"),
        )
    elif extension == "png":
        output_image.save(destination, format="PNG", compress_level=6)
    else:
        output_image.save(destination, format="TIFF", compression="tiff_lzw")
    return destination, meta
