"""Colour grading by tonal zone — shadows, midtones and highlights, separately.

The existing `color-grade` tool offers `shadowsWarm` and `highlightsWarm`:
one axis, warm to cool, in two zones. Real grading moves colour in TWO
dimensions per zone — you push shadows toward teal, not merely "less warm" —
and it treats midtones as their own territory.

So each zone gets a full hue + saturation + luminance triple, and `balance`
moves where the zones meet, which is what lets the same grade sit correctly on
a bright frame and a dark one.

Worked in Lab: a hue push is then a straight vector addition on a*/b* and does
not drag brightness along with it the way an RGB channel offset does.
"""

import cv2
import numpy as np

ZONES = ("shadows", "midtones", "highlights")

MAX_AB = 34.0   # a*/b* push at saturation 100
MAX_LUM = 22.0  # L shift at luminance 100


def _p(params, key, default=0.0):
    try:
        return float(params.get(key, default))
    except (TypeError, ValueError):
        return default


def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _zone_masks(l_norm, balance):
    """Shadow / midtone / highlight membership, summing to 1 everywhere."""
    # balance slides the whole split up or down the tone range
    b = np.clip(balance, -1.0, 1.0) * 0.25
    lo = _smoothstep(0.0 + b, 0.5 + b, l_norm)
    hi = _smoothstep(0.5 + b, 1.0 + b, l_norm)
    shadows = 1.0 - lo
    highlights = hi
    midtones = np.clip(1.0 - shadows - highlights, 0.0, 1.0)
    total = shadows + midtones + highlights
    return shadows / total, midtones / total, highlights / total


def apply(rgb, params: dict):
    spec = []
    for z in ZONES:
        hue = _p(params, f"{z}Hue")
        sat = _p(params, f"{z}Sat") / 100.0
        lum = _p(params, f"{z}Lum") / 100.0
        spec.append((hue, sat, lum))
    if not any(abs(s) > 1e-4 or abs(l) > 1e-4 for _, s, l in spec):
        return rgb, {"zonesUsed": 0}

    lab = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    l_norm = lab[..., 0] / 255.0
    masks = _zone_masks(l_norm, _p(params, "balance") / 100.0)

    used = 0
    for (hue, sat, lum), m in zip(spec, masks):
        if abs(sat) < 1e-4 and abs(lum) < 1e-4:
            continue
        used += 1
        if abs(sat) > 1e-4:
            rad = np.radians(hue)
            lab[..., 1] += m * (sat * MAX_AB * float(np.cos(rad)))
            lab[..., 2] += m * (sat * MAX_AB * float(np.sin(rad)))
        if abs(lum) > 1e-4:
            lab[..., 0] += m * (lum * MAX_LUM)

    out = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
    return out, {"zonesUsed": used}


def process(image_b64: str, params: dict):
    import common

    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta
