"""Diffuse pigment evening — the operator that heals nothing and moves nothing.

Spot healing answers "what should be UNDER this mark". That is the right
question for a scab, a crumb or a papule, and the wrong question for the other
half of what is actually on a face: broad uneven redness. Post-acne erythema,
irritation, wind-burn and shaving rash are not objects with an inside and an
outside — they are a COLOUR that drifts across a whole cheek. Asking a
reconstruction operator to remove them makes it rebuild a quarter of the face,
which is why the result read as a smear.

Measured on the reference acne face: 208 real marks by an independent detector,
of which the discrete-mark path could legitimately claim maybe a third. The rest
was never a set of spots at all.

So this operator does something categorically different. Its safety ORIGINALLY
came from what it was structurally unable to do — it edited `a` and `b`, and
`L` was never written, so it could not blur a pore or flatten a contour as a
matter of construction rather than tuning.

That guarantee no longer holds literally: `lift_lightness` writes `L` (see the
long note there — post-inflammatory hyperpigmentation IS darkness, and colour-
only correction turned red spots grey). The guarantee was replaced by gates,
and one of those gates was then measured to be wrong: a crease is a shadowed
groove, shadowed skin is redder as well as darker, and the colour gate read
0.98 on a real nasolabial fold. See CREASE_MAX_THICK for the measurement and
for the shape veto that now carries the structural guarantee instead.

The reference it corrects toward is a local MEDIAN of the person's own skin, so:
  · it is relative — identical behaviour on any skin tone or white balance;
  · it cannot be dragged by the very redness it is removing (a mean can, and
    that single substitution is what unblocked the detector too).

What it will not do: push any pixel past its local reference (redness is only
ever reduced, never inverted into green), and never move a pixel further than
`max_shift`. That cap is what keeps a mole a mole and lips lips.
"""

from __future__ import annotations

import cv2
import numpy as np

import shape
import skinmodel

# Lab units — the most the correction may ever move a pixel.
#
# These are a backstop against a runaway correction, NOT the mechanism that
# protects lips, blush and moles. Those are protected by construction: lips,
# nostrils and eyes are outside `judge`; moles are exempted by name; and broad
# blush has almost no excess over a LOCAL median, so it is invisible to the
# operator however high the cap goes.
#
# Setting them low on the theory that they were a safety net simply left the work
# undone: a strong inflamed papule sits 15-20 above its surroundings, so a cap of
# 7 dimmed it and stopped. At high zoom that was the entire remaining failure —
# cheeks and forehead were clean while every raised papule survived.
MAX_SHIFT_A = 18.0
MAX_SHIFT_B = 10.0

# Where "normal variation" ends, in robust sigmas of the local excess. Below
# this nothing is touched at all, which is what protects genuine blush.
KNEE_SIGMA = 0.9

# The lightness knee gets its own, lower multiplier. The robust sigma of the
# darkness field is ~4.4 on real skin because it legitimately includes pore
# texture, so 0.9 of it left a floor of 4.0 L units under every mark — a full
# lift still could not bring a median mark (7.6) below visibility. The knee only
# controls HOW MUCH is lifted; WHERE is decided by the two gates, and they are
# what protects structure. So this can be lowered without loosening safety.
KNEE_SIGMA_L = 0.45

# Lightness. Read the long note on `_colour_gate` before changing these: L is
# only ever raised where the COLOUR channels independently prove the darkness is
# pigment, and never by more than this.
MAX_LIFT_L = 14.0

# How much colour excess is needed for the lightness gate to open fully,
# expressed in knees ABOVE the knee. Measured on the reference face: the median
# real mark sits 0.65 knees past it, so a gate that only saturated at 2.0 (the
# first attempt) throttled the lift to 1.2 L units where 7.6 was needed, and 42%
# of marks got no lift at all. 0.8 opens on a real mark while a crease — whose
# colour excess is ~0 by construction, which is the whole basis of W_A=1.0 in
# skinmodel — stays firmly shut.
GATE_SATURATE = 0.8

# --- the crease veto -------------------------------------------------------
#
# This file used to argue that a facial crease was safe from it by construction:
# "a crease carries no colour excess, and it is a line, so both of that
# operator's gates reject it" (the same sentence justified removing the
# nasolabial fold from `face-pigment-protect` in masks.py). The first half of
# that sentence is false, and it was measured on three faces:
#
#     face          a excess on fold / on plain skin   b excess    colourGate
#     adult male            7.62 / 0.37                14.77/0.45     0.983
#     child 1770#3          4.64 / 0.29                 5.76/0.27     0.981
#     toddler 1784          2.15 / 0.18                 3.01/0.21     0.798
#
# against knees of 1.33-2.67. A crease is a SHADOWED GROOVE, and shadowed skin
# is not merely darker — it is redder and yellower, because the light that does
# return has scattered through a longer subsurface path. So the colour gate,
# whose whole premise is "darker AND redder means pigment, darker alone means
# structure", reads 0.98 on a nasolabial fold and opens all the way.
#
# Worse, the a/b correction never consulted a shape gate at all: `_blob_gate`
# guards only the L lift. So the fold was being desaturated with nothing in the
# way, at 15.8x (a) and 24.4x (b) the rate of ordinary skin.
#
# The honest discriminator is the one `_blob_gate` already gets right and which
# holds regardless of colour: a crease is a LINE, a mark is a BLOB. Lifted here
# to the whole operator. The two bars are the ones cleanup.py already validated
# for exactly this judgement (RIDGE_MAX_THICK / RIDGE_MIN_LEN) — a stray hair,
# an eyeliner tail and a nasolabial fold are all thin AND long; a papule is
# neither.
# The primary test is ELONGATION — length over thickness — and it is the only
# one of the three that needs no reference size at all.
#
# Thickness alone cannot do this job, and trying it is what failed first. The
# 2%-of-face bar borrowed from cleanup.RIDGE_MAX_THICK is calibrated on stray
# hairs and eyeliner, which really are 1-2px things. A nasolabial fold is a
# GROOVE: measured 5.6px on a 180px face (3.1%) and 8.2px on a 359px face
# (2.3%), so both were rejected as "too thick to be a line" while their
# components ran 125px and 93px long. A papule sits in that same thickness
# range, so the bar cannot separate them however it is set.
#
# Elongation can, and it falls out of geometry rather than tuning. For a disc
# of radius r: area = pi*r^2, thickness = r, length = area/2r = pi*r/2, so
# length/thickness = pi/2 ~ 1.57 whatever its size. For a line of length L and
# half-width t it is L/t, which grows without bound. Measured on the reference
# folds: 22.3, 11.3 and 15.8 against 1.57 for anything round.
CREASE_MIN_ELONGATION = 6.0
# Still bounded in absolute terms: a structure must run a real fraction of the
# face (a mark's own morphological response is short — the bug that let a
# blemish veto itself in cleanup.py), and a percolated noise web that spans the
# cheek is not a crease however elongated its skeleton measures.
CREASE_MIN_LEN = 0.10  # of face_d
CREASE_MAX_THICK = 0.05  # of face_d
# Ranks over ALL judged skin, not over the responding pixels — the lesson
# already paid for at cleanup.RIDGE_EXTENT_PCT. A morphological blackhat is
# exactly zero over most of a face, so a median/MAD bar collapses to the
# absolute floor, and an absolute Lab amplitude is not the same evidence at
# every resolution.
#
# TWO bars, not one, for the reason hysteresis_core already documents: a single
# bar breaks a crease into fragments wherever its contrast dips, and each
# fragment is then judged alone and fails the length test. Measured: at a
# single 97th-percentile bar the girl's fold cleared it on 2.9% of its length
# and the surviving component was 31px long against a 27px bar — the veto was
# rejecting the fold for being in pieces, which is the same failure mode
# _fluid_trails hit on the drool strand.
#
# Where the bars sit is measured, not chosen. The median blackhat response
# along a real fold lands at percentile 98.9 / 98.2 / 93.4 of judged skin on
# the three reference faces (stable to within 1 point across kernel widths
# 0.03-0.08 of face_d, so the kernel is not a sensitive choice).
CREASE_SEED_PCT = 96.0
CREASE_EXTENT_PCT = 92.0
CREASE_FLOOR_L = 5.0


# A mole is darker than this (Lab L below its local reference) and compact.
# Nothing at or beyond it is ever corrected, in any channel.
#
# Measured, not guessed. On the reference acne face the local darkness deficit
# over judged skin runs p50=0, p90=8, p99=24, and the genuine moles peak at
# 40-82. A bar of 13 protected 76 compact spots (3.6k px, ~9k after growth) —
# i.e. it was shielding the acne it was supposed to correct, and redness
# regressed from 857 to 4291px as a direct result. 22 sits above the p99 of
# ordinary skin variation and keeps the real moles.
MOLE_L_DEFICIT = 22.0


def protected_spots(
    rgb: np.ndarray, judge: np.ndarray, face_d: float, grow_pct: float = 0.004
) -> np.ndarray:
    """Moles and beauty marks: dark, compact, and none of our business.

    Every mechanism in this file keys on "pigment that deviates from local
    skin", and a mole is the most deviant pigment on the face — so it is exactly
    what a pigment corrector removes first unless it is named and excluded.
    Measured before this existed: a real mole shifted 20 RGB units, i.e. it was
    being erased. That is not retouching, it is altering someone's face.

    Distinguished from a post-inflammatory brown mark by MAGNITUDE, which is the
    only honest signal available: hyperpigmentation sits a few L units under its
    surroundings, a mole sits far below and holds a hard edge.
    """
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    support = (judge > 0.35).astype(np.float32)
    radius = max(9, int(face_d * 0.08)) | 1
    deficit = skinmodel.normalized_median(lab[..., 0], support, radius) - lab[..., 0]

    strong = ((deficit > MOLE_L_DEFICIT) & (judge > 0.5)).astype(np.uint8)
    strong = cv2.morphologyEx(strong, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    out = np.zeros_like(strong)
    limit = max(6.0, face_d * 0.055)
    # Compact: a mole, not a shadow band or a stray dark hair.
    #
    # Measured with `shape.describe`, not from a bounding box. The box version
    # here failed in the direction that matters most: a box grows with the
    # DIAGONAL, so an ordinary mole lying at an angle read as elongated and lost
    # its protection — the gate meant to keep the tool off someone's face was
    # itself orientation-dependent. (Fifth site in this pipeline with that bug.)
    for _, comp, geom in shape.describe_all(strong):
        if geom.area < 8 or geom.thickness_max > limit or geom.elongation > 3.2:
            continue
        out[comp] = 1
    # A protected spot keeps its own soft rim, or the correction stops on a line
    # around it and draws a halo instead.
    #
    # The right margin differs by CALLER, which is why it is a parameter. Colour
    # correction wants it tight — growth is quadratic in the ring and a generous
    # one turned 3.6k protected px into 9k, shielding acne. Spot HEALING wants it
    # generous: healing the halo while the core is exempt carves a repaired ring
    # around an untouched mole, which measured as the two worst tone errors on
    # the face (10.7 and 10.6, both sitting on a mole).
    grow = max(3, int(face_d * grow_pct)) | 1
    return cv2.dilate(out, np.ones((grow, grow), np.uint8))


def crease_map(rgb: np.ndarray, allow: np.ndarray, face_d: float) -> np.ndarray:
    """Dark structures that are THIN and LONG — the face's own creases.

    Returns a soft 0..1 field to be withheld from every channel this operator
    writes. Needs no landmarks, so it covers the folds nobody has a landmark
    for: the melolabial continuation below the mouth corner, crow's feet,
    forehead lines, neck lines, and a smile fold on a head at any angle.

    Deliberately NOT keyed on colour. Keying it on colour is what failed: see
    the note on CREASE_MAX_THICK.
    """
    if face_d < 1 or allow.max() <= 0:
        return np.zeros(rgb.shape[:2], np.float32)
    lab_l = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)[..., 0]
    k = max(5, int(face_d * 0.05)) | 1
    resp = cv2.morphologyEx(
        lab_l, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    ).astype(np.float32)

    sample = allow > 0.35
    if sample.sum() < 256:
        return np.zeros(rgb.shape[:2], np.float32)
    seed_bar = max(float(np.percentile(resp[sample], CREASE_SEED_PCT)), CREASE_FLOOR_L)
    ext_bar = max(
        float(np.percentile(resp[sample], CREASE_EXTENT_PCT)), CREASE_FLOOR_L * 0.5
    )
    # Confined to the judged skin (plus a margin, so a crease running to the
    # jaw stays whole). Without this the low extent bar percolates through
    # hair, brows and background into one blob that spans the frame, and the
    # thickness test then rejects everything — measured: 350k px marked, 0% of
    # the fold covered.
    zr = max(3, int(face_d * 0.03)) | 1
    zone = cv2.dilate(sample.astype(np.uint8), np.ones((zr, zr), np.uint8)) > 0
    # bridge pixel-scale dropouts so one crease stays one structure where its
    # contrast dips — the same 3x3 bridge _structure_gate uses
    bridge = np.ones((3, 3), np.uint8)
    seed = cv2.dilate(((resp > seed_bar) & zone).astype(np.uint8), bridge)
    ridge = cv2.dilate(((resp > ext_bar) & zone).astype(np.uint8), bridge)
    ridge = np.maximum(ridge, seed)
    # Hysteresis: the low bar describes how far a structure runs, it does not
    # get to declare one. Only components holding confident evidence survive.
    if seed.any():
        nc, nl = cv2.connectedComponents(ridge, connectivity=8)
        alive = np.zeros(max(2, nc), bool)
        alive[np.unique(nl[seed > 0])] = True
        alive[0] = False
        ridge = alive[nl].astype(np.uint8)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(ridge, connectivity=8)
    max_thick = max(1.5, face_d * CREASE_MAX_THICK)
    min_len = max(6.0, face_d * CREASE_MIN_LEN)
    # One distance transform for the whole map, then a per-label maximum. Doing
    # it per component instead is O(components x frame) and takes minutes on a
    # 20MP frame — a ridge map has thousands of components.
    dist = cv2.distanceTransform(ridge, cv2.DIST_L2, 3)
    thick = np.zeros(max(2, count), np.float32)
    np.maximum.at(thick, labels.ravel(), dist.ravel())
    areas = stats[:, cv2.CC_STAT_AREA].astype(np.float32)
    length = areas / np.maximum(1.0, thick * 2.0)
    elongation = length / np.maximum(1.0, thick)
    keep = (
        (areas >= 6)
        & (elongation >= CREASE_MIN_ELONGATION)
        & (length >= min_len)
        & (thick <= max_thick)
    )
    keep[0] = False
    if not keep.any():
        return np.zeros(rgb.shape[:2], np.float32)

    crease = keep[labels].astype(np.uint8)
    # a crease has soft shoulders; ending the protection on its exact ridge
    # leaves the operator free to eat the sides and thin the line instead
    grow = max(3, int(face_d * 0.008)) | 1
    soft = cv2.dilate(crease, np.ones((grow, grow), np.uint8)).astype(np.float32)
    return np.clip(cv2.GaussianBlur(soft, (grow, grow), 0), 0.0, 1.0)


def _excess(channel: np.ndarray, support: np.ndarray, radius: int) -> np.ndarray:
    """How much redder/yellower a pixel is than the skin immediately around it."""
    ref = skinmodel.normalized_median(channel, support, radius)
    return channel - ref


def _blob_gate(
    deficit: np.ndarray, allow: np.ndarray, knee_l: float, face_d: float
) -> np.ndarray:
    """Second route to the lightness lift: darkness that is SHAPED like a mark.

    The colour gate is the safe route, but it is not the complete one. Measured
    on the reference face, 64 of 217 real marks carry almost no colour excess —
    old flat brown scars — so the gate never opened and they were the specks
    still visible after all the redness was gone.

    The discriminator for those is shape, and it is the one already established
    elsewhere in this codebase against hair: a MORPHOLOGICAL OPENING. A crease,
    a lash line, a jaw shadow and a contour are all lines, and a line does not
    survive being opened with a disc; a blemish is a blob and does. An upper
    size bound then removes broad shading, which is the other thing that is dark
    without being a mark.

    So a crease still cannot be lifted — not because its colour is unremarkable,
    but because it is not blob-shaped. Two independent gates, either sufficient,
    neither of which a facial structure can pass.
    """
    core = ((deficit > knee_l * 1.6) & (allow > 0.35)).astype(np.uint8)
    if not core.any():
        return np.zeros(deficit.shape, np.float32)
    disc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    core = cv2.morphologyEx(core, cv2.MORPH_OPEN, disc)

    out = np.zeros_like(core)
    max_side = max(6.0, face_d * 0.05)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(core, 8)
    for i in range(1, count):
        area = int(stats[i, cv2.CC_STAT_AREA])
        w = int(stats[i, cv2.CC_STAT_WIDTH])
        h = int(stats[i, cv2.CC_STAT_HEIGHT])
        if area < 6 or max(w, h) > max_side:
            continue
        if max(w, h) > 3.5 * max(1, min(w, h)):
            continue
        out[labels == i] = 1

    grow = max(3, int(face_d * 0.005)) | 1
    soft = cv2.dilate(out, np.ones((grow, grow), np.uint8)).astype(np.float32)
    return cv2.GaussianBlur(soft, (grow, grow), 0)


def even_pigment(
    rgb: np.ndarray,
    judge: np.ndarray,
    face_d: float,
    strength: float = 1.0,
    max_shift_a: float = MAX_SHIFT_A,
    max_shift_b: float = MAX_SHIFT_B,
    lift_lightness: bool = True,
    lift_judge: np.ndarray | None = None,
):
    """Pull local colour excess back toward this person's own local skin colour.

    judge:      float 0..1 — skin whose COLOUR may be corrected (no lips, eyes,
                brows, nostrils, hair). Used soft, so the correction fades out
                instead of ending on a line.
    lift_judge: float 0..1 — skin whose LIGHTNESS may additionally be raised.
                Defaults to `judge`.

    The two differ by the infraorbital strip, and the distinction is the whole
    reason this is a parameter. That strip must keep its darkness — lifting it is
    what turns a child into someone with smudged under-eye circles — but it is
    ordinary skin in every other respect, and real papules do sit in it. Blocking
    it outright left them permanently untouchable; blocking only the lift removes
    their colour and leaves the socket's shading exactly as it was.
    """
    if strength <= 0 or judge.max() <= 0:
        return rgb, {"pigmentPx": 0}

    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    support = (judge > 0.35).astype(np.float32)
    radius = max(9, int(face_d * 0.10)) | 1
    protect = protected_spots(rgb, judge, face_d)
    # The face's own creases, measured from the image. Withheld from BOTH the
    # chroma correction and the lightness lift — the chroma half never had a
    # shape gate, and it was the half doing the damage on an adult fold.
    crease = crease_map(rgb, np.clip(judge, 0.0, 1.0), face_d)
    keep_structure = 1.0 - crease
    allow = (
        np.clip(judge, 0.0, 1.0) * (1.0 - protect.astype(np.float32)) * keep_structure
    )
    # Only wide enough to hide the correction's own edge. A larger kernel is a
    # low-pass on the correction field itself, which flattens the peak exactly
    # over small marks — the things we are trying to reach.
    fr = max(3, int(face_d * 0.004)) | 1
    # Re-weight by the protection itself, not by a binary "is it non-zero".
    #
    # The old form was `allow > 0.02`, which on a FEATHERED mask means "anywhere
    # the protection has not yet reached exactly zero" — so the blurred
    # correction was free to run all the way out through the feather. Measured
    # on three faces after every other eye leak was closed: 100% of the pixels
    # still changing by more than 5 levels inside face-eye-region were inside
    # face-anatomy, and disabling this operator alone dropped the worst of them
    # from 11.0 and 12.0 levels to 2.0 and 6.0.
    #
    # Multiplying by `allow` costs nothing in the interior, where it is 1.0, and
    # tapers the correction across the feather exactly as the mask intends.
    confine = allow
    if lift_judge is None:
        lift_allow = allow
    else:
        lift_allow = (
            np.clip(lift_judge, 0.0, 1.0)
            * (1.0 - protect.astype(np.float32))
            * keep_structure
        )
    lift_confine = lift_allow

    out = lab.copy()
    stats = {
        "protectedSpotPx": int(protect.sum()),
        "creasePx": int((crease > 0.5).sum()),
    }
    colour_over = np.zeros(lab.shape[:2], np.float32)
    for channel, cap, name in ((1, max_shift_a, "a"), (2, max_shift_b, "b")):
        excess = _excess(lab[..., channel], support, radius)
        inside = excess[support > 0.5]
        if inside.size < 64:
            continue
        sigma = skinmodel._robust_sigma(inside)
        knee = sigma * KNEE_SIGMA
        # Only ever REDUCE an excess, and only the part beyond normal variation.
        over = np.maximum(excess - knee, 0.0)
        # Melanin is red AND yellow, so a brown post-acne mark can sit near the
        # a-knee while clearly raising b. Gating lightness on `a` alone left the
        # brownest marks — the ones most visible after the redness is gone —
        # entirely unlifted. Whichever channel proves pigment is enough.
        colour_over = np.maximum(colour_over, over / max(1e-3, knee))
        delta = -np.minimum(over, cap) * strength * allow
        # Soft spatially so the correction never shows an edge of its own, then
        # re-confined: blurring alone let the correction bleed ~3px past `allow`
        # and clip a brow at 10 L units. Smooth inside, hard stop at the border.
        delta = cv2.GaussianBlur(delta, (fr, fr), 0) * confine
        out[..., channel] = lab[..., channel] + delta
        stats[f"{name}Sigma"] = round(float(sigma), 2)
        stats[f"{name}Knee"] = round(float(knee), 2)
        stats[f"{name}MeanShift"] = round(float(-delta[support > 0.5].mean()), 2)
        stats[f"{name}MaxShift"] = round(float(-delta.min()), 2)

    if lift_lightness:
        # --- the one place L is allowed to move, and why it is still safe ----
        #
        # Refusing to write L is what makes a colour correction invisible, and
        # for inflamed redness that is the whole answer. It is NOT the answer for
        # post-inflammatory hyperpigmentation, which is what acne leaves behind:
        # a flat brown mark whose darkness IS the mark. Correcting only its
        # colour turns a red spot into a grey-brown one — measured on the
        # reference face, redness fell 10788 -> 857px while the dark count barely
        # moved, and the result read as freckled.
        #
        # The distinction is not "how dark" but WHAT ELSE IS TRUE THERE:
        #
        #   crease, pore, shadow, nostril  ->  darker, colour unchanged
        #   pigment mark                   ->  darker AND redder/yellower
        #
        # So L is gated by the CHROMA finding. A crease has no colour excess, so
        # its gate is zero and it cannot be lifted no matter how dark it is —
        # the property that used to come from never writing L now comes from the
        # gate, and it is the same property. Combined with a hard cap and the
        # mole exemption, the operator still cannot flatten structure.
        # NB: the reference is taken on L itself and subtracted afterwards.
        # Passing -L into normalized_median silently returns zeros — it clips to
        # uint8 for the median, so a negative channel collapses.
        deficit = skinmodel.normalized_median(lab[..., 0], support, radius) - lab[..., 0]
        # "Normal darkness variation" is estimated ONLY from skin with no colour
        # excess. Taken over all skin it is inflated by the marks themselves —
        # the third appearance of the same bug in this pipeline, and the binding
        # constraint on the whole operator: knee 5.34 against a median mark
        # deficit of 7.56 left just 2.2 units liftable where 7.6 was needed, so
        # the marks stayed brown no matter how wide the gate or how high the cap.
        # Estimating it from unpigmented skin is also the self-consistent choice,
        # since that is exactly the population the gate calls "not a mark".
        neutral = (support > 0.5) & (colour_over < 0.2)
        if neutral.sum() < 256:
            neutral = support > 0.5
        inside = deficit[neutral]
        if inside.size >= 64:
            knee_l = skinmodel._robust_sigma(inside) * KNEE_SIGMA_L
            gate = np.clip(colour_over / GATE_SATURATE, 0.0, 1.0)
            gate = gate * gate * (3 - 2 * gate)  # smoothstep, no hard onset
            blob = _blob_gate(deficit, lift_allow, knee_l, face_d)
            gate = np.clip(np.maximum(gate, blob), 0.0, 1.0)
            stats["blobGatePx"] = int((blob > 0.5).sum())
            over_l = np.maximum(deficit - knee_l, 0.0)
            lift = np.minimum(over_l, MAX_LIFT_L) * gate * strength * lift_allow
            lift = cv2.GaussianBlur(lift, (fr, fr), 0) * lift_confine
            out[..., 0] = lab[..., 0] + lift
            stats["lKnee"] = round(float(knee_l), 2)
            stats["lMaxLift"] = round(float(lift.max()), 2)
            stats["lMeanLift"] = round(float(lift[support > 0.5].mean()), 2)

    corrected = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
    changed = int((np.abs(out - lab).max(axis=2) > 0.5).sum())
    stats["pigmentPx"] = changed
    return corrected, stats
