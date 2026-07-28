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
    """One masked Orton pass: mist from the region's lit side, soft spill."""
    fr = max(3, r // 2) | 1
    m = cv2.GaussianBlur(region, (fr, fr), 0)

    L = (rgb_f @ globals_py.LUM) / 255.0
    src_w = globals_py._smoothstep(SRC_LO, SRC_HI, L) * m

    mist = cv2.GaussianBlur(rgb_f * src_w[..., None], (r, r), 0)
    screen = 255.0 - (255.0 - rgb_f) * (255.0 - mist) / 255.0

    # light lands on the feathered region plus a soft halo just past its edge
    dest = np.clip(m + cv2.GaussianBlur(m, (r, r), 0) * 0.5, 0.0, 1.0)
    if guard is not None:
        dest = dest * (1.0 - (1.0 - FEATURE_LIGHT) * guard)

    protect = 1.0 - globals_py._smoothstep(
        PROTECT_LO, PROTECT_HI, rgb_f.max(axis=2)
    )
    w = (amount * dest * protect)[..., None]
    return rgb_f + (screen - rgb_f) * w


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


def apply(rgb, params: dict):
    """params: { amount, people, skin, fabric, radius: 0..100 }"""
    amount = common.clamp01(params.get("amount", 0))
    people = common.clamp01(params.get("people", 0))
    skin = common.clamp01(params.get("skin", 0))
    fabric = common.clamp01(params.get("fabric", 0))
    radius01 = common.clamp01(params.get("radius", 40))

    if amount <= 0 and people <= 0 and skin <= 0 and fabric <= 0:
        return rgb, {"applied": 0}

    r = _radius_px(rgb, radius01)
    meta = {"applied": 1, "radiusPx": r}
    out = rgb

    if amount > 0:
        # byte-identical to the legacy frame-wide glow
        out, _ = globals_py.glow(out, params)
        meta["general"] = round(amount, 2)

    region_active = people > 0 or skin > 0 or fabric > 0
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

        out = np.clip(f, 0, 255).astype(np.uint8)
        _light_shares(rgb, out, skin_m, fabric_m, meta)

    return out, meta


def process(image_b64: str, params: dict):
    """HTTP wrapper. Internal chaining must use apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta
