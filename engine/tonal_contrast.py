"""The photographer's "3D" — structure contrast split by tonal zone, aimed at
regions — AI tool.

Source: her tutorial (הסבר על כלים.mp4, 2026-07-28), recorded over an image
this pipeline exported. Her Photoshop recipe: Nik Tonal Contrast, preset
"02 Strong" (highlights/midtones/shadows at 80), saturation pulled down,
opacity down to ~26%, then an inverted layer mask painted so the effect lands
"mainly on the clothes"; on faces only after skin smoothing.

What that recipe actually is:

  * a MID-SCALE structure boost — chunkier than clarity, far wider than
    texture. It reads as modelling: knit stitches, bark, creases.
  * split by tonal zone. Highlights, midtones and shadows each get their own
    strength, weighted on the LOW-frequency base so one structure edge never
    straddles two zones.
  * applied by REGION. Her mask strokes become sliders: fabric (default on —
    "בדרך כלל אני שמה אותו בעיקר על הבגדים"), skin (default off — she adds it
    only after smoothing; in this chain smoothing runs earlier, so a recipe
    that enables `skin` gets exactly her ordering), and background. Hair is
    never a target.

`amount` is the master dial — the one slider she actually rides (her Opacity).
The zone shape ships at her ratios as defaults, so amount alone reproduces the
look. Only L* carries structure; `saturation` is a separate, explicit push on
chroma in the same regions (hers via Nik; ours defaults to 0 = none).

Highlight headroom and a black floor guard both scales: a white knit must not
clip (the niche's every frame has a white garment) and a boosted shadow must
not block up.
"""

import cv2
import numpy as np

import common
import masks

# structure band, as a fraction of the long edge (Gaussian ksize). Clarity is
# 1.5% and reads as micro-contrast; 3% reads as the modelling scale of knits
# and bark — the Tonal Contrast look. The `scale` slider walks this from fine
# (1.2%, just under clarity) to broad modelling (4.8%) — Nik's "Contrast Type"
# choice, as an axis instead of an enum. 50 = the measured 3% default.
STRUCT_K = 0.03
STRUCT_K_MIN, STRUCT_K_SPAN = 0.012, 0.036
# dl multiplier at amount=100 with a zone slider at 100 (measured on knit
# fabric: doubles-to-triples the band's structure at the extremes)
GAIN = 2.0
# positive push must not drive a channel into 255 — the clip rotates hue and
# flattens whites to plastic. Zone-scale blurred map, exactly like contour.
HEADROOM_LO, HEADROOM_HI = 235.0, 252.0
# negative push must not crush blacks (L* points on the low-frequency base)
FLOOR_LO, FLOOR_HI = 4.0, 18.0
SAT_GAIN = 0.6


def process(image_b64: str, params: dict):
    """HTTP wrapper. Internal chaining must use apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def _p(params, key, default=0.0):
    try:
        return float(params.get(key, default)) / 100.0
    except (TypeError, ValueError):
        return default / 100.0


def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def apply(rgb, params: dict):
    """params: { amount, highlights, midtones, shadows, saturation, scale,
    fabric, skin, rest } — amount/targets/scale 0..100, zones/saturation ±100"""
    amount = common.clamp01(params.get("amount", 0))
    zones = (_p(params, "highlights", 60), _p(params, "midtones", 60),
             _p(params, "shadows", 60))
    sat = _p(params, "saturation")
    fabric = common.clamp01(params.get("fabric", 100))
    skin = common.clamp01(params.get("skin", 0))
    rest = common.clamp01(params.get("rest", 0))

    if amount <= 0 or not (fabric or skin or rest) or not (any(zones) or sat):
        return rgb, {"applied": 0}

    h, w = rgb.shape[:2]
    long_edge = max(h, w)

    # --- where the structure may land: her mask strokes, as masks ---
    skin_m = np.clip(
        masks.get_mask(rgb, "face-skin") + masks.get_mask(rgb, "body-skin"), 0.0, 1.0
    )
    subject = masks.get_mask(rgb, "subject")
    fabric_m = np.clip(subject - skin_m - masks.get_mask(rgb, "hair"), 0.0, 1.0)
    region = fabric * fabric_m
    if skin:
        # never on eyes, brows, lips — structure there is crunch, not shape
        features = masks.get_mask(rgb, "face-features")
        region = region + skin * skin_m * (1.0 - features)
    if rest:
        region = region + rest * np.clip(1.0 - subject, 0.0, 1.0)
    region = np.clip(region, 0.0, 1.0)
    if float(region.sum()) < 64:
        return rgb, {"applied": 0}

    # --- the structure and its tonal zones, on the low-frequency base ---
    lab = cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)
    L = lab[..., 0] * 2.55  # byte scale, matching the rest of the engine
    scale = common.clamp01(params.get("scale", 50), 0.5)
    k = max(3, int(long_edge * (STRUCT_K_MIN + STRUCT_K_SPAN * scale))) | 1
    base = cv2.GaussianBlur(L, (k, k), 0)
    hp = L - base

    t = base / 255.0
    w_h = _smoothstep(0.4, 0.95, t)
    w_s = 1.0 - _smoothstep(0.05, 0.6, t)
    w_m = np.clip(1.0 - w_h - w_s, 0.0, 1.0)
    zone_gain = zones[0] * w_h + zones[1] * w_m + zones[2] * w_s

    dl = hp * zone_gain * (amount * GAIN) * region

    # --- guards: ceiling for dodges, floor for burns ---
    maxc = cv2.GaussianBlur(
        rgb.max(axis=2).astype(np.float32), (0, 0), max(2.0, long_edge * 0.004)
    )
    headroom = np.clip((HEADROOM_HI - maxc) / (HEADROOM_HI - HEADROOM_LO), 0.0, 1.0)
    floor = _smoothstep(FLOOR_LO, FLOOR_HI, base / 2.55)
    dl = np.where(dl > 0, dl * headroom, dl * floor)
    # the blurred map cannot see a lone speck brighter than its zone — without
    # this cap the white-dress frames grew their clipped area by 21%. The 0.6
    # converts L-units to a safe RGB bound: raising L on a coloured pixel can
    # move its top channel faster than dl itself.
    dl = np.minimum(dl, 0.6 * np.clip(252.0 - rgb.max(axis=2).astype(np.float32), 0.0, None))

    lab[..., 0] = np.clip((L + dl) / 2.55, 0.0, 100.0)
    if sat:
        f = 1.0 + SAT_GAIN * sat * amount * region
        lab[..., 1] *= f
        lab[..., 2] *= f
    conv = np.clip(cv2.cvtColor(lab, cv2.COLOR_LAB2RGB) * 255.0, 0, 255).astype(np.uint8)
    # pixels the tool did not push must come back bit-identical — the float
    # Lab round-trip alone wobbles every pixel by up to ±0.4 L* otherwise
    active = np.abs(dl) > 0.05
    if sat:
        active |= region > 0.01
    out = rgb.copy()
    out[active] = conv[active]

    # --- meta: where the push actually landed (the lab shows the shares) ---
    d = np.abs(dl)
    total = float(d.sum()) + 1e-6
    sel = region > 0.1
    return out, {
        "applied": 1,
        "fabricCoverage": round(float((fabric_m > 0.5).mean()), 4),
        "meanAbsL": round(float(d[sel].mean()) / 2.55, 2) if sel.any() else 0.0,
        "pushOnFabric": round(float(d[fabric_m > 0.5].sum()) / total, 3),
        "pushOnSkin": round(float(d[skin_m > 0.5].sum()) / total, 3),
        "pushOnRest": round(float(d[(subject < 0.5)].sum()) / total, 3),
    }
