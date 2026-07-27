"""Derive a recipe from a pair by MEASURING it, not by searching for it.

The search this replaces had ~150 free parameters and one image to satisfy, so
it did what such a search always does: it found a combination that lowered the
number and meant nothing. The recipe it produced contained `purpleHue -100`,
`greenHue +100`, `magentaHue -80` — values with no relationship to what the
retoucher did, which would do something arbitrary to the next photograph. Every
tool added along the way made it worse, because each one handed the search more
freedom to fit one frame.

So nothing is searched here. Each number is measured, and where a parameter's
units are not the units of the measurement, it is CALIBRATED: render the frame
with the knob at a probe value, see how far the statistic moved, and scale to
the target. A handful of renders instead of thousands.

Three stages, each explaining only what the previous one could not, so nothing
is counted twice:

    1. global tone and colour     exposure, contrast, warmth, tint, saturation
    2. per-hue residual           what one global saturation could not say
    3. per-region residual        what no colour rule could say

Two rules that exist because of specific damage:

  * HUE ROTATION IS OFF unless the measurement demands it. It is the only
    parameter that changes what an object IS — it turned red poppies magenta —
    and a style almost never calls for it.
  * Every value is clamped to a sane band. A recipe that needs +100 of anything
    is a recipe that has stopped describing the photograph.
"""

import cv2
import numpy as np

import compare
import globals_py
import grade_zones  # noqa: F401  (registered for callers)
import hsl
import masks as masks_mod

WORK_MAX = 1400

BANDS = [name for name, _ in hsl.BANDS]

# A band has to own enough of the frame before its numbers mean anything.
MIN_BAND_PX = 0.004
CHROMA_GATE = 0.18


def _lab(rgb):
    return cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(
        np.float32
    )


def _chroma(lab):
    return np.hypot(lab[..., 1] - 128.0, lab[..., 2] - 128.0)


def _stats(rgb, m=None):
    lab = _lab(rgb)
    if m is None:
        m = np.ones(rgb.shape[:2], bool)
    return {
        "L": float(np.median(lab[..., 0][m])),
        "a": float(np.median(lab[..., 1][m])) - 128.0,
        "b": float(np.median(lab[..., 2][m])) - 128.0,
        "chroma": float(np.median(_chroma(lab)[m])),
        "contrast": float(lab[..., 0][m].std()),
    }


def _fit(rgb):
    h, w = rgb.shape[:2]
    s = WORK_MAX / max(h, w)
    if s >= 1.0:
        return rgb
    return cv2.resize(rgb, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)


def _calibrate(render, key, params, stat, target, lo, hi, probe=40.0):
    """Find the value of `params[key]` that lands `stat` on `target`.

    One probe render tells us the parameter's slope on this image; the answer
    is then read off that line and verified once. Two renders, not a search,
    and if the second render says the line was wrong it is corrected.
    """
    base = float(stat(render(params)))
    if abs(base - target) < 1e-6:
        return params
    trial = dict(params)
    trial[key] = float(np.clip(probe, lo, hi))
    moved = float(stat(render(trial))) - base
    if abs(moved) < 1e-6:
        return params  # this knob does nothing to this statistic here
    want = (target - base) / moved * trial[key]
    out = dict(params)
    out[key] = float(np.clip(want, lo, hi))

    got = float(stat(render(out)))
    if abs(got - target) > abs(base - target):
        return params  # the linear read made it worse; leave the knob alone
    # one refinement, since the response is not perfectly linear
    if abs(got - target) > 1e-6 and abs(got - base) > 1e-6:
        better = out[key] * (target - base) / (got - base)
        cand = dict(out)
        cand[key] = float(np.clip(better, lo, hi))
        if abs(float(stat(render(cand))) - target) < abs(got - target):
            return cand
    return out


def derive(before_rgb, after_rgb):
    before = _fit(before_rgb)
    after, geom = compare.align(before, _fit(after_rgb))

    tgt = _stats(after)
    src = _stats(before)
    notes = []

    # ---- stage 1: the global grade -------------------------------------
    g = {}

    def render_g(p):
        out, _ = globals_py.tone_color(before, p)
        return out

    for key, stat, target, lo, hi in (
        ("exposure", lambda i: _stats(i)["L"], tgt["L"], -100, 100),
        ("saturation", lambda i: _stats(i)["chroma"], tgt["chroma"], -100, 100),
        ("temperature", lambda i: _stats(i)["b"], tgt["b"], -100, 100),
        ("tint", lambda i: _stats(i)["a"], tgt["a"], -100, 100),
        ("contrast", lambda i: _stats(i)["contrast"], tgt["contrast"], -100, 100),
    ):
        g = _calibrate(render_g, key, g, stat, target, lo, hi)

    stage1 = render_g(g)
    notes.append(
        f"global: exposure {g.get('exposure',0):+.0f}, contrast {g.get('contrast',0):+.0f}, "
        f"warmth {g.get('temperature',0):+.0f}, tint {g.get('tint',0):+.0f}, "
        f"saturation {g.get('saturation',0):+.0f}"
    )

    # ---- stage 2: what one saturation slider could not say --------------
    hsv = cv2.cvtColor(before, cv2.COLOR_RGB2HSV_FULL)
    hue = hsv[..., 0].astype(np.float32) * (360.0 / 255.0)
    chromatic = (hsv[..., 1].astype(np.float32) / 255.0) > CHROMA_GATE

    band_masks = {}
    w = hsl._weights(hue)
    for i, name in enumerate(BANDS):
        m = (w[i] > 0.5) & chromatic
        if m.mean() >= MIN_BAND_PX:
            band_masks[name] = m

    hp = {}
    lab1, laba = _lab(stage1), _lab(after)
    for name, m in band_masks.items():
        c1 = float(np.median(_chroma(lab1)[m]))
        ca = float(np.median(_chroma(laba)[m]))
        if c1 > 1.0:
            ratio = ca / c1
            val = float(np.clip((ratio - 1.0) * 100.0, -95, 95))
            if abs(val) >= 4:
                hp[f"{name}Sat"] = round(val, 1)
        dl = float(np.median(laba[..., 0][m]) - np.median(lab1[..., 0][m]))
        val = float(np.clip(dl / 0.35 / 255.0 * 100.0 * 3.0, -80, 80))
        if abs(val) >= 4:
            hp[f"{name}Lum"] = round(val, 1)
        # Hue rotation stays out. It is what turned the poppies magenta, and a
        # grade almost never rotates an object's identity colour.

    stage2 = stage1
    if hp:
        stage2, _ = hsl.apply(stage1, hp)
        live = sorted((k for k in hp if k.endswith("Sat")),
                      key=lambda k: hp[k])[:3]
        notes.append("per-hue: " + ", ".join(f"{k[:-3]} {hp[k]:+.0f}" for k in live))

    # ---- stage 3: what no colour rule could say -------------------------
    masks_mod.set_source(before)
    try:
        subj = masks_mod.get_mask(before, "subject") > 0.5
    except Exception:
        subj = None
    finally:
        masks_mod.clear_source()

    sp = {}
    if subj is not None and 0.02 < subj.mean() < 0.9:
        def render_s(p):
            out, _ = globals_py.tone_color(stage2, p)
            return out

        t_sub = _stats(after, subj)
        for key, stat, target in (
            ("exposure", lambda i: _stats(i, subj)["L"], t_sub["L"]),
            ("saturation", lambda i: _stats(i, subj)["chroma"], t_sub["chroma"]),
        ):
            sp = _calibrate(render_s, key, sp, stat, target, -100, 100)
        sp = {k: round(v, 1) for k, v in sp.items() if abs(v) >= 3}
        if sp:
            notes.append(
                f"subject only: exposure {sp.get('exposure',0):+.0f}, "
                f"saturation {sp.get('saturation',0):+.0f}"
            )

    recipe = [{"toolId": "tone-color", "params": {k: round(v, 1) for k, v in g.items()},
               "enabled": True}]
    if hp:
        recipe.append({"toolId": "hsl", "params": hp, "enabled": True})
    if sp:
        recipe.append({"toolId": "tone-color", "params": sp, "enabled": True,
                       "mask": {"region": "subject", "feather": 6}})

    knobs = sum(len(r["params"]) for r in recipe)
    return recipe, {
        "geometry": geom,
        "knobs": knobs,
        "summary": notes,
        "measured": {"before": src, "after": tgt},
    }
