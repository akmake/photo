"""Colour grading by tonal zone — shadows, midtones and highlights, separately.

This tool replaced the old `color-grade`, whose `shadowsWarm`/`highlightsWarm`
were one axis (warm to cool) in two zones, moved by RGB channel offsets that
drag brightness along with the colour. Real grading moves colour in TWO
dimensions per zone — you push shadows toward teal, not merely "less warm" —
and it treats midtones as their own territory.

So each zone gets a full hue + saturation + luminance triple, and `balance`
moves where the zones meet, which is what lets the same grade sit correctly on
a bright frame and a dark one.

Worked in Lab: a hue push is then a straight vector addition on a*/b* and does
not drag brightness along with it the way an RGB channel offset does.

The Lab conversion is done in floating point rather than through OpenCV's 8-bit
Lab, which rounds every channel to a whole level on the way in and on the way
out. That rounding is not harmless: in deep shadows one Lab level is worth up to
seven sRGB levels, so a quantised grade bands exactly where grading is used
most, and a gentle push (saturation under ~5) rounds away to nothing. It also
made the tool impossible to preview honestly — the byte path is fixed-point
inside OpenCV and cannot be reproduced in a browser, so the JS mirror sat up to
15 levels away from the export. In float the two agree to within one.

The matte (`fade`) came over from `color-grade` when that tool was retired: it
is the same family of move — where the tonal range sits and what colour it sits
on — so it belongs beside the zones rather than in a tool of its own. It runs
last, on the graded result, which is the order a colourist works in.

Mirrored in src/imageEngine.ts (live preview); parity guarded by test_parity.py.
"""

import cv2
import numpy as np

ZONES = ("shadows", "midtones", "highlights")

MAX_AB = 34.0   # a*/b* push at saturation 100
MAX_LUM = 22.0  # L shift at luminance 100

# The matte. BASE/MAX are the constants the old color-grade used, kept exactly
# so recipes carrying a fade render identically; WARM is how far `fadeWarmth`
# is allowed to move that base, +R/-B, which is the axis a film matte varies
# on (bleached-warm vs the cold blue-grey of a scanned negative).
MATTE_BASE = (62.0, 60.0, 66.0)
MATTE_MAX = 0.22
MATTE_WARM = 14.0
LUM = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _p(params, key, default=0.0):
    try:
        return float(params.get(key, default))
    except (TypeError, ValueError):
        return default


def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _to_lab(rgb_u8):
    """sRGB bytes -> Lab, L on 0..255 and a/b offset by 128, unquantised.

    OpenCV's *float* conversion, not its 8-bit one: same D65 sRGB maths, but it
    keeps the fractions instead of rounding each channel to a level, and it is
    vectorised — a hand-rolled numpy version of the identical formulas measured
    2.5x slower on a 20MP frame. The rescale afterwards puts it on the byte
    convention MAX_AB and MAX_LUM were tuned against.
    """
    f = rgb_u8.astype(np.float32) * (1.0 / 255.0)
    lab = cv2.cvtColor(f, cv2.COLOR_RGB2Lab)
    lab[..., 0] *= 2.55
    lab[..., 1] += 128.0
    lab[..., 2] += 128.0
    return lab


def _from_lab(lab):
    lab[..., 0] *= 1.0 / 2.55
    lab[..., 1] -= 128.0
    lab[..., 2] -= 128.0
    return cv2.cvtColor(lab, cv2.COLOR_Lab2RGB) * 255.0


def _zone_masks(l_norm, balance):
    """Shadow / midtone / highlight membership, summing to 1 everywhere.

    The three add to exactly one by construction: `lo` ramps over the lower
    half of the range and `hi` over the upper, so lo >= hi for every input, the
    midtone term lo-hi is never negative, and (1-lo) + (lo-hi) + hi == 1. There
    is nothing to normalise — which is worth saying, because normalising it
    anyway costs four full-frame passes for a division by 1.
    """
    # balance slides the whole split up or down the tone range
    b = np.clip(balance, -1.0, 1.0) * 0.25
    lo = _smoothstep(0.0 + b, 0.5 + b, l_norm)
    hi = _smoothstep(0.5 + b, 1.0 + b, l_norm)
    return 1.0 - lo, lo - hi, hi


def _matte(rgb_f, fade, warmth, rolloff):
    """The tonal range compressed toward a lifted base colour.

    At rolloff 0 this is a flat blend over the whole range — the historical
    fade, kept bit-exact. Raising rolloff concentrates the lift in the shadows
    so the whites keep their punch, which is what a film toe actually does and
    the reason a flat fade reads as "washed out" rather than "matte".
    """
    base = np.array(MATTE_BASE, dtype=np.float32)
    base = base + warmth * MATTE_WARM * np.array([1.0, 0.0, -1.0], dtype=np.float32)
    k = fade * MATTE_MAX
    if rolloff > 1e-4:
        l_norm = (rgb_f @ LUM) / 255.0
        k = k * (1.0 - rolloff * _smoothstep(0.0, 1.0, l_norm))[..., None]
    return rgb_f * (1.0 - k) + k * base


def apply(rgb, params: dict):
    spec = []
    for z in ZONES:
        hue = _p(params, f"{z}Hue")
        sat = _p(params, f"{z}Sat") / 100.0
        lum = _p(params, f"{z}Lum") / 100.0
        spec.append((hue, sat, lum))
    fade = _p(params, "fade") / 100.0
    zoned = any(abs(s) > 1e-4 or abs(l) > 1e-4 for _, s, l in spec)
    if not zoned and fade <= 1e-4:
        return rgb, {"zonesUsed": 0, "matte": 0.0}

    balance = _p(params, "balance") / 100.0
    warmth = _p(params, "fadeWarmth") / 100.0
    rolloff = _p(params, "fadeRolloff") / 100.0
    used = sum(
        1 for _, s, l in spec if abs(s) > 1e-4 or abs(l) > 1e-4
    ) if zoned else 0

    # Every pixel here is independent, so the frame is walked in strips. This
    # buys peak memory, not speed (measured: no change either way) — a 20MP
    # frame would otherwise hold several 240MB float temporaries at once, which
    # is what makes a batch export start swapping.
    h, w = rgb.shape[:2]
    rows = max(1, min(h, int(2_000_000 / max(1, w))))
    out = np.empty(rgb.shape, dtype=np.uint8)
    for y0 in range(0, h, rows):
        blk = rgb[y0:y0 + rows]
        # one quantisation, at the end: rounding to bytes between the grade and
        # the matte would cost a level twice over, and in shadows a level is dear
        f = blk.astype(np.float32)
        if zoned:
            lab = _to_lab(np.ascontiguousarray(blk, dtype=np.uint8))
            masks = _zone_masks(lab[..., 0] / 255.0, balance)
            for (hue, sat, lum), m in zip(spec, masks):
                if abs(sat) < 1e-4 and abs(lum) < 1e-4:
                    continue
                if abs(sat) > 1e-4:
                    rad = np.radians(hue)
                    lab[..., 1] += m * (sat * MAX_AB * float(np.cos(rad)))
                    lab[..., 2] += m * (sat * MAX_AB * float(np.sin(rad)))
                if abs(lum) > 1e-4:
                    lab[..., 0] += m * (lum * MAX_LUM)
            f = _from_lab(lab)
        if fade > 1e-4:
            f = _matte(f, fade, warmth, rolloff)
        np.clip(f, 0, 255, out=f)
        out[y0:y0 + rows] = f

    return out, {"zonesUsed": used, "matte": round(fade, 3)}


def process(image_b64: str, params: dict):
    import common

    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta
