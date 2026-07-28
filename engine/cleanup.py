"""Skin cleanup — removes blemishes without touching the person's own colour.

Detection: novelty against a per-face skin model (see skinmodel.py). We do not
describe what a flaw looks like; we model the skin and flag what the model
cannot explain — so a mark that is LIGHTER, darker, redder or yellower is all
caught by the same measure. Three gates then separate blemishes from the
face's own structure: a size gate (a blemish is LOCAL; anything broad is skin
character), a line-continuation veto (a blemish is ISOLATED; a component that
is one stretch of a longer line — stray hair, eyeliner, crease — is left
alone, because healing part of a line cuts it and reads as damage), and a
local-evidence veto (a blemish has a BOUNDARY; smooth shading can exceed the
global novelty bar yet has no local structure, and is lighting, not dirt).

Healing (default "reconstruct" mode): diffusion rebuilds tone under the mark,
a nearby clean donor grafts back pore-scale texture (healing.inpaint_texture),
and color_harmonization pins the result to healthy skin beyond the halo.
Symmetry (copying the opposite side of the face) was tried and removed:
facial lighting is never mirror-symmetric, so mirrored patches landed flat
and mis-toned while the donor-free path healed cleanly.

The legacy frequency-separation mode (any other `mode` value) only attenuates
the band blemishes live in — it dims a mark instead of removing it, but its
`low` layer is untouched by construction, so it can never neutralise natural
rosiness. Reconstruct mode replaces that structural guarantee with the size
gate: only marks small enough that the ring feeding the diffusion is the same
patch of skin are ever rebuilt (test_blush.py holds this honest).
"""

import cv2
import numpy as np

import color_harmonization
import common
import healing
import masks
import skinmodel

# A face must be at least this wide (px) for blemish healing to be safe.
MIN_FACE_PX = 180


def _novelty_bar(strength: float) -> float:
    """Detection bar in sigmas of the skin model's Mahalanobis distance.

    Chi-like with 3 dof. strength 0 -> 4.5 sigma (only blatant marks),
    1 -> 1.5 sigma (everything the model cannot explain, including faint
    residue and dry patches).
    """
    return 4.5 - strength * 3.0


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


def _structure_gate(
    crop: np.ndarray,
    repair: np.ndarray,
    face_d: float,
    novelty: np.ndarray,
    novelty_bar: float,
    region: np.ndarray,
) -> tuple[np.ndarray, int, int]:
    """A blemish is ISOLATED. Drop components that are pieces of something.

    Both vetoes test the same principle in different spaces:

    1. Line continuation (structure space). A stray hair, an eyeliner tail
       and a facial crease are all lines, and the detector usually flags only
       their thickest stretch. Healing a stretch of a line cuts it: both
       loose ends stay visible (a hair "broken" mid-air, a liner tip smeared
       off). Black/top-hat ridges over L, a and b trace such structures; if
       the one running through a component continues past its reach, the
       component is a piece of something larger — leave it alone.

    2. Novelty continuation (anomaly space). Soft shading, strong blush and
       other skin character can exceed the model's bar with no boundary
       anywhere — the anomaly just goes on past the healed area, and healing
       its statistical peak leaves a waxy patch in the middle of a gradient.
       A real mark ENDS: the ring just outside its mask is skin the model
       explains. Scale-free, unlike any fixed detection kernel — this is what
       finally caught both a wide soft smudge (ring clean -> heal) and a nose
       flank (ring still novel -> veto) with one rule.

    Symmetry healing was removed on the same evidence pass: facial lighting is
    never mirror-symmetric, so opposite-side patches landed flat and mis-toned
    (and, near the eye, copied the other eye's lashes). Diffusion + texture
    grafting needed no such donor and produced clean repairs everywhere.

    Returns (mask, line_vetoed, shading_vetoed).
    """
    if not repair.any():
        return repair, 0, 0

    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB)
    k = max(5, int(face_d * 0.02)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    seed = np.zeros(repair.shape, bool)
    extent = np.zeros(repair.shape, bool)
    # Chroma deviations are numerically smaller than luminance ones, so the
    # floor drops for a/b — a faint red-pencil line must still register.
    for channel, floor in ((0, 6.0), (1, 4.0), (2, 4.0)):
        plane = lab[..., channel]
        for op in (cv2.MORPH_BLACKHAT, cv2.MORPH_TOPHAT):
            resp = cv2.morphologyEx(plane, op, kernel).astype(np.float32)
            med = float(np.median(resp))
            sigma = 1.4826 * float(np.median(np.abs(resp - med)))
            # Hysteresis, same as decide(): the high bar says "this is real
            # structure", the low bar follows how far it runs. A crease or
            # hair softens along its length; a single threshold would break
            # it there and hide the continuation.
            seed |= resp > max(floor, med + 6.0 * sigma)
            extent |= resp > max(floor * 0.5, med + 3.0 * sigma)
    # Bridge pixel-scale gaps so one hair stays one structure even where its
    # contrast dips below threshold for a moment.
    seed = cv2.dilate(seed.astype(np.uint8), np.ones((3, 3), np.uint8))
    extent = cv2.dilate(extent.astype(np.uint8), np.ones((3, 3), np.uint8))
    extent = np.maximum(extent, seed)

    r_count, r_labels = cv2.connectedComponents(extent, connectivity=8)
    totals = np.bincount(r_labels.ravel(), minlength=max(2, r_count))

    # The novelty a ring must stay under to count as "the mark ended here":
    # halfway from the region's own baseline to the detection bar. Clean skin
    # sits at the baseline; a continuing gradient sits near the bar.
    usable = region > 0.35
    baseline = float(np.median(novelty[usable])) if usable.any() else 0.0
    margin = max(0.5, novelty_bar - baseline)
    ring_bar = baseline + 0.5 * margin
    grow_bar = baseline + 0.25 * margin
    ring_w = max(3, int(face_d * 0.015))

    def ring_novelty(component: np.ndarray) -> float | None:
        inner = cv2.dilate(component, np.ones((3, 3), np.uint8)) > 0
        outer = (
            cv2.dilate(component, np.ones((ring_w, ring_w), np.uint8), iterations=2) > 0
        )
        ring = outer & ~inner & usable
        if ring.sum() < 16:
            return None
        # Median, not mean: a second real blemish nearby elevates part of the
        # ring; a continuing gradient elevates all of it.
        return float(np.median(novelty[ring]))

    out = repair.copy()
    line_vetoed = 0
    shading_vetoed = 0
    grow = np.ones((7, 7), np.uint8)
    step = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    n, labels, _, _ = cv2.connectedComponentsWithStats(repair, connectivity=8)
    for i in range(1, n):
        component = (labels == i).astype(np.uint8)

        rn = ring_novelty(component)
        if rn is not None and rn > ring_bar:
            out[component > 0] = 0
            shading_vetoed += 1
            continue

        reach = cv2.dilate(component, grow) > 0
        inside = np.bincount(r_labels[reach], minlength=r_count)
        # Only structures that actually RUN THROUGH the component can veto it.
        # A neighbouring crease that merely brushes the reach ring must not
        # condemn an isolated mark sitting next to it.
        engaged = max(6, int(0.05 * component.sum()))
        line_hit = False
        for rid in np.nonzero(inside[1:])[0] + 1:
            if inside[rid] < engaged:
                continue
            outside = int(totals[rid] - inside[rid])
            if outside > max(8, int(0.6 * inside[rid])):
                out[component > 0] = 0
                line_vetoed += 1
                line_hit = True
                break
        if line_hit:
            continue

        # Heal to where the anomaly ends. A soft mark (smudge, faded bruise)
        # holds most of its area in a skirt below the detector's extent bar;
        # covering only the confident core heals the mark into a paler copy
        # of itself. The kept component grows while the ring outside it is
        # still novel — the same isolation measure that vetoes, now steering
        # the boundary — capped so a mistake cannot swallow a cheek.
        for _ in range(max(3, int(face_d * 0.02))):
            rn = ring_novelty(component)
            if rn is None or rn <= grow_bar:
                break
            grown = cv2.dilate(component, step)
            grown[~usable] = 0
            if int(grown.sum()) == int(component.sum()):
                break
            component = grown
        out = np.maximum(out, component)
    return out, line_vetoed, shading_vetoed


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

    lo = _novelty_bar(strength)
    hi = lo + 1.6

    def score(m: skinmodel.SkinModel) -> np.ndarray:
        c = np.clip((m.novelty - lo) / (hi - lo), 0.0, 1.0)
        c = c * c * (3 - 2 * c)  # smoothstep: no hard edges
        return c * region

    conf = score(model)

    # Second pass: the smooth field was estimated WITH the marks still in the
    # image, so a broad soft mark bends the field toward itself — it partially
    # explains its own skirt, which then scores just under the bar and
    # survives healing as a paler copy of the mark. Re-estimate the model with
    # the suspicious pixels excluded from the sample, and score again — but
    # only NEAR first-pass suspicion. Re-scoring the whole face with the
    # sharper model surfaces a crop of brand-new borderline detections
    # (measured: components merged across marks and line-veto counts doubled);
    # refinement's job is completing marks already found, not finding more.
    # Blush is unaffected either way: it never crosses the bar, so it keeps
    # feeding the field.
    suspect = (conf > 0.25).astype(np.uint8)
    if suspect.any():
        sr = max(3, int(face_d * 0.02)) | 1
        suspect = cv2.dilate(suspect, np.ones((sr, sr), np.uint8))
        clean_support = np.clip(support - suspect.astype(np.float32), 0.0, 1.0)
        nr = max(3, int(face_d * 0.05)) | 1
        neighborhood = cv2.dilate(suspect, np.ones((nr, nr), np.uint8))
        refined = score(skinmodel.build(rgb, region, face_d, support=clean_support))
        conf = np.where(neighborhood > 0, refined, conf)
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


def hysteresis_core(conf: np.ndarray) -> np.ndarray:
    """Tight per-lesion mask: extent pixels connected to a confident seed.

    Hysteresis fixes both ends of single-threshold detection with one
    mechanism. A HIGH bar decides *whether* something is a lesion at all; a
    LOW bar decides *how far that lesion extends*. Speckles with no confident
    core are dropped instead of being healed, and a real mark keeps the faint
    halo that a single threshold would have sliced off.

    This is deliberately BEFORE any morphological closing: the structure gate
    must judge each detection alone. Closing first merged a mark with nearby
    hair fragments into one component, and the fragment's line veto then
    condemned the mark it happened to touch.
    """
    seed = (conf > 0.60).astype(np.uint8)
    if not seed.any():
        return np.zeros(conf.shape, np.uint8)
    extent = (conf > 0.22).astype(np.uint8)

    count, labels, _, _ = cv2.connectedComponentsWithStats(extent, connectivity=8)
    keep = np.zeros(count, bool)
    keep[np.unique(labels[seed > 0])] = True
    keep[0] = False
    return keep[labels].astype(np.uint8)


def decide(conf: np.ndarray, face_d: float, mask: np.ndarray | None = None) -> np.ndarray:
    """Turn gated tight lesions into solid, slightly grown repair regions.

    Thresholding pixel by pixel is what broke every previous attempt: a lesion
    is a REGION, and a ragged mask full of pinholes makes reconstruction sample
    the blemish in order to repair the blemish — so the mark survives its own
    removal.

    `mask` is normally the structure-gated hysteresis core; when omitted the
    raw core is used (diagnostic scripts call it this way).
    """
    if mask is None:
        mask = hysteresis_core(conf)
    if not mask.any():
        return np.zeros(conf.shape, np.uint8)
    seed = (conf > 0.60).astype(np.uint8)

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
        core = hysteresis_core(conf)
        core, line_vetoed, shading_vetoed = _structure_gate(
            crop, core, face_c, model.novelty, _novelty_bar(strength), region
        )
        repair = decide(conf, face_c, core)
        if not repair.any():
            return rgb, {
                "spotsRemoved": 0,
                "correctedPx": 0,
                "lineVetoed": line_vetoed,
                "shadingVetoed": shading_vetoed,
            }
        healed = healing.inpaint_texture(
            crop, repair, (region > 0.35).astype(np.uint8)
        )
        # Colour and texture have different boundaries.  The reconstructed core
        # supplies content/pores, while direct boundary correspondences find
        # healthy local skin beyond any contaminated halo and constrain a
        # spatially varying colour correction.  The harmonizer performs its own
        # narrow texture transition; a second generic feather here would erase
        # the direct colour relationship it just established.
        harmonized = color_harmonization.harmonize(
            crop,
            healed,
            repair,
            region,
            conf,
            face_c,
            color_harmonization.HarmonizationConfig.from_params(params),
        )
        out_crop = harmonized.image
        out = rgb.copy()
        out[y0:y1, x0:x1] = out_crop
        n, _, stats, _ = cv2.connectedComponentsWithStats(repair, connectivity=8)
        return out, {
            "spotsRemoved": max(0, n - 1),
            "correctedPx": int((repair > 0).sum()),
            "lineVetoed": line_vetoed,
            "shadingVetoed": shading_vetoed,
            "colorHarmonization": harmonized.metadata,
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
