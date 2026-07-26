"""Hair tones — AI tool.

mask      = hair (MediaPipe multiclass segmenter)
operation = a gradient map across the hair's own luminance, plus shine

The professional technique is not a global hue shift — that flattens hair into a
wig. It is a GRADIENT MAP: one colour into the shadows, another into the
highlights, composited at low opacity. The classic hair recipe is reds into the
shadows and yellows into the highlights, which is what produces depth at the
roots and a warm glow on the lit strands.

Everything runs as Photoshop's `Color` blend does — a*/b* move, L* does not — so
every strand and every specular edge survives untouched. Shine is the one pass
that writes L*, and it is driven by the hair's OWN luminance, so it can only
strengthen a highlight the light already put there.

The mask needed no work: masks.py has documented `hair` as existing for this
tool since it was written.

See docs/RESEARCH-blush-eyes-hair.md.
"""

import numpy as np

import common
import local_color
import masks


def _signed(params, key, default=0.0) -> float:
    """A -100..100 parameter. common.clamp01 is for one-sided sliders."""
    try:
        return max(-1.0, min(1.0, float(params.get(key, default)) / 100.0))
    except (TypeError, ValueError):
        return default / 100.0


def process(image_b64: str, params: dict):
    """HTTP wrapper. Internal chaining must use apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def apply(rgb, params: dict):
    """params: { strength, warmth: -100..100, shine, richness }"""
    strength = common.clamp01(params.get("strength", 50))
    warmth = _signed(params, "warmth", 40)
    shine = common.clamp01(params.get("shine", 35))
    richness = common.clamp01(params.get("richness", 40))
    if strength <= 0:
        return rgb, {"hairCoverage": 0.0}

    hair = masks.get_mask(rgb, "hair")
    coverage = float((hair > 0.5).mean())
    if coverage < 0.0004:  # no hair worth toning
        return rgb, {"hairCoverage": round(coverage, 4), "noHair": 1}

    box = common.region_box(hair, 8, rgb.shape)
    if box is None:
        return rgb, {"hairCoverage": round(coverage, 4)}
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1]
    reg = hair[y0:y1, x0:x1]

    # Tone RELATIVE to the hair this photo has. Blonde and near-black hair need
    # different absolute targets to read as the same amount of warmth.
    lab = local_color.to_lab(crop)
    base_a, base_b = local_color.local_median_ab(lab, reg)

    # reds into the shadows, yellows into the highlights — as OFFSETS
    shadow_ab = (7.0 * warmth + 3.0 * richness, 3.0 * warmth)
    highlight_ab = (2.0 * warmth, 16.0 * warmth + 5.0 * richness)

    # split at the hair's own midpoint so the two tones land half and half
    lum = lab[..., 0] / 255.0
    sel = reg > 0.35
    pivot = float(np.median(lum[sel])) if sel.any() else 0.45

    out = local_color.split_tone(
        crop, reg, shadow_ab, highlight_ab, amount=strength, pivot=pivot
    )

    if shine > 0:
        out = local_color.shine(out, reg, amount=shine * strength)

    full = rgb.copy()
    full[y0:y1, x0:x1] = np.clip(out, 0, 255).astype(np.uint8)

    return full, {
        "hairCoverage": round(coverage, 4),
        "hairA": round(base_a - 128.0, 1),
        "hairB": round(base_b - 128.0, 1),
        "warmth": round(warmth, 2),
    }
