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

So this operator does something categorically different, and its safety comes
from what it is STRUCTURALLY unable to do:

    it edits `a` and `b`.  `L` is never written.

Lightness is what the eye reads as structure, texture, pore and shadow, so an
edit that cannot touch `L` cannot produce a plastic face, cannot blur a pore and
cannot flatten a contour — not as a matter of tuning, but of construction. The
same argument the frequency-separation era relied on, applied to the axis that
actually carries a blemish (see `skinmodel.W_A = 1.0`: a mark is pigment).

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
    count, labels, stats, _ = cv2.connectedComponentsWithStats(strong, 8)
    for i in range(1, count):
        area = int(stats[i, cv2.CC_STAT_AREA])
        w = int(stats[i, cv2.CC_STAT_WIDTH])
        h = int(stats[i, cv2.CC_STAT_HEIGHT])
        # compact: a mole, not a shadow band or a stray dark hair
        if area < 8 or max(w, h) > limit or max(w, h) > 3.2 * max(1, min(w, h)):
            continue
        out[labels == i] = 1
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
    allow = np.clip(judge, 0.0, 1.0) * (1.0 - protect.astype(np.float32))
    # Only wide enough to hide the correction's own edge. A larger kernel is a
    # low-pass on the correction field itself, which flattens the peak exactly
    # over small marks — the things we are trying to reach.
    fr = max(3, int(face_d * 0.004)) | 1
    confine = (allow > 0.02).astype(np.float32)
    if lift_judge is None:
        lift_allow = allow
    else:
        lift_allow = np.clip(lift_judge, 0.0, 1.0) * (1.0 - protect.astype(np.float32))
    lift_confine = (lift_allow > 0.02).astype(np.float32)

    out = lab.copy()
    stats = {"protectedSpotPx": int(protect.sum())}
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
