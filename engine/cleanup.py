"""Skin cleanup — removes blemishes without touching the person's own colour.

Detection: novelty against a per-face skin model (see skinmodel.py). We do not
describe what a flaw looks like; we model the skin and flag what the model
cannot explain — so a mark that is LIGHTER, darker, redder or yellower is all
caught by the same measure.

Healing: frequency-separated, not inpainting. cv2.inpaint fills a hole by
propagating from its rim, which leaves a flat, textureless disc — the "plaster"
look. Instead the image is split into

    low  = the skin's own colour field  (blush; NEVER modified)
    mid  = the band blemishes live in   (suppressed where confidence is high)
    high = pores and texture            (kept, so the repair has real skin)

and reassembled. Because `low` is untouched by construction, this tool cannot
neutralise natural rosiness — that is a structural guarantee, not a setting.
"""

import cv2
import numpy as np

import common
import healing
import masks
import skinmodel

# A face must be at least this wide (px) for blemish healing to be safe.
MIN_FACE_PX = 180
FOREHEAD_CENTER = 10
CHIN_BOTTOM = 152
NOSE_TIP = 1


def _bright_debris_confidence(
    model: skinmodel.SkinModel,
    region: np.ndarray,
    protected: np.ndarray,
    face_d: float,
    strength: float,
) -> np.ndarray:
    """Detect tiny bright debris without making the main detector crease-blind.

    The general novelty score deliberately downweights Lab lightness because
    shadows and facial folds are mostly luminance. Small white crumbs are also
    mostly luminance, so they need a separate detector whose safety comes from
    SCALE and COMPACTNESS instead of globally raising the L-channel weight.
    """
    usable = region > 0.5
    out = np.zeros(region.shape, np.float32)
    if usable.sum() < 64:
        return out

    light_mid = model.mid[..., 0]
    median = float(np.median(light_mid[usable]))
    sigma = skinmodel._robust_sigma(light_mid[usable])
    z = (light_mid - median) / sigma

    # A low threshold grows the complete flake; a high peak is still required
    # before any component is accepted. Strength changes sensitivity without
    # changing the geometric safety limits.
    extent_z = 3.4 - strength * 1.0
    seed_z = 8.4 - strength * 2.0
    # Bright eyelid rims and hair gaps are compact too. Keep a face-scaled
    # margin from actual features/hair; real cheek and mouth debris remains
    # eligible even when it is close to a protected anatomical crease.
    safe_distance = cv2.distanceTransform(
        (protected < 0.1).astype(np.uint8), cv2.DIST_L2, 3
    )
    interior = safe_distance > max(3.0, face_d * 0.035)
    extent = ((z > extent_z) & (region > 0.35) & interior).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(extent, 8)

    max_side = max(5, int(face_d * 0.045))
    max_area = max(12, int((face_d * 0.04) ** 2))
    max_radius = max(2.0, face_d * 0.018)
    for index in range(1, count):
        component = labels == index
        if float(z[component].max()) < seed_z:
            continue
        if (
            stats[index, cv2.CC_STAT_WIDTH] > max_side
            or stats[index, cv2.CC_STAT_HEIGHT] > max_side
            or stats[index, cv2.CC_STAT_AREA] > max_area
        ):
            continue
        radius = float(
            cv2.distanceTransform(component.astype(np.uint8), cv2.DIST_L2, 3).max()
        )
        if radius > max_radius:
            continue
        out[component] = 1.0

    if out.any():
        # A one-pixel highlight would disappear below decide()'s 0.60 seed after
        # feathering. Give accepted debris a tiny solid core; decide() still
        # controls its final halo and size.
        out = cv2.dilate(out, np.ones((3, 3), np.uint8))
        out *= region
    return out


def _reflection_matrix(rgb: np.ndarray) -> np.ndarray | None:
    """Reflection across the facial midline, or None when symmetry is unsafe."""
    faces = masks._face_landmarks(rgb)
    if len(faces) != 1:
        return None
    lm = faces[0]
    h, w = rgb.shape[:2]

    def point(index: int) -> np.ndarray:
        return np.array([lm[index].x * w, lm[index].y * h], np.float32)

    left = point(masks.FACE_LEFT)
    right = point(masks.FACE_RIGHT)
    nose = point(NOSE_TIP)
    dl = float(np.linalg.norm(nose - left))
    dr = float(np.linalg.norm(nose - right))
    # A strongly turned face is not a mirror image in camera space.  Falling
    # back is safer than copying a foreshortened cheek onto the visible cheek.
    if min(dl, dr) / max(dl, dr, 1e-5) < 0.55:
        return None

    top = point(FOREHEAD_CENTER)
    bottom = point(CHIN_BOTTOM)
    direction = bottom - top
    length = float(np.linalg.norm(direction))
    if length < 20:
        return None
    direction /= length

    # Reflection around a line through `top` with unit direction d:
    # R = 2dd^T - I, translation keeps the line fixed.
    reflect = 2.0 * np.outer(direction, direction) - np.eye(2, dtype=np.float32)
    translate = top - reflect @ top
    return np.column_stack([reflect, translate]).astype(np.float32)


def _heal_with_symmetry(
    crop: np.ndarray,
    repair: np.ndarray,
    conf: np.ndarray,
    region: np.ndarray,
    face_d: float,
) -> tuple[np.ndarray, int]:
    """Use clean opposite-side skin first, with the current healer as fallback."""
    matrix = _reflection_matrix(crop)
    allowed = (region > 0.35).astype(np.uint8)
    if matrix is None:
        return healing.inpaint_texture(crop, repair, allowed), 0

    h, w = crop.shape[:2]
    mirrored = cv2.warpAffine(
        crop,
        matrix,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )

    # Creases are valid donors; actual features, hair and non-skin are not.
    donor_skin = masks.get_mask(crop, "face-skin")
    donor_features = masks.get_mask(crop, "face-features")
    donor_hair = masks.get_mask(crop, "hair")
    donor_ok = (
        (donor_skin > 0.35) & (donor_features < 0.15) & (donor_hair < 0.15)
    ).astype(np.uint8)
    donor_valid = cv2.warpAffine(
        donor_ok, matrix, (w, h), flags=cv2.INTER_NEAREST, borderValue=0
    )

    # Be stricter for donors than for repairs.  Even a weakly suspicious patch
    # on the opposite side is rejected instead of being copied.
    suspect = (conf > 0.12).astype(np.uint8)
    halo = max(3, int(face_d * 0.008)) | 1
    suspect = cv2.dilate(suspect, np.ones((halo, halo), np.uint8))
    donor_suspect = cv2.warpAffine(
        suspect, matrix, (w, h), flags=cv2.INTER_NEAREST, borderValue=1
    )
    return healing.symmetric_reconstruct(
        crop, repair, mirrored, donor_valid, donor_suspect, allowed
    )


def process(image_b64: str, params: dict):
    """HTTP wrapper — internal chaining uses apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def confidence(rgb, params: dict):
    """Return (confidence map 0..1, skin_region, face_d, model) or None."""
    strength = common.clamp01(params.get("strength", 60))
    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    if face_d < MIN_FACE_PX:
        return None

    # Anatomy, not just features: creases and the lip border read as strong
    # deviations to the skin model, so without them the detector spends its
    # sensitivity on the face's own structure instead of on dirt.
    features = masks.get_mask(rgb, "face-anatomy")
    hair = masks.get_mask(rgb, "hair")
    hr = max(3, int(face_d * 0.035)) | 1
    hair = cv2.dilate(hair, np.ones((hr, hr), np.uint8))

    # Judged area is confined to the face itself. Note this narrows `region`
    # only — `support` below deliberately keeps the jaw and ear as colour
    # samples, because cutting the sample at the same line would reintroduce
    # exactly the one-sided-neighbourhood bias this split exists to remove.
    region = np.clip(skin - features - hair, 0.0, 1.0) * masks.get_mask(rgb, "face-oval")
    er = max(1, int(face_d * 0.03))
    region = cv2.erode(region, np.ones((er, er), np.uint8))
    if region.max() <= 0:
        return None

    # Where the model may SAMPLE is a different question from where it may HEAL.
    # `region` withholds the creases, the contour band and an erosion margin —
    # rightly, we must not heal those. But they are still real examples of this
    # skin, and sampling only inside `region` leaves the model's smooth field
    # estimated one-sidedly along every one of those borders, which then reads
    # as deviation. `face-features` is the honest sampling exclusion: eyes,
    # brows, lips and nostrils are the only parts that genuinely are not skin.
    simple_features = masks.get_mask(rgb, "face-features")
    support = np.clip(skin - simple_features - hair, 0.0, 1.0)

    model = skinmodel.build(rgb, region, face_d, support=support)

    # Mahalanobis distance is chi-like with 3 dof, so the bar is set in sigmas.
    # strength 0 -> 4.5 sigma (only blatant marks), 1 -> 1.5 sigma (everything
    # the skin model cannot explain, including faint residue and dry patches).
    lo = 4.5 - strength * 3.0
    hi = lo + 1.6
    conf = np.clip((model.novelty - lo) / (hi - lo), 0.0, 1.0)
    conf = conf * conf * (3 - 2 * conf)  # smoothstep: no hard edges
    conf *= region
    conf = np.maximum(
        conf,
        _bright_debris_confidence(
            model, region, np.maximum(simple_features, hair), face_d, strength
        ),
    )

    # Safety net: a blemish is LOCAL. Anything larger than this is skin
    # character the model failed to absorb (a broad shadow, strong blush on an
    # unusual face) — never "correct" it.
    max_side = max(8, int(face_d * 0.16))
    blobs = (conf > 0.35).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(blobs, connectivity=8)
    for i in range(1, n):
        if (
            stats[i, cv2.CC_STAT_WIDTH] > max_side
            or stats[i, cv2.CC_STAT_HEIGHT] > max_side
        ):
            conf[labels == i] = 0.0

    # feather so the correction fades in
    fr = max(3, int(face_d * 0.006)) | 1
    conf = cv2.GaussianBlur(conf, (fr, fr), 0)
    return conf, region, face_d, model


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    """Make every component solid. Only the outer contour of each is kept."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(mask)
    cv2.drawContours(out, contours, -1, 1, thickness=cv2.FILLED)
    return out


def decide(conf: np.ndarray, face_d: float) -> np.ndarray:
    """Turn a per-pixel confidence map into solid per-LESION masks.

    Thresholding pixel by pixel is what broke every previous attempt: a lesion
    is a REGION, and a ragged mask full of pinholes makes reconstruction sample
    the blemish in order to repair the blemish — so the mark survives its own
    removal.

    Hysteresis fixes both ends of that with one mechanism. A HIGH bar decides
    *whether* something is a lesion at all; a LOW bar decides *how far that
    lesion extends*. Speckles with no confident core are dropped instead of
    being healed, and a real mark keeps the faint halo that a single threshold
    would have sliced off.
    """
    seed = (conf > 0.60).astype(np.uint8)
    if not seed.any():
        return np.zeros(conf.shape, np.uint8)
    extent = (conf > 0.22).astype(np.uint8)

    count, labels, _, _ = cv2.connectedComponentsWithStats(extent, connectivity=8)
    keep = np.zeros(count, bool)
    keep[np.unique(labels[seed > 0])] = True
    keep[0] = False
    mask = keep[labels].astype(np.uint8)

    r = max(3, int(face_d * 0.010)) | 1
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((r, r), np.uint8))
    mask = _fill_holes(mask)

    # A mark fades at its rim. Covering only the core leaves a visible halo, so
    # the repair region is grown slightly past what was actually detected.
    g = max(2, int(face_d * 0.006)) | 1
    mask = cv2.dilate(mask, np.ones((g, g), np.uint8))

    # Size gate — measured on the CORE, not on the grown region.
    #
    # The gate exists to reject broad skin character the model failed to absorb.
    # Applying it to the grown extent instead punishes hysteresis for doing its
    # job: a real mark assembled into one lesion plus its halo is legitimately
    # larger than the fragments the old threshold produced, and gating on that
    # deleted the very scratch this tool exists to remove. What makes something
    # a blemish is a COMPACT CONFIDENT CORE; how far its halo fades is not
    # evidence either way.
    # ...and measured as AREA and THICKNESS, never as bounding-box side.
    #
    # A bounding box punishes a mark for being LONG. A scratch is long and thin;
    # blush is broad. Gating on the box rejected this photo's scratch at 38x50
    # while its core was only 396px of actual pixels. This is the same error the
    # anti-hair shape gate already made once — elongation is not evidence of
    # innocence. Thickness is: the largest circle that fits inside the mark.
    max_side = max(8, int(face_d * 0.16))
    max_area = max_side * max_side * 0.5
    max_radius = max_side * 0.35
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    for i in range(1, count):
        component = labels == i
        core = (component & (seed > 0)).astype(np.uint8)
        if not core.any():
            mask[component] = 0
            continue
        radius = float(cv2.distanceTransform(core, cv2.DIST_L2, 3).max())
        if core.sum() > max_area or radius > max_radius:
            mask[component] = 0
    return mask


def apply(rgb, params: dict):
    """params: { strength: 0..100 }"""
    strength = common.clamp01(params.get("strength", 60))
    if strength <= 0:
        return rgb, {"spotsRemoved": 0}

    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    if face_d < MIN_FACE_PX:
        return rgb, {"spotsRemoved": 0, "faceTooSmall": 1}

    box = common.region_box(skin, int(face_d * 0.25), rgb.shape)
    if box is None:
        return rgb, {"spotsRemoved": 0}
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1]

    got = confidence(crop, params)
    if got is None:
        return rgb, {"spotsRemoved": 0}
    conf, region, face_c, model = got

    area = float((conf > 0.35).sum())
    if area < 4:
        return rgb, {"spotsRemoved": 0, "correctedPx": 0}

    # --- healing -----------------------------------------------------------
    if str(params.get("mode", "reconstruct")) == "reconstruct":
        # Attenuating `mid` only ever DIMS a mark — its structure survives, which
        # is why every earlier attempt left a ghost. Reconstruction rebuilds what
        # should be under it instead.
        #
        # This gives up the structural blush guarantee that frequency blending
        # had (low was untouched by construction). The size gate above is what
        # replaces it: we only ever reconstruct marks small enough that the ring
        # feeding the diffusion is the same patch of skin — so local blush is
        # reproduced, not averaged away. test_blush.py holds this honest.
        repair = decide(conf, face_c)
        if not repair.any():
            return rgb, {"spotsRemoved": 0, "correctedPx": 0}
        healed, symmetry_used = _heal_with_symmetry(
            crop, repair, conf, region, face_c
        )
        # Reconstruction is all-or-nothing: it replaces what is under the mark.
        # Cross-fading it with the original at the confidence value would leave a
        # proportional ghost of the very thing it rebuilt — which is exactly what
        # a partial blend did here. Apply it fully inside the mask and let a
        # narrow feather hide the seam instead.
        fr = max(3, int(face_c * 0.004)) | 1
        blend = cv2.GaussianBlur(repair.astype(np.float32), (fr, fr), 0)
        blend = np.clip(blend * 1.25, 0.0, 1.0)[..., None]
        out_crop = crop.astype(np.float32) * (1 - blend) + healed.astype(np.float32) * blend
        out = rgb.copy()
        out[y0:y1, x0:x1] = np.clip(out_crop, 0, 255).astype(np.uint8)
        n, _, stats, _ = cv2.connectedComponentsWithStats(repair, connectivity=8)
        return out, {
            "spotsRemoved": max(0, n - 1),
            "correctedPx": int(area),
            "symmetryUsed": symmetry_used,
        }
    else:
        # low is reassembled untouched -> natural colour cannot be neutralised.
        # mid is where the blemish lives -> suppressed by confidence.
        # high is texture -> kept almost entirely, so there is no flat patch.
        c = conf[..., None]
        healed_lab = model.low + model.mid * (1.0 - c) + model.high * (1.0 - c * 0.30)
        healed_lab = np.clip(healed_lab, 0, 255).astype(np.uint8)
        healed = cv2.cvtColor(healed_lab, cv2.COLOR_LAB2RGB)

    blend = np.clip(conf, 0.0, 1.0)[..., None]
    out_crop = (crop.astype(np.float32) * (1 - blend) + healed.astype(np.float32) * blend)

    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(out_crop, 0, 255).astype(np.uint8)

    n, _, stats, _ = cv2.connectedComponentsWithStats(
        (conf > 0.35).astype(np.uint8), connectivity=8
    )
    return out, {"spotsRemoved": max(0, n - 1), "correctedPx": int(area)}
