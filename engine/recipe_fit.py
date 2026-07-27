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
photographer actually produced.

The recipe is fitted in three SLOTS, not one:

    global      the whole frame
    background  everything the subject mask excludes
    subject     the person

because a real edit is not one grade. Measuring a real pair showed the fitted
`temperature` pinned at +100 and stuck there even after eight hue bands were
added: the field wanted cooling and the girl wanted warming, and one slider
cannot do both. Slots are what let the same tool appear twice with opposite
settings.

The number this produces is the point of the whole exercise:

    gapClosed = how much of the before->after distance the recipe covers
"""

import cv2
import numpy as np

import compare
import globals_py
import grade_zones
import hsl
import masks as masks_mod
import render as render_mod

# Small enough that a full render is milliseconds, large enough that tone,
# colour and vignette behave as they do at full size.
FIT_MAX = 640

# Same order as render.py: 30, 35, 40, 41, 42.
STAGES = (
    ("tone-color", globals_py.tone_color),
    ("dimension", globals_py.dimension),
    ("color-grade", globals_py.color_grade),
    ("hsl", hsl.apply),
    ("grade-zones", grade_zones.apply),
    ("glow", globals_py.glow),
    ("oil-paint", globals_py.oil_paint),
    ("sharpen", globals_py.sharpen),
)

# Feathered a little: a hard mask edge would put a visible line down the side
# of the subject wherever the two grades disagree.
SLOT_SPECS = {
    "global": None,
    "background": {"region": "background", "feather": 6},
    "subject": {"region": "subject", "feather": 6},
}
SLOT_ORDER = ("global", "background", "subject")

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

for _band in ("red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"):
    FITTABLE.append(("hsl", f"{_band}Sat", -100, 100))
    FITTABLE.append(("hsl", f"{_band}Lum", -100, 100))
    FITTABLE.append(("hsl", f"{_band}Hue", -100, 100))

for _zone in ("shadows", "midtones", "highlights"):
    FITTABLE.append(("grade-zones", f"{_zone}Hue", 0, 360))
    FITTABLE.append(("grade-zones", f"{_zone}Sat", -100, 100))
    FITTABLE.append(("grade-zones", f"{_zone}Lum", -100, 100))
FITTABLE.append(("grade-zones", "balance", -100, 100))

# Texture is fitted in its own pass, after colour. It is only seven knobs, and
# oil-paint in particular is far more expensive per render than a LUT, so
# putting it in the main sweep would multiply the whole search by its cost for
# no benefit — a smoothing amount does not interact much with a hue band.
TEXTURE_FITTABLE = [
    ("dimension", "clarity", -100, 100),
    ("glow", "amount", 0, 100),
    ("glow", "radius", 0, 100),
    ("oil-paint", "amount", 0, 100),
    ("oil-paint", "radius", 0, 100),
    ("sharpen", "amount", 0, 100),
    ("sharpen", "radius", 0, 100),
]

TOOL_NAMES = tuple(
    dict.fromkeys([t for t, *_ in FITTABLE] + [t for t, *_ in TEXTURE_FITTABLE])
)


def _lab(rgb):
    return cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(
        np.float32
    )


def _delta_e(a_lab, b_lab):
    return float(np.sqrt(((a_lab - b_lab) ** 2).sum(axis=2)).mean())


# ---------------------------------------------------------------- objective
#
# Pixel-for-pixel dE is the wrong yardstick here, and the error map proved it:
# after the colour work landed, the surviving error was a bright outline on
# every grass stem and poppy edge. That is not a look difference, it is the 3%
# crop leaving a sub-pixel offset that dense foliage turns into a huge dE.
# Optimising it further would have been chasing registration noise.
#
# So the objective is split into two terms, and BOTH are made insensitive to
# a pixel of misalignment:
#
#   look     dE on a mildly blurred pair — colour, tone and contrast survive
#            the blur; a one-pixel shift does not.
#   texture  the difference in how much fine detail each frame CARRIES, as a
#            smoothed energy map. It compares quantity of texture rather than
#            texture pixel-by-pixel, so it can score a global smoothing pass
#            without the two frames having to line up at all.

LOOK_SIGMA = 2.0
TEXTURE_W = 1.6

# Regions whose colour identity the recipe is not allowed to invent. Measured
# on the reference pair: face-skin came back at chroma x1.17 and body-skin at
# x1.30 while the greens collapsed to x0.24 — the retoucher PROTECTED the
# child's colour and destroyed the field's. The unconstrained fit did the
# opposite to her, because she is 17.7% of the pixels and mean dE is a vote by
# area. These selectors get a measured target and a hard penalty for missing it.
PROTECTED = ("face-skin", "body-skin", "hair")

CHROMA_TOL = 0.08   # ratio
LUM_TOL = 4.0       # L units
CHROMA_PENALTY = 45.0
LUM_PENALTY = 0.9


def _look_lab(rgb):
    return cv2.GaussianBlur(_lab(rgb), (0, 0), LOOK_SIGMA)


def _chroma(lab):
    return np.hypot(lab[..., 1] - 128.0, lab[..., 2] - 128.0)


def _region_stats(lab, m):
    return float(_chroma(lab)[m].mean()), float(lab[..., 0][m].mean())


def _weight_map(sel, shape):
    """Give each region an equal say instead of one vote per pixel.

    The subject is 17.7% of this frame and 100% of the photograph. Weighting by
    area let the field outvote her five to one, which is precisely how the fit
    ended up draining her colour to make the grass fit better.
    """
    w = np.ones(shape, np.float32)
    subj = sel.get("subject")
    if subj is None or not subj.any() or subj.all():
        return w
    f = float(subj.mean())
    w[subj] = 0.5 / f
    w[~subj] = 0.5 / (1.0 - f)
    return w / w.mean()


def _energy(rgb):
    """How much fine detail lives at each place, smoothed so it can be compared
    between frames that are not perfectly registered."""
    g = cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    g = g.astype(np.float32)
    hf = np.abs(g - cv2.GaussianBlur(g, (0, 0), 1.5))
    return cv2.GaussianBlur(hf, (0, 0), 8.0)


def _protect_penalty(lab, ctx):
    """How far the candidate drifts from the colour each protected region is
    measured to have kept. Zero inside tolerance, and expensive outside it."""
    total = 0.0
    for name, (r_t, dl_t, c_b, l_b) in ctx["targets"].items():
        m = ctx["sel"][name]
        c_f, l_f = _region_stats(lab, m)
        r_f = c_f / max(c_b, 1e-6)
        total += max(0.0, abs(r_f - r_t) - CHROMA_TOL) * CHROMA_PENALTY
        total += max(0.0, abs((l_f - l_b) - dl_t) - LUM_TOL) * LUM_PENALTY
    return total


def _score(rgb, ctx):
    lab = _lab(rgb)
    d = np.sqrt(((cv2.GaussianBlur(lab, (0, 0), LOOK_SIGMA) - ctx["look"]) ** 2).sum(axis=2))
    look = float((d * ctx["w"]).mean())
    tex = float(np.abs(_energy(rgb) - ctx["energy"]).mean())
    pen = _protect_penalty(lab, ctx)
    return look + TEXTURE_W * tex + pen, look, tex


def _empty():
    return {slot: {tool: {} for tool in TOOL_NAMES} for slot in SLOT_ORDER}


def _render(rgb, params, slot_masks):
    """Apply each slot's chain, blending it through that slot's mask."""
    x = rgb
    for slot in SLOT_ORDER:
        chain = params.get(slot) or {}
        if not any(v for v in chain.values()):
            continue
        y = x
        for tool, fn in STAGES:
            tp = chain.get(tool)
            if tp:
                y, _ = fn(y, tp)
        m = slot_masks.get(slot)
        if m is None:
            x = y
        else:
            x = np.clip(
                x.astype(np.float32) * (1.0 - m) + y.astype(np.float32) * m, 0, 255
            ).astype(np.uint8)
    return x


def _fit_scale(rgb):
    h, w = rgb.shape[:2]
    s = FIT_MAX / max(h, w)
    if s >= 1.0:
        return rgb
    return cv2.resize(rgb, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)


def _slot_masks(before):
    """Computed once — they depend only on the before frame, and the search
    renders it a few thousand times."""
    out = {"global": None}
    masks_mod.set_source(before)
    try:
        for slot in ("background", "subject"):
            out[slot] = render_mod._region_mask(before, SLOT_SPECS[slot])[..., None]
    finally:
        masks_mod.clear_source()
    return out


def _seed(before, after):
    """Start near the answer, from the closed-form measurements."""
    lum = np.array([0.2126, 0.7152, 0.0722])
    yb = float(np.median(compare._srgb_to_linear(before.reshape(-1, 3)[::17]) @ lum))
    ya = float(np.median(compare._srgb_to_linear(after.reshape(-1, 3)[::17]) @ lum))
    stops = float(np.log2(max(ya, 1e-9) / max(yb, 1e-9)))

    bl, al = _lab(before), _lab(after)
    cb = float(np.median(np.hypot(bl[..., 1] - 128, bl[..., 2] - 128)))
    ca = float(np.median(np.hypot(al[..., 1] - 128, al[..., 2] - 128)))
    ratio = ca / max(cb, 1e-6)

    p = _empty()
    # globals_py: base_gain = 2 ** (exposure/100 * 2)  ->  exposure = stops * 50
    # globals_py: k = 1 + saturation/100               ->  sat = (ratio-1) * 100
    p["global"]["tone-color"] = {
        "exposure": float(np.clip(stops * 50.0, -100, 100)),
        "saturation": float(np.clip((ratio - 1.0) * 100.0, -100, 100)),
    }
    return p


def fit(before_rgb, after_rgb, sweeps=3):
    """-> (params, report, fitted). Both frames RGB uint8, any size."""
    before = _fit_scale(before_rgb)
    after = _fit_scale(after_rgb)
    after, geom = compare.align(before, after)

    # Selectors, the targets each protected region is measured to hold, and a
    # weight map that gives subject and background an equal vote.
    sel = {}
    masks_mod.set_source(before)
    try:
        for name in ("subject",) + PROTECTED:
            try:
                m = masks_mod.get_mask(before, name) > 0.5
                if m.sum() >= 300:
                    sel[name] = m
            except Exception:
                pass
    finally:
        masks_mod.clear_source()

    lab_b, lab_a = _lab(before), _lab(after)
    targets = {}
    for name in PROTECTED:
        if name not in sel:
            continue
        c_b, l_b = _region_stats(lab_b, sel[name])
        c_a, l_a = _region_stats(lab_a, sel[name])
        targets[name] = (c_a / max(c_b, 1e-6), l_a - l_b, c_b, l_b)

    ctx = {
        "look": _look_lab(after),
        "energy": _energy(after),
        "sel": sel,
        "targets": targets,
        "w": _weight_map(sel, before.shape[:2]),
    }
    slot_masks = _slot_masks(before)

    base_total, base_look, base_tex = _score(before, ctx)

    params = _seed(before, after)
    best, _, _ = _score(_render(before, params, slot_masks), ctx)
    trace = {}

    def sweep_over(knobs, slot, rounds):
        nonlocal best, params
        for sweep in range(rounds):
            frac = 0.5 / (sweep + 1)
            improved = False
            for tool, key, lo, hi in knobs:
                cur = float(params[slot][tool].get(key, 0.0))
                span = (hi - lo) * frac
                for d in (-span, -span / 2, -span / 5, span / 5, span / 2, span):
                    cand = float(np.clip(cur + d, lo, hi))
                    if abs(cand - cur) < 0.5:
                        continue
                    trial = {s: {t: dict(v) for t, v in c.items()}
                             for s, c in params.items()}
                    trial[slot][tool][key] = cand
                    score, _, _ = _score(_render(before, trial, slot_masks), ctx)
                    if score < best - 1e-4:
                        best, params, cur = score, trial, cand
                        improved = True
            if not improved:
                break

    # Colour first, slot by slot: settle the whole-frame grade, then let each
    # region correct what the global pass could not satisfy for it.
    for slot in SLOT_ORDER:
        sweep_over(FITTABLE, slot, sweeps)
        trace[slot] = round(max(0.0, 1.0 - best / max(base_total, 1e-6)), 4)

    # Then texture, globally. Held back until the grade is settled because
    # smoothing changes what the colour tools have to work with, not the
    # other way round.
    sweep_over(TEXTURE_FITTABLE, "global", sweeps)
    trace["texture"] = round(max(0.0, 1.0 - best / max(base_total, 1e-6)), 4)

    fitted = _render(before, params, slot_masks)
    fit_total, fit_look, fit_tex = _score(fitted, ctx)

    # Did the protected regions actually land where the reference put them?
    lab_f = _lab(fitted)
    protect = {}
    for name, (r_t, dl_t, c_b, l_b) in ctx["targets"].items():
        c_f, l_f = _region_stats(lab_f, ctx["sel"][name])
        protect[name] = {
            "chromaTarget": round(r_t, 3),
            "chromaGot": round(c_f / max(c_b, 1e-6), 3),
            "lumTarget": round(dl_t, 1),
            "lumGot": round(l_f - l_b, 1),
            "ok": bool(abs(c_f / max(c_b, 1e-6) - r_t) <= CHROMA_TOL * 1.5
                       and abs((l_f - l_b) - dl_t) <= LUM_TOL * 1.5),
        }

    report = {
        # The headline: how much of the LOOK the recipe reproduces, measured
        # where a pixel of misregistration cannot reach it.
        "gapClosed": round(max(0.0, 1.0 - fit_look / max(base_look, 1e-6)), 4),
        "lookDeltaE": round(fit_look, 3),
        "lookBaseline": round(base_look, 3),
        "textureGapClosed": round(max(0.0, 1.0 - fit_tex / max(base_tex, 1e-6)), 4),
        "textureError": round(fit_tex, 3),
        "textureBaseline": round(base_tex, 3),
        "combinedScore": round(fit_total, 3),
        "gapClosedByStage": trace,
        "protected": protect,
        "subjectWeight": round(float(ctx["w"][ctx["sel"]["subject"]].mean())
                               if "subject" in ctx["sel"] else 1.0, 2),
        # kept for continuity with earlier runs — raw, alignment-sensitive
        "rawDeltaE": round(_delta_e(_lab(fitted), _lab(after)), 3),
        "rawBaseline": round(_delta_e(_lab(before), _lab(after)), 3),
        "geometry": geom,
        "fitSize": [int(before.shape[1]), int(before.shape[0])],
    }
    return params, report, fitted


def to_recipe(params):
    """The engine's own recipe format, ready for /render or batch export."""
    out = []
    for slot in SLOT_ORDER:
        spec = SLOT_SPECS[slot]
        for tool, vals in (params.get(slot) or {}).items():
            live = {k: round(v, 1) for k, v in vals.items() if abs(v) > 0.5}
            if not live:
                continue
            entry = {"toolId": tool, "params": live, "enabled": True}
            if spec:
                entry["mask"] = dict(spec)
            out.append(entry)
    return out
