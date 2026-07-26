"""Turn a before/after pair into a recipe this engine can actually run.

compare.py describes an edit. That is not the same as being able to reproduce
it: "saturationRatio 0.22" is a measurement, and what the pipeline needs is
`tone-color.saturation = -78`. Deriving one from the other by hand means
inverting each formula in globals_py by algebra, and the formulas interact —
contrast changes what saturation does, the highlight shoulder changes what
exposure does. Hand-derived numbers would be wrong in ways nobody could see.

So the parameters are FITTED instead: render the before frame with a candidate
recipe, measure how far the result lands from the target, and search. That
optimises the only thing that matters — the distance to the picture the
photographer actually produced — and every interaction is handled for free
because the real pipeline is what gets evaluated.

The number this produces is the point of the whole exercise:

    gapClosed = how much of the before->after distance the recipe covers

With it, "does this recipe reproduce the look" stops being an argument and
becomes a measurement, and the residual says what to build next.
"""

import cv2
import numpy as np

import compare
import globals_py
import grade_zones
import hsl

# Small enough that a full render is a few milliseconds, large enough that
# tone, colour and vignette all behave as they do at full size.
FIT_MAX = 640

# Pipeline order matters and is the same as render.py: 30, 35, 40.
STAGES = (
    ("tone-color", globals_py.tone_color),
    ("dimension", globals_py.dimension),
    ("color-grade", globals_py.color_grade),
    ("hsl", hsl.apply),
    ("grade-zones", grade_zones.apply),
)

# (tool, param, lo, hi) — every global knob that describes a LOOK. Deliberately
# excludes light-point (a placed object, not a grade), glow/oil-paint/sharpen
# (texture, which is the next problem, not this one).
FITTABLE = [
    ("tone-color", "exposure", -100, 100),
    ("tone-color", "contrast", -100, 100),
    ("tone-color", "temperature", -100, 100),
    ("tone-color", "tint", -100, 100),
    ("tone-color", "saturation", -100, 100),
    ("tone-color", "vibrance", -100, 100),
    ("tone-color", "highlights", -100, 100),
    ("tone-color", "shadows", -100, 100),
    ("tone-color", "whites", -100, 100),
    ("tone-color", "blacks", -100, 100),
    ("color-grade", "shadowsWarm", -100, 100),
    ("color-grade", "highlightsWarm", -100, 100),
    ("color-grade", "fade", 0, 100),
    ("dimension", "clarity", -100, 100),
    ("dimension", "vignette", 0, 100),
]

# Per-hue and per-zone colour. These are what let the fit desaturate grass
# without dragging skin and hair down with it.
for _band in ("red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"):
    FITTABLE.append(("hsl", f"{_band}Sat", -100, 100))
    FITTABLE.append(("hsl", f"{_band}Lum", -100, 100))
    FITTABLE.append(("hsl", f"{_band}Hue", -100, 100))

for _zone in ("shadows", "midtones", "highlights"):
    FITTABLE.append(("grade-zones", f"{_zone}Hue", 0, 360))
    FITTABLE.append(("grade-zones", f"{_zone}Sat", -100, 100))
    FITTABLE.append(("grade-zones", f"{_zone}Lum", -100, 100))
FITTABLE.append(("grade-zones", "balance", -100, 100))


def _lab(rgb):
    return cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(
        np.float32
    )


def _delta_e(a_lab, b_lab):
    return float(np.sqrt(((a_lab - b_lab) ** 2).sum(axis=2)).mean())


def _render(rgb, params):
    x = rgb
    for tool, fn in STAGES:
        p = params.get(tool)
        if p:
            x, _ = fn(x, p)
    return x


def _fit_scale(rgb):
    h, w = rgb.shape[:2]
    s = FIT_MAX / max(h, w)
    if s >= 1.0:
        return rgb
    return cv2.resize(rgb, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)


def _seed(before, after):
    """Start the search near the answer, from the closed-form measurements.

    Coordinate descent on 15 interacting parameters can settle into a local
    minimum; starting at the measured exposure and saturation keeps it out of
    the obviously wrong basins.
    """
    lum = np.array([0.2126, 0.7152, 0.0722])
    yb = float(np.median(compare._srgb_to_linear(before.reshape(-1, 3)[::17]) @ lum))
    ya = float(np.median(compare._srgb_to_linear(after.reshape(-1, 3)[::17]) @ lum))
    stops = float(np.log2(max(ya, 1e-9) / max(yb, 1e-9)))

    bl, al = _lab(before), _lab(after)
    cb = float(np.median(np.hypot(bl[..., 1] - 128, bl[..., 2] - 128)))
    ca = float(np.median(np.hypot(al[..., 1] - 128, al[..., 2] - 128)))
    ratio = ca / max(cb, 1e-6)

    # globals_py: base_gain = 2 ** (exposure/100 * 2)  ->  exposure = stops * 50
    # globals_py: k = 1 + saturation/100               ->  sat = (ratio-1) * 100
    return {
        "hsl": {},
        "grade-zones": {},
        "tone-color": {
            "exposure": float(np.clip(stops * 50.0, -100, 100)),
            "saturation": float(np.clip((ratio - 1.0) * 100.0, -100, 100)),
        },
        "dimension": {},
        "color-grade": {},
    }


def fit(before_rgb, after_rgb, sweeps=4):
    """-> (recipe params, report). Both frames RGB uint8, any size."""
    before = _fit_scale(before_rgb)
    after = _fit_scale(after_rgb)
    after, geom = compare.align(before, after)

    target = _lab(after)
    baseline = _delta_e(_lab(before), target)

    params = _seed(before, after)
    best = _delta_e(_lab(_render(before, params)), target)

    for sweep in range(sweeps):
        # shrink the step each sweep: find the neighbourhood, then refine in it
        frac = 0.5 / (sweep + 1)
        improved = False
        for tool, key, lo, hi in FITTABLE:
            cur = float(params[tool].get(key, 0.0))
            span = (hi - lo) * frac
            for d in (-span, -span / 2, -span / 5, span / 5, span / 2, span):
                cand = float(np.clip(cur + d, lo, hi))
                if abs(cand - cur) < 0.5:
                    continue
                trial = {t: dict(v) for t, v in params.items()}
                trial[tool][key] = cand
                score = _delta_e(_lab(_render(before, trial)), target)
                if score < best - 1e-4:
                    best, params, cur = score, trial, cand
                    improved = True
        if not improved:
            break

    fitted = _render(before, params)

    # Split what is LEFT into colour and texture. A grade cannot fix a texture
    # difference, so this says whether the remaining gap is worth more colour
    # work or needs a different kind of tool entirely.
    fl, tl = _lab(fitted), target
    lo_f = cv2.GaussianBlur(fl, (0, 0), 8)
    lo_t = cv2.GaussianBlur(tl, (0, 0), 8)
    colour_resid = _delta_e(lo_f, lo_t)
    texture_resid = _delta_e(fl - lo_f, tl - lo_t)

    report = {
        "baselineDeltaE": round(baseline, 3),
        "fittedDeltaE": round(best, 3),
        "gapClosed": round(max(0.0, 1.0 - best / max(baseline, 1e-6)), 4),
        "colourResidual": round(colour_resid, 3),
        "textureResidual": round(texture_resid, 3),
        "geometry": geom,
        "fitSize": [int(before.shape[1]), int(before.shape[0])],
    }
    return params, report, fitted


def to_recipe(params):
    """The engine's own recipe format, ready for /render or batch export."""
    return [
        {"toolId": tool, "params": {k: round(v, 1) for k, v in vals.items()}, "enabled": True}
        for tool, vals in params.items()
        if vals and any(abs(v) > 0.5 for v in vals.values())
    ]
