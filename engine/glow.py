"""Glow — bloom and mist, with separate strengths for people, skin and fabric.

The frame-wide glow (`amount`) is the classic Orton and stays byte-identical to
the old globals_py implementation: bloom only from pixels above a fixed
luminance threshold. Its measured failure on real frames is WHERE that rule
puts the light: on IMG_2034 (girl in a white dress, dark LUT grade) 89.8% of
all added light landed on the dress and 1.3% on the face — the face sat at
luminance 0.545, five thousandths under the 0.55 threshold. A recipe built on
that knife edge does not transfer between photos.

What a retoucher does in Photoshop is generate the glow globally and then
PAINT where it lands: out of the eyes, gently onto the skin, dialled down on
the dress so the lace keeps its weave. The region sliders here are that hand,
automated with the engine's own masks:

  people  — the whole figure as one piece (every person in the frame)
  skin    — face + body skin only
  fabric  — clothing: subject minus skin minus hair

Three rules shared by every region pass, each one a named Photoshop habit:
  * the mist grows from the region's own LIT side (soft luminance ramp
    0.30..0.95, not a hard gate) — shadows keep their depth, midtone faces
    still glow;
  * pixels already near clipping receive almost nothing, so white fabric
    brightens without burning its texture;
  * eyes, brows and lips get ~a third of the light — glow over the eyes is
    the first thing a retoucher erases.

The JS mirror in imageEngine.ts still implements only the frame-wide amount;
the region passes need masks, which exist engine-side only — which is why the
tool is registered kind 'ai' and renders through the engine.
"""

import cv2
import numpy as np

import common
import globals_py
import masks

# Region mists ramp in from SRC_LO instead of the legacy hard 0.55 gate: a face
# at luminance ~0.55 must glow, a shadow at 0.3 must not lift and flatten.
SRC_LO, SRC_HI = 0.30, 0.95
# Above this channel value the pixel is nearly clipped — adding light there
# only erases texture (measured: 2.9% of dress pixels crossed 250 at amount
# 100 with no protection).
PROTECT_LO, PROTECT_HI = 232.0, 252.0
# Fraction of the light that face features (eyes, brows, lips) still receive.
FEATURE_LIGHT = 0.35


def _radius_px(rgb, radius01):
    return globals_py._radius_px(rgb, 4 + radius01 * 50, 2) | 1


def _region_glow(rgb_f, region, guard, amount, r):
    """One masked Orton pass: mist from the region's lit side, soft spill.

    The per-pixel parts run in parallel bands (common.per_pixel) — the blurs
    between them stay whole-frame. Same expressions, same order, so the same
    bits: measured identical on three frames at 1536px and at full size, and
    2.4-4.4x faster, because this pass is three quarters elementwise maths and
    numpy does that on one core.
    """
    h, w = rgb_f.shape[:2]
    fr = max(3, r // 2) | 1
    m = cv2.GaussianBlur(region, (fr, fr), 0)

    lit = np.empty_like(rgb_f)

    def source(y0, y1):
        px = rgb_f[y0:y1]
        L = (px @ globals_py.LUM) / 255.0
        src_w = globals_py._smoothstep(SRC_LO, SRC_HI, L) * m[y0:y1]
        lit[y0:y1] = px * src_w[..., None]

    common.per_pixel(source, h, w)
    mist = cv2.GaussianBlur(lit, (r, r), 0)
    # light lands on the feathered region plus a soft halo just past its edge
    halo = cv2.GaussianBlur(m, (r, r), 0)

    out = np.empty_like(rgb_f)

    def blend(y0, y1):
        px = rgb_f[y0:y1]
        screen = 255.0 - (255.0 - px) * (255.0 - mist[y0:y1]) / 255.0
        dest = np.clip(m[y0:y1] + halo[y0:y1] * 0.5, 0.0, 1.0)
        if guard is not None:
            dest = dest * (1.0 - (1.0 - FEATURE_LIGHT) * guard[y0:y1])
        protect = 1.0 - globals_py._smoothstep(PROTECT_LO, PROTECT_HI, px.max(axis=2))
        wgt = (amount * dest * protect)[..., None]
        out[y0:y1] = px + (screen - px) * wgt

    common.per_pixel(blend, h, w)
    return out


def _light_shares(before, after, skin_m, fabric_m, meta):
    """Where did the added light actually land? Subsampled — this is a report,
    not a render."""
    s = 4
    d = np.abs(
        after[::s, ::s].astype(np.float32) - before[::s, ::s].astype(np.float32)
    ).mean(axis=2)
    total = float(d.sum())
    if total <= 0:
        return
    on_skin = float(d[skin_m[::s, ::s] > 0.5].sum())
    on_fabric = float(d[fabric_m[::s, ::s] > 0.5].sum())
    meta["lightOnSkin"] = round(on_skin / total, 3)
    meta["lightOnFabric"] = round(on_fabric / total, 3)
    meta["lightOnRest"] = round(max(0.0, total - on_skin - on_fabric) / total, 3)


# How far `warmth` tilts the added light at the ends of its travel. 0.35 is a
# Photoshop photo-filter at about 25% — visibly golden on a backlit background,
# still short of the orange cast that reads as a mistake.
WARMTH_TILT = 0.35
# The tonal ramps `shadows` and `highlights` weigh the glow by. Deliberately
# overlapping around the midtones: a face at 0.5 answers a little to both,
# which is what keeps the two sliders from behaving like a switch.
SHADOW_LO, SHADOW_HI = 0.15, 0.55
HILIGHT_LO, HILIGHT_HI = 0.55, 0.95


def _shape_light(before, after, params):
    """Colour and place THE ADDED LIGHT — never the photograph under it.

    Nik's Glamour Glow carries Glow Warmth, Saturation, Shadows and Highlights
    beside the glow itself, and they are the reason the effect can sit on a
    background as evening sun rather than as grey mist. They are applied HERE,
    to the difference between the frame and its glow, for two reasons:

      * it is the one place every glow path meets. The frame-wide `amount` is
        the legacy Orton and the region passes are this module's; shaping the
        delta means a warmth slider means the same thing whichever of them the
        light came from, instead of being a control that does nothing unless a
        particular other slider happens to be up (CLAUDE.md section 6);
      * at the defaults the delta is returned untouched, so a recipe saved
        before these existed renders byte-identical.

    The tonal pair weighs by the luminance of the frame BEFORE the glow: where
    the light landed is a property of the photograph, not of the mist that has
    already lifted it.
    """
    # globals_py._p is the house reader for a signed ±100 slider; the clamp is
    # this module's, because a value out of range here tilts colour rather than
    # merely overshooting a curve.
    def signed(key):
        return float(np.clip(globals_py._p(params, key, 0.0), -1.0, 1.0))

    warmth = signed("warmth")
    sat = signed("saturation")
    shadows = signed("shadows")
    highlights = signed("highlights")
    if not (warmth or sat or shadows or highlights):
        return after

    src = before.astype(np.float32)
    d = after.astype(np.float32) - src

    if warmth:
        # Red up and blue down by the same amount: a tilt, so the light gets
        # warmer without getting brighter.
        d = d * np.array([1.0 + WARMTH_TILT * warmth, 1.0,
                          1.0 - WARMTH_TILT * warmth], np.float32)

    if sat:
        # Around the light's OWN grey. At -100 the glow is colourless mist; at
        # +100 it carries the colour of whatever it grew out of.
        grey = (d @ globals_py.LUM)[..., None]
        d = grey + (d - grey) * (1.0 + sat)

    if shadows or highlights:
        L = (src @ globals_py.LUM) / 255.0
        w = 1.0
        if shadows:
            w = w + shadows * (1.0 - globals_py._smoothstep(SHADOW_LO, SHADOW_HI, L))
        if highlights:
            w = w + highlights * globals_py._smoothstep(HILIGHT_LO, HILIGHT_HI, L)
        d = d * np.clip(w, 0.0, 2.0)[..., None]

    return np.clip(src + d, 0, 255).astype(np.uint8)


def apply(rgb, params: dict):
    """params: { amount, people, skin, fabric, background, radius,
    warmth, saturation, shadows, highlights: 0..100 / ±100 }"""
    amount = common.clamp01(params.get("amount", 0))
    people = common.clamp01(params.get("people", 0))
    skin = common.clamp01(params.get("skin", 0))
    fabric = common.clamp01(params.get("fabric", 0))
    background = common.clamp01(params.get("background", 0))
    radius01 = common.clamp01(params.get("radius", 40))

    if amount <= 0 and people <= 0 and skin <= 0 and fabric <= 0 and background <= 0:
        return rgb, {"applied": 0}

    r = _radius_px(rgb, radius01)
    meta = {"applied": 1, "radiusPx": r}
    out = rgb

    if amount > 0:
        # byte-identical to the legacy frame-wide glow
        out, _ = globals_py.glow(out, params)
        meta["general"] = round(amount, 2)

    region_active = people > 0 or skin > 0 or fabric > 0 or background > 0
    if region_active:
        guard = masks.get_mask(rgb, "face-features") if (people or skin) else None
        skin_m = np.clip(
            masks.get_mask(rgb, "face-skin") + masks.get_mask(rgb, "body-skin"),
            0.0, 1.0,
        )
        # clothing = the figure minus its skin and hair (subject mask is cached,
        # so building this for the report alone costs nothing)
        fabric_m = np.clip(
            masks.get_mask(rgb, "subject") - skin_m - masks.get_mask(rgb, "hair"),
            0.0, 1.0,
        )
        f = out.astype(np.float32)

        if people > 0:
            subject = masks.get_mask(rgb, "subject")
            meta["subjectCoverage"] = round(float((subject > 0.5).mean()), 4)
            f = _region_glow(f, subject, guard, people, r)
        if skin > 0:
            meta["skinCoverage"] = round(float((skin_m > 0.5).mean()), 4)
            f = _region_glow(f, skin_m, guard, skin, r)
        if fabric > 0:
            meta["fabricCoverage"] = round(float((fabric_m > 0.5).mean()), 4)
            f = _region_glow(f, fabric_m, None, fabric, r)
        if background > 0:
            # THE MOVE FROM THE VIDEO: glow generated over everything and then
            # erased off the figures, so the warmth stays behind them. No
            # feature guard — there are no faces out here to protect.
            bg = masks.get_mask(rgb, "background")
            meta["backgroundCoverage"] = round(float((bg > 0.5).mean()), 4)
            f = _region_glow(f, bg, None, background, r)

        out = np.clip(f, 0, 255).astype(np.uint8)
        _light_shares(rgb, out, skin_m, fabric_m, meta)

    out = _shape_light(rgb, out, params)
    return out, meta


def process(image_b64: str, params: dict):
    """HTTP wrapper. Internal chaining must use apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta
