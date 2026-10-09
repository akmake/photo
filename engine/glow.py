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
#
# 2026-10-09, second design ("זה נראה כל כך רע" — docs/GLOW-TIMELINE.md). The
# first one pulled every point of the face to the face's mean light, estimated
# at 0.08 face width, inside a region that stopped at a line. Measured on 16
# frames from 5 shoots it (a) erased the face's own FORM — an evenly lit face
# changed by 2.7–6.7 L — because at that scale the shading of nose, eye socket
# and turning cheek IS the "light"; (b) darkened the lit side by 6–18 L, so the
# face went grey beside hands that stayed bright; (c) drew a line where the
# region met neck, ear and hairline. So, three separate parts:
#
# 1. WHAT is light: only the trend ACROSS the face. The face is close to
#    mirror-symmetric and its form is too; side light is not. So the light is
#    read as a profile along the face's own left-right axis, and each side is
#    compared with its MIRROR (Zhang et al., "Portrait Shadow Manipulation",
#    SIGGRAPH 2020, use the landmark mirror of the face for exactly this).
#    Shading that both sides share — the cheeks turning away, the nose — is
#    form, and stays.
# 2. WHERE TO: fill light, not flattening. The dark side is lifted to its
#    mirror's level; the lit side gives up only a little (EVEN_KEY_GIVE). The
#    retoucher's rule: "don't flatten the face — just make it a bit smoother".
# 3. WHERE IT APPLIES: one smooth field over that person's skin — face, neck,
#    ears, the hands by the face — fading out slowly with distance from the
#    face (dodge & burn with a big soft brush), not a region with an edge.
EVEN_PROFILE_SIGMA = 0.18  # the light estimate's blur, fraction of face width
EVEN_BINS = 32             # profile bins across the face
EVEN_SPAN = 1.5            # the profile reaches 1.5 half-widths each side (ears, neck)
EVEN_KEY_GIVE = 0.12       # how much of its excess the lit side gives up (0.3 cost newborns 6–9 L)
EVEN_GAIN_MIN, EVEN_GAIN_MAX = 0.8, 1.45
# At 100 the dark side closes this much of the gap to its mirror, not all of
# it: a full lift read as a lamp switched on (204, 2026-10-09).
EVEN_FILL = 0.75
# Colour follows the lift by this power of the gain. Light alone, at fixed
# a/b, reads GREY on lifted skin; pulling a/b toward the lit side turned an
# over-exposed newborn's shadow side grey-blue (204). Retouchers dodge with a
# little colour riding along, which is what this is.
EVEN_CHROMA_FOLLOW = 0.5
# A side-to-side difference this small (Lab L) is the face, not the light —
# pose, a lock of hair, a nostril — and is left alone; the correction comes in
# fully by EVEN_DEADBAND_FULL. Side light on the test set is 10–30 L; an evenly
# lit 3/4 newborn moved 1.2 L without this.
EVEN_DEADBAND, EVEN_DEADBAND_FULL = 3.0, 6.0
EVEN_REACH = 1.4           # the field fades to nothing this many face widths from the face
EVEN_SKIN_SOFT = 0.03      # feather of the skin edge, fraction of face width
# how far toward the crown (fraction of face width) the segmenter's FACE skin is
# trusted past the landmark oval — the forehead up to the hairline
EVEN_FOREHEAD_REACH = 0.45
# face width the light fields are estimated at (see _even_light)
EVEN_WORK_FW = 320.0


def _even_profile(values, weights, s, bins):
    """Weighted mean of `values` per bin of `s` (−1..+1), and the weight in it."""
    idx = np.clip(((s + 1.0) * 0.5 * bins).astype(np.int32), 0, bins - 1)
    w = np.bincount(idx.ravel(), weights=weights.ravel(), minlength=bins)
    v = np.bincount(idx.ravel(), weights=(values * weights).ravel(), minlength=bins)
    return v / np.maximum(w, 1e-6), w


def _even_light(rgb, strength):
    """Lift the face's shadow side toward its mirror. uint8 in/out."""
    faces = masks._face_landmarks(rgb)
    if not faces or strength <= 0:
        return rgb, 0
    h, w = rgb.shape[:2]
    out = rgb.copy()
    done = 0
    skin_full = None
    ovals = [np.array([[l[i].x * w, l[i].y * h] for i in masks.FACE_OVAL], np.float32) for l in faces]
    widths = [abs(l[masks.FACE_RIGHT].x - l[masks.FACE_LEFT].x) * w for l in faces]
    for fi, lm in enumerate(faces):
        pts = ovals[fi]
        fw = widths[fi]
        if fw < 24:
            continue
        pad = int(fw * (EVEN_REACH + 0.1))
        x0, y0 = np.maximum(pts.min(axis=0).astype(int) - pad, 0)
        x1, y1 = np.minimum(pts.max(axis=0).astype(int) + pad, [w, h])
        # Every field here is smooth by construction, so it is built with the
        # face ~EVEN_WORK_FW px wide and only the result is stretched back.
        k = min(1.0, EVEN_WORK_FW / fw)
        cw, ch = x1 - x0, y1 - y0
        sw, sh = max(8, int(cw * k)), max(8, int(ch * k))
        fws = fw * k
        sx, sy = sw / cw, sh / ch
        pts_s = (pts - [x0, y0]) * [sx, sy]
        oval = np.zeros((sh, sw), np.uint8)
        cv2.fillPoly(oval, [pts_s.astype(np.int32)], 1)

        if skin_full is None:
            skin_full = np.clip(masks.get_mask(rgb, "face-skin") + masks.get_mask(rgb, "body-skin"), 0.0, 1.0)

        def small(m):
            return cv2.resize(m[y0:y1, x0:x1].astype(np.float32), (sw, sh), interpolation=cv2.INTER_AREA)

        face_skin = small(masks.get_mask(rgb, "face-skin"))
        skin = small(skin_full)

        # The face's own axes: up = chin -> forehead, across = perpendicular,
        # centred on the nose tip. `s` is the signed distance across, in face
        # widths — the coordinate the light is read and corrected along.
        up = np.array([(lm[10].x - lm[152].x) * w * sx, (lm[10].y - lm[152].y) * h * sy], np.float32)
        up /= max(float(np.hypot(*up)), 1e-3)
        across = np.array([-up[1], up[0]], np.float32)
        nose = np.array([(lm[1].x * w - x0) * sx, (lm[1].y * h - y0) * sy], np.float32)
        yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
        s = ((xx - nose[0]) * across[0] + (yy - nose[1]) * across[1]) / max(fws, 1.0)
        # A turned head shows its far side narrower: the same cheek sits nearer
        # the nose there. So each side is measured in ITS OWN half-width — the
        # face's edge is ±1 on both sides — and the mirror pairs cheek with
        # cheek, not cheek with ear. (Measured: on an evenly lit 3/4 newborn,
        # chayamushka-359, the plain mirror lifted the near side by 5 L.)
        s_pts = ((pts_s[:, 0] - nose[0]) * across[0] + (pts_s[:, 1] - nose[1]) * across[1]) / max(fws, 1.0)
        ext_pos = max(float(s_pts.max()), 0.15)
        ext_neg = max(float(-s_pts.min()), 0.15)
        s = np.where(s >= 0, s / ext_pos, s / ext_neg) / EVEN_SPAN

        # Where the light is READ: face skin inside the landmark oval, swept
        # toward the crown so the forehead up to the hairline counts.
        swept = oval.copy()
        for t in np.linspace(0.0, EVEN_FOREHEAD_REACH * fws, 8)[1:]:
            M = np.float32([[1, 0, up[0] * t], [0, 1, up[1] * t]])
            swept = np.maximum(swept, cv2.warpAffine(oval, M, (sw, sh)))
        read = face_skin * swept.astype(np.float32)
        if read.sum() < 16:
            continue

        crop = out[y0:y1, x0:x1].astype(np.float32) / 255.0
        lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB)
        lab_s = cv2.resize(lab, (sw, sh), interpolation=cv2.INTER_AREA)
        # The light is a broad trend (blur of ~0.18 face width), so it is READ
        # on a quarter-size copy: at the working size the wide blurs over the
        # neck-and-ears crop cost ~0.9 s of a 1.5 s pass.
        # ...but never below ~80 px across the face: a 45 px face read at a
        # quarter was 12 px wide, too few to tell one side from the other.
        q = int(max(1, min(4, fws // 80)))
        tw, th = max(4, sw // q), max(4, sh // q)
        lab_t = cv2.resize(lab_s, (tw, th), interpolation=cv2.INTER_AREA)
        read_t = cv2.resize(read, (tw, th), interpolation=cv2.INTER_AREA)
        sb = np.clip(s, -1.0, 1.0)
        sb_t = cv2.resize(sb, (tw, th), interpolation=cv2.INTER_AREA)
        sigma = EVEN_PROFILE_SIGMA * fws / q
        den = np.maximum(cv2.GaussianBlur(read_t, (0, 0), sigma), 1e-4)

        def low(c):
            return cv2.GaussianBlur(lab_t[..., c] * read_t, (0, 0), sigma) / den

        # 1 — the light across the face, and its mirror.
        bins = EVEN_BINS
        Lp, wgt = _even_profile(low(0), read_t, sb_t, bins)
        have = wgt > 0.02 * wgt.max()
        mirror = have & have[::-1]
        if mirror.sum() < 4:
            continue  # a profile view: there is no other side to compare with
        Lm = Lp[::-1]
        # 2 — fill, not flatten: the darker of each mirrored pair rises to the
        # brighter; the brighter gives up only a little of its excess.
        d = np.where(Lp < Lm, EVEN_FILL * (Lm - Lp), -EVEN_KEY_GIVE * (Lp - Lm))
        knee = np.clip((np.abs(Lm - Lp) - EVEN_DEADBAND) / (EVEN_DEADBAND_FULL - EVEN_DEADBAND), 0.0, 1.0)
        d = d * knee * knee * (3.0 - 2.0 * knee)
        d = np.where(mirror, d, 0.0)
        # bins with no mirror take their nearest neighbour's correction, so
        # the field runs on smoothly past the narrow side of a turned head
        idx = np.flatnonzero(mirror)
        near = idx[np.argmin(np.abs(np.arange(bins)[:, None] - idx[None, :]), axis=1)]
        d = np.where(mirror, d, d[near])
        Lp = np.where(mirror, Lp, Lp[near])
        d = cv2.GaussianBlur(d.reshape(1, -1).astype(np.float32), (0, 0), 1.2).ravel()
        gain_b = np.clip((Lp + strength * d) / np.maximum(Lp, 2.0), EVEN_GAIN_MIN, EVEN_GAIN_MAX)
        # Colour rides along with the lift, but never past what the mirrored,
        # lit point has: newborn shadow skin is redder than the lit side, and
        # free to follow the gain it became a red patch (204, 2026-10-09).
        # Where the light is taken away, colour stays — darkening at fixed a/b
        # does not grey.
        ap, _ = _even_profile(low(1), read_t, sb_t, bins)
        bp, _ = _even_profile(low(2), read_t, sb_t, bins)
        cp = np.hypot(ap, bp)
        cap = np.where(mirror, np.maximum(1.0, cp[::-1] / np.maximum(cp, 1e-3)), 1.0)
        cap = np.where(mirror, cap, cap[near])
        chroma_b = np.clip(gain_b ** EVEN_CHROMA_FOLLOW, 1.0, cap)
        # 3 — where it applies: this person's skin, fading with distance from
        # the face over EVEN_REACH face widths. A smooth field, no edge.
        pos = (sb + 1.0) * 0.5 * (bins - 1)
        lo_i = np.floor(pos).astype(np.int32)
        hi_i = np.minimum(lo_i + 1, bins - 1)
        f = pos - lo_i

        def at(arr):
            return arr[lo_i] * (1 - f) + arr[hi_i] * f

        dist = cv2.distanceTransform((1 - swept).astype(np.uint8), cv2.DIST_L2, 5) / max(fws, 1.0)
        fade = np.clip(1.0 - (dist / EVEN_REACH) ** 2, 0.0, 1.0) ** 2
        # In a group the field reaches the next person. Each face keeps only
        # the ground nearer to it than to any other face (distance in each
        # face's own widths), with a soft border: measured on a family of
        # seven, a neighbour's lift brightened an evenly lit face by 3 L.
        for fj, other in enumerate(ovals):
            if fj == fi or widths[fj] < 24:
                continue
            o = np.zeros((sh, sw), np.uint8)
            cv2.fillPoly(o, [((other - [x0, y0]) * [sx, sy]).astype(np.int32)], 1)
            if not o.any():
                continue
            d_o = cv2.distanceTransform((1 - o).astype(np.uint8), cv2.DIST_L2, 5) / max(widths[fj] * k, 1.0)
            fade *= np.clip(0.5 + (d_o - dist) / 0.4, 0.0, 1.0)
        skin_soft = cv2.GaussianBlur(skin, (0, 0), max(0.5, EVEN_SKIN_SOFT * fws))
        # never the hair: lifted, the dark strands at the hairline turned red
        hair = small(masks.get_mask(rgb, "hair"))
        weight = np.clip(skin_soft * (1.0 - hair) * fade, 0.0, 1.0)

        gain = 1.0 + (at(gain_b) - 1.0) * weight
        cgain = 1.0 + (at(chroma_b) - 1.0) * weight
        fields = np.dstack([gain - 1.0, cgain - 1.0, weight]).astype(np.float32)
        full = cv2.resize(fields, (cw, ch), interpolation=cv2.INTER_LINEAR)
        lab[..., 0] = np.clip(lab[..., 0] * (1.0 + full[..., 0]), 0.0, 100.0)
        lab[..., 1] *= 1.0 + full[..., 1]
        lab[..., 2] *= 1.0 + full[..., 1]
        moved = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB) * 255.0
        # written back through the weight, so pixels the field does not reach
        # keep their exact bytes instead of a Lab round trip
        wgt_full = full[..., 2:3]
        blend = crop * 255.0 + (moved - crop * 255.0) * np.clip(wgt_full * 4.0, 0.0, 1.0)
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
