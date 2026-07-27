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


WORK_MAX = 900
BASE_MAX = 480
CLUSTERS = 24
MAX_SAMPLES = 150_000
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
            (lab[..., 0] - 128.0) * 0.28,
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


def _fit_base(before, after, matched=None):
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
    for index in range(cluster_count):
        selected = labels == index
        values = delta[train_positions][selected]
        median = np.median(values, axis=0)
        spread = float(np.median(np.linalg.norm(values - median, axis=1)))
        support = int(selected.sum())
        confidence = float(np.clip(1.0 - spread / 28.0, 0.08, 1.0))
        confidence *= float(np.clip(support / 2200.0, 0.2, 1.0))
        deltas.append(median)
        confidences.append(confidence)
        supports.append(support)

    model = {
        "anchors": centers.astype(np.float32),
        "deltas": _cap_vectors(
            np.asarray(deltas, np.float32),
            MAX_ANCHOR_DELTA,
        ),
        "confidences": np.asarray(confidences, np.float32),
        "supports": np.asarray(supports, np.int32),
    }
    return model, validation_positions, len(positions)


def _palette_delta(lab_values, model, strength, sigma):
    values = _features(lab_values.reshape(-1, 1, 3)).reshape(-1, 3)
    anchors = model["anchors"]
    distance2 = ((values[:, None, :] - anchors[None, :, :]) ** 2).sum(axis=2)
    nearest = np.sqrt(distance2.min(axis=1))
    weights = np.exp(-distance2 / (2.0 * sigma * sigma))
    weights *= model["confidences"][None, :]
    delta = weights @ model["deltas"] / np.maximum(weights.sum(1, keepdims=True), 1e-6)

    chroma = np.hypot(lab_values[:, 1] - 128.0, lab_values[:, 2] - 128.0)
    chroma_gate = np.clip((chroma - 5.0) / 13.0, 0.0, 1.0)
    familiarity = np.clip(1.0 - nearest / 34.0, 0.0, 1.0)
    return delta * (chroma_gate * familiarity * float(strength))[:, None]


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

    trials = []
    best = None
    for sigma in (6.0, 8.0, 11.0, 15.0, 19.0):
        for strength in (0.65, 0.9, 1.2, 1.5, 1.8, 2.15, 2.5):
            output = source_values + _palette_delta(
                source_values,
                model,
                strength,
                sigma,
            )
            output = np.clip(output, 0, 255)
            error = float(np.linalg.norm(output - target_values, axis=1).mean())
            chroma95 = float(
                np.percentile(
                    np.hypot(output[:, 1] - 128.0, output[:, 2] - 128.0),
                    95,
                )
            )
            safe = chroma95 <= target_chroma95 + 5.0
            trials.append(
                {
                    "sigma": sigma,
                    "strength": strength,
                    "error": round(error, 4),
                    "chroma95": round(chroma95, 3),
                    "safe": bool(safe),
                }
            )
            if safe and (best is None or error < best[0]):
                best = (error, strength, sigma)

    if best is None:
        chosen = min(trials, key=lambda trial: (trial["chroma95"], trial["error"]))
        best = (chosen["error"], chosen["strength"], chosen["sigma"])
    return {
        "error": float(best[0]),
        "strength": float(best[1]),
        "sigma": float(best[2]),
        "baseline": baseline,
        "trials": trials,
    }


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


def _apply_model_samples(rgb_values, model, mode="full"):
    """mode: 'full' (background+general anchors), 'protected' (base only), or
    'skin' (the separate anchor set learned from face/body skin pixels, if any)."""
    shape = rgb_values.shape
    rgb = rgb_values.reshape(-1, 1, 3).astype(np.uint8)
    corrected = _tone(rgb, model["base"])
    lab = _lab(corrected).reshape(-1, 3)
    if mode == "full":
        lab += _palette_delta(
            lab,
            model,
            model["strength"],
            model["sigma"],
        )
    elif mode == "skin":
        skin_model = {
            "anchors": model["skinAnchors"],
            "deltas": model["skinDeltas"],
            "confidences": model["skinConfidences"],
        }
        lab += _palette_delta(
            lab,
            skin_model,
            model["skinStrength"],
            model["skinSigma"],
        )
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
_SKIN_ARRAY_KEYS = ("skinAnchors", "skinDeltas", "skinConfidences", "skinSupports")


def _model_arrays(model):
    result = dict(model)
    for key in ("anchors", "deltas", "confidences", "supports", "lumaCurve"):
        result[key] = np.asarray(result[key])
    for key in _SKIN_ARRAY_KEYS:
        if key in result:
            result[key] = np.asarray(result[key])
    return result


def serialize(model):
    output = dict(model)
    for key in ("anchors", "deltas", "confidences", "supports", "lumaCurve"):
        output[key] = np.asarray(output[key]).tolist()
    for key in _SKIN_ARRAY_KEYS:
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
    for key in ("skinAnchors", "skinDeltas", "skinConfidences"):
        if key in output:
            output[key] = np.asarray(output[key], np.float32)
    if "skinSupports" in output:
        output["skinSupports"] = np.asarray(output["skinSupports"], np.int32)
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
        "sigma": selection["sigma"],
        "subjectProtection": SUBJECT_PROTECTION,
    }

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
        model["skinStrength"] = skin_selection["strength"]
        model["skinSigma"] = skin_selection["sigma"]
        model["skinProtection"] = SKIN_PROTECTION

    palette_rgb = _apply_model_samples(before, {
        **model,
        "lumaCurve": np.arange(256, dtype=np.float32),
        "lumaStrength": 0.0,
    })
    palette_lab = _lab(palette_rgb)
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
        output = _blend_protected(
            full_img,
            protected_img,
            subject,
            SUBJECT_PROTECTION,
            skin if has_skin_model else None,
            skin_img,
            SKIN_PROTECTION,
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
        "selectedSigma": model["sigma"],
        "selectedLumaStrength": model["lumaStrength"],
        "lumaTrials": luma_trials,
        "skinModel": has_skin_model,
        "skinSamples": skin_sample_count,
        "meanSkinAnchorConfidence": (
            round(float(model["skinConfidences"].mean()), 4) if has_skin_model else None
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


def _blend_protected(full, protected, subject, protection, skin=None, skin_out=None, skin_protection=0.0):
    """The one blend the engine uses everywhere: background stays 'full'.

    Where a separate skin cube was learned (skin/skin_out not None), skin
    pixels blend toward IT at skin_protection instead of toward the generic
    base-only 'protected' cube -- the skin cube carries real evidence about
    how this pair's skin was graded, so it needs less hiding. Whatever of the
    subject mask skin doesn't already cover (hair, clothes, ...) still falls
    back to 'protected' at the usual protection amount.
    """
    if protection <= 0 and skin_out is None:
        return full

    output = full.astype(np.float32)
    remaining = np.ones(subject.shape, np.float32)

    if skin_out is not None:
        skin_amount = np.clip(skin * skin_protection, 0.0, 1.0)[..., None]
        output = output * (1.0 - skin_amount) + skin_out.astype(np.float32) * skin_amount
        remaining = np.clip(1.0 - skin, 0.0, 1.0)

    if protection > 0:
        subject_amount = np.clip(subject * remaining * protection, 0.0, 1.0)[..., None]
        output = output * (1.0 - subject_amount) + protected.astype(np.float32) * subject_amount

    return np.clip(output, 0, 255).astype(np.uint8)


def apply(rgb, model):
    started = time.time()
    model = deserialize(model)
    compiled = _compile_processors(model)
    has_skin = len(compiled) > 2
    full = _apply_compiled(rgb, compiled[0])
    protection = float(model.get("subjectProtection", SUBJECT_PROTECTION))
    skin_protection = float(model.get("skinProtection", SKIN_PROTECTION)) if has_skin else 0.0

    if protection <= 0 and not has_skin:
        output = full
    else:
        subject = _fast_subject_mask(rgb)
        protected = _apply_compiled(rgb, compiled[1])
        skin = _fast_skin_mask(rgb) if has_skin else None
        skin_out = _apply_compiled(rgb, compiled[2]) if has_skin else None
        output = _blend_protected(full, protected, subject, protection, skin, skin_out, skin_protection)

    return output, {
        "ms": int((time.time() - started) * 1000),
        "cubeSize": CUBE_SIZE,
        "subjectProtection": protection,
        "skinProtection": skin_protection,
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
