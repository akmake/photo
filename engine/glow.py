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
    0.30..0.95, not a hard gate; on a low-key face the low end follows the
    face's own skin down) — shadows keep their depth, midtone faces still
    glow;
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
# ...but 0.30 is itself a fixed number, and it fails low-key frames the same
# way 0.55 failed IMG_2034: a side-lit newborn's shadow cheek sits at 0.24-0.36,
# so the mist grew only from the lit half and the glow added 14-220x more light
# there than on the shadow half (docs/GLOW-TIMELINE.md, 2026-09-24). A
# retoucher sets the Blend If split by eye per photo; here the ramp's low end
# drops to the face's own darker skin (this percentile of the skin mask), and
# never rises above SRC_LO — frames that already worked render as before.
SKIN_LO_PCT = 5
SRC_LO_FLOOR = 0.10
# Above this channel value the pixel is nearly clipped — adding light there
# only erases texture (measured: 2.9% of dress pixels crossed 250 at amount
# 100 with no protection).
PROTECT_LO, PROTECT_HI = 232.0, 252.0
# Fraction of the light that face features (eyes, brows, lips) still receive.
FEATURE_LIGHT = 0.35


def _radius_px(rgb, radius01):
    return globals_py._radius_px(rgb, 4 + radius01 * 50, 2) | 1


def _skin_src_lo(rgb, skin_m):
    """Low end of the source ramp for passes that carry a face (see SKIN_LO_PCT).
    Subsampled — a percentile, not a render."""
    sel = skin_m[::4, ::4] > 0.5
    if not sel.any():
        return SRC_LO
    L = (rgb[::4, ::4].astype(np.float32) @ globals_py.LUM) / 255.0
    return float(np.clip(np.percentile(L[sel], SKIN_LO_PCT), SRC_LO_FLOOR, SRC_LO))


def _region_glow(rgb_f, region, guard, amount, r, src_lo=SRC_LO):
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
    if guard is not None:
        # The feature mask is drawn for healing, with a few-px edge. Under a
        # glow of radius r that edge printed as a darker patch the shape of
        # the eye hull and the lip outline (seen on chayamushka-155/202). The
        # retoucher's eraser here is a soft brush the size of the glow.
        gk = (2 * r) | 1
        guard = cv2.GaussianBlur(guard, (gk, gk), 0)

    lit = np.empty_like(rgb_f)

    def source(y0, y1):
        px = rgb_f[y0:y1]
        L = (px @ globals_py.LUM) / 255.0
        src_w = globals_py._smoothstep(src_lo, SRC_HI, L) * m[y0:y1]
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


# --- even light on the face ------------------------------------------------
#
# The photographer's ask (2026-09-24): at a given level the glow should TAKE
# light from where there is plenty and bring the darker parts of the face up
# to the same level — not only add. On a side-lit newborn that is the
# difference between a luminous face and a half-lit one.
#
# It is the retoucher's low-frequency move (frequency separation: lighting
# transitions live in the low layer, texture in the high one) and Retinex's
# model of it: the illumination is a wide Gaussian of the image, the rest is
# detail. Plain Retinex/SQI haloes at edges because the Gaussian averages hair
# and background into the skin; here the blur is NORMALISED over the skin mask
# only, so the light estimate is made of skin alone. Then the illumination is
# pulled toward the face's own mean and the pixel is scaled by the same ratio —
# pores, lashes and features ride along untouched.
EVEN_SIGMA_FRAC = 0.08  # light-estimate blur, as a fraction of face width
EVEN_GAIN_MIN, EVEN_GAIN_MAX = 0.75, 1.6
# the face oval is widened by this much so jaw, ears and the forehead above the
# landmark ring are evened too
EVEN_OVAL_GROW = 0.12
# how far toward the crown (fraction of face width) the segmenter's FACE skin is
# trusted past the landmark oval — the forehead up to the hairline
EVEN_FOREHEAD_REACH = 0.45
# edge feather of the change, as a fraction of the light-estimate blur
EVEN_FEATHER = 0.1
# face width the light fields are estimated at (see _even_light)
EVEN_WORK_FW = 320.0


def _even_light(rgb, strength):
    """Pull the face's low-frequency light toward its own mean. uint8 in/out."""
    faces = masks._face_landmarks(rgb)
    if not faces or strength <= 0:
        return rgb, 0
    h, w = rgb.shape[:2]
    out = rgb.copy()
    done = 0
    for lm in faces:
        pts = np.array([[lm[i].x * w, lm[i].y * h] for i in masks.FACE_OVAL], np.float32)
        fw = abs(lm[masks.FACE_RIGHT].x - lm[masks.FACE_LEFT].x) * w
        if fw < 24:
            continue
        pad = int(fw * 0.6)
        x0, y0 = np.maximum(pts.min(axis=0).astype(int) - pad, 0)
        x1, y1 = np.minimum(pts.max(axis=0).astype(int) + pad, [w, h])
        # Every field below is a wide blur — smooth by construction — so the
        # region and the fields are built with the face ~EVEN_WORK_FW px wide
        # and only the result is stretched back: at full size a 5616px frame
        # spent 3.4-5.7s in these blurs, then 2.1s building the region.
        k = min(1.0, EVEN_WORK_FW / fw)
        cw, ch = x1 - x0, y1 - y0
        sw, sh = max(8, int(cw * k)), max(8, int(ch * k))
        fws = fw * k
        oval = np.zeros((sh, sw), np.uint8)
        cv2.fillPoly(oval, [((pts - [x0, y0]) * [sw / cw, sh / ch]).astype(np.int32)], 1)

        def small(kind):
            return cv2.resize(masks.get_mask(rgb, kind)[y0:y1, x0:x1], (sw, sh),
                              interpolation=cv2.INTER_AREA)

        def grown(mask, frac):
            g = max(3, int(fws * frac)) | 1
            return cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (g, g))
                              ).astype(np.float32)

        # The landmark oval stops well below the hairline, so clipping the
        # skin to it cut the forehead with a straight line (155). Growing it
        # the same amount every way instead reached the EARS — a separate small
        # structure that then took the cheek's correction (a red fold on a
        # paled rim, 155). So the oval is swept toward the crown, along the
        # face's own axis (chin -> forehead landmark, whatever the tilt), and
        # the segmenter's face skin is trusted inside that; body skin only near
        # the oval — it is there because the segmenter sometimes calls a cheek
        # "body" (356), not for hands.
        axis = np.array([(lm[10].x - lm[152].x) * w, (lm[10].y - lm[152].y) * h], np.float32)
        axis /= max(float(np.hypot(*axis)), 1e-3)
        swept = oval.copy()
        for t in np.linspace(0.0, EVEN_FOREHEAD_REACH * fws, 8)[1:]:
            M = np.float32([[1, 0, axis[0] * t], [0, 1, axis[1] * t]])
            swept = np.maximum(swept, cv2.warpAffine(oval, M, (sw, sh)))
        reg_s = np.maximum(small("face-skin") * grown(swept, EVEN_OVAL_GROW),
                           small("body-skin") * grown(oval, EVEN_OVAL_GROW))
        if reg_s.sum() < 16:
            continue
        # Lab. Scaling RGB lifted the shadow cheek's chroma with its light (the
        # red of shadowed baby skin turned into a red patch) and greyed the lit
        # side.
        crop = out[y0:y1, x0:x1].astype(np.float32) / 255.0
        lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB)
        lab_s = cv2.resize(lab, (sw, sh), interpolation=cv2.INTER_AREA)
        sigma = EVEN_SIGMA_FRAC * fws
        den = np.maximum(cv2.GaussianBlur(reg_s, (0, 0), sigma), 1e-4)
        reg_sum = float(reg_s.sum())

        def low_of(c):
            lo = cv2.GaussianBlur(lab_s[..., c] * reg_s, (0, 0), sigma) / den
            return lo, float((lo * reg_s).sum() / reg_sum)

        low, target = low_of(0)
        low = low / 100.0
        target /= 100.0
        g_face = (low + strength * (target - low)) / np.maximum(low, 0.02)
        g_face = np.clip(g_face, EVEN_GAIN_MIN, EVEN_GAIN_MAX)
        # Applied on the skin itself, with a narrow feather. Measured both
        # wider ways on 155: fading over half the light scale INSIDE the skin
        # left the lit rim at the hairline at its old brightness (a bright
        # crescent); reaching OUTSIDE it gave the ear a gain computed from the
        # cheek beside it (red spots in its fold). The skin's edge is a real
        # edge in the picture (hairline, ear, swaddle); the change can stop there.
        soft = np.clip(cv2.GaussianBlur(reg_s, (0, 0), sigma * EVEN_FEATHER), 0.0, 1.0)
        fields = [(g_face - 1.0) * soft]
        # ...and the low-frequency COLOUR moves with it, as it does on the
        # retoucher's low layer. Light alone was not enough: lit newborn skin is
        # nearly white-pink, so darkening it at a fixed a/b turned the forehead
        # grey (chayamushka-202), while the shadow cheek is redder than the
        # face — both are pulled toward the face's own average tone.
        for c in (1, 2):
            ch_low, ch_target = low_of(c)
            fields.append(strength * (ch_target - ch_low) * soft)
        fields.append(soft)
        full = cv2.resize(np.dstack(fields), (cw, ch), interpolation=cv2.INTER_LINEAR)
        soft = full[..., 3]
        lab[..., 0] = np.clip(lab[..., 0] * (1.0 + full[..., 0]), 0.0, 100.0)
        lab[..., 1] += full[..., 1]
        lab[..., 2] += full[..., 2]
        moved = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB) * 255.0
        # written back through `soft`, so pixels the face does not reach keep
        # their exact bytes instead of a Lab round trip
        blend = crop * 255.0 + (moved - crop * 255.0) * soft[..., None]
        out[y0:y1, x0:x1] = np.clip(blend + 0.5, 0, 255).astype(np.uint8)
        done += 1
    return out, done


def apply(rgb, params: dict):
    """params: { amount, people, skin, fabric, background, radius, even,
    warmth, saturation, shadows, highlights: 0..100 / ±100 }"""
    even = common.clamp01(params.get("even", 0))
    src_rgb = rgb
    meta_even = 0
    if even > 0:
        # before any glow, so the glow grows from the evened face; the masks
        # below are still asked of the ORIGINAL frame (their cache identity)
        rgb, meta_even = _even_light(rgb, even)
    out, meta = _glow(src_rgb, rgb, params)
    if meta_even:
        meta["applied"] = 1
        meta["evenFaces"] = meta_even
    elif even > 0:
        # the slider is up and nothing moved: say why (lab/explain.ts `noFace`)
        # instead of looking like a weak effect
        meta["noFace"] = True
    return out, meta


def _glow(mask_rgb, rgb, params: dict):
    """The glow proper. `mask_rgb` is the frame the masks are asked of (the
    original — their cache identity); `rgb` is the pixels to glow (the
    original, or the evened face)."""
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
        guard = masks.get_mask(mask_rgb, "face-features") if (people or skin) else None
        skin_m = np.clip(
            masks.get_mask(mask_rgb, "face-skin") + masks.get_mask(mask_rgb, "body-skin"),
            0.0, 1.0,
        )
        # clothing = the figure minus its skin and hair (subject mask is cached,
        # so building this for the report alone costs nothing)
        fabric_m = np.clip(
            masks.get_mask(mask_rgb, "subject") - skin_m - masks.get_mask(mask_rgb, "hair"),
            0.0, 1.0,
        )
        f = out.astype(np.float32)
        # from the skin, not the subject: the subject's darkest 5% is hair,
        # and hair must not become a glow source
        face_lo = _skin_src_lo(mask_rgb, skin_m) if (people or skin) else SRC_LO
        if people or skin:
            meta["srcLo"] = round(face_lo, 3)

        if people > 0:
            subject = masks.get_mask(mask_rgb, "subject")
            meta["subjectCoverage"] = round(float((subject > 0.5).mean()), 4)
            f = _region_glow(f, subject, guard, people, r, face_lo)
        if skin > 0:
            meta["skinCoverage"] = round(float((skin_m > 0.5).mean()), 4)
            f = _region_glow(f, skin_m, guard, skin, r, face_lo)
        if fabric > 0:
            meta["fabricCoverage"] = round(float((fabric_m > 0.5).mean()), 4)
            f = _region_glow(f, fabric_m, None, fabric, r)
        if background > 0:
            # THE MOVE FROM THE VIDEO: glow generated over everything and then
            # erased off the figures, so the warmth stays behind them. No
            # feature guard — there are no faces out here to protect.
            bg = masks.get_mask(mask_rgb, "background")
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
