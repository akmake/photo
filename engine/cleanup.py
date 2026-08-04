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

import dataclasses

import cv2
import numpy as np

import color_harmonization
import common
import healing
import masks
import pigment
import shape
import skinmodel
import specular

# A face must be at least this wide (px) for blemish healing to be safe.
MIN_FACE_PX = 180

# `_fluid_trails` is ON. It was switched off for two measured reasons, and both
# are now fixed rather than tolerated.
#
# 1. IT COULD REACH AN EYE. On a 290px face it rewrote 111 RGB units across a
#    child's lower eyelid, and on a baby its three largest candidates were the
#    LEFT EYE, the RIGHT EYE and a NOSTRIL — saved only by the runs-downward gate
#    at 0.45 against a 0.55 bar. A 0.10 margin in one parameter is not a safety
#    mechanism. Fixed by withholding `face-eye-region` from its search zone
#    (NOT `face-anatomy`, which would take the lips with it — see the call site).
#    Verified: with the pass ON, eye-region damage on that face is identical to
#    having it OFF (mean 0.45, max 10.7) while it still fires. It is no longer
#    "narrowly declined to touch the eye"; it cannot.
#
# 2. IT FOUND NOTHING. It returned 0 on a real, plainly visible drool strand
#    running down a baby's chin — the exact case it exists for. The cause was not
#    the thresholds: a strand GLINTS where it catches light and nearly disappears
#    between glints, so a single bar returned the glints and dropped the trail
#    joining them, and each fragment was then judged alone — 27, 33 and 35px
#    against a 129px minimum, each also failing the orifice anchor because no
#    fragment reached the lip. It detected the drool and rejected it four times
#    for being in pieces. This is the SAME failure `hysteresis_core` was written
#    to fix for lesions ("a lesion is a REGION, the decision was per-pixel"),
#    found again in a second place. Fixed the same way.
FLUID_TRAILS_ENABLED = True

# Mean width a strand may reach, as a fraction of face_d. A hanging fluid ENDS
# IN A DROPLET and the droplet inflates area/length, which is why 0.02 rejected
# the real 321A1809 drool (11.4 against an 11.0 bar) and the bar was raised to
# 0.03. It then rejected the SAME drool a second time, at 8.28 against 7.77,
# once the detector was moved onto the undoctored crop -- a 6% margin in one
# parameter, which this file says elsewhere is not a mechanism.
#
# 0.035 was held back for a while on the belief that it cost three false
# positives on 321A1770. IT DOES NOT, and the belief came from reading counts
# instead of images: the largest of those three is a REAL drool on the baby in
# that frame, plainly visible on the lip and chin of the original and cleanly
# removed. The others are a faint wet chin and a change invisible at 1:1 on the
# father. Every "false positive" that was actually checked turned out to be
# fluid, in a niche where photographing drooling babies is the daily case.
#
# Separately measured and rejected as a discriminator: nothing in the strand's
# geometry tells the drool apart from a shine streak. Real drool and the
# doubtful components overlap on distance-to-orifice (1.0px both), brightness
# over the ring (+18.0 vs +11.0 to +15.0), downward fraction (0.87 vs 0.83-0.98)
# and run length (0.21fw vs 0.06-0.23fw). There is no bar to find, which is why
# this is a threshold and not a test.
#
# The window is bounded on BOTH sides and both bounds are measured, so this is
# not a free parameter: below 0.0320 the 1809 drool is rejected, and at 0.0350
# test_cleanup_recall fails on 321A5173 with 1,677px of collateral against an
# 800px cap. 0.034 sits inside that window with margin at each end.
FLUID_MAX_WIDTH = 0.034

# What counts as "structure" for the line veto is calibrated on the SKIN, at a
# fixed RANK — not at a fixed Lab amplitude, and not from a robust sigma.
#
# The old bar was max(floor, median + k*MAD) over the whole crop, and it was
# degenerate: a morphological tophat/blackhat is exactly zero across most of a
# face, so median = 0 AND MAD = 0, and the statistical term collapsed to 0.00.
# Only the absolute floor ever survived — and an absolute Lab amplitude is not
# the same evidence at every resolution, because a small face carries pore and
# sensor noise at the same amplitude that real structure carries on a large
# one. Measured across face_d 188/196/473/729 the old bar admitted 36.4%,
# 29.9%, 13.3% and 2.7% of heal-eligible skin as "structure": on a small face
# a third of the cheek was a line, and one percolated component then vetoed
# every mark that touched it.
#
# A rank over eligible skin is scale-free by construction: the same fraction
# of the skin is the strongest, whatever the resolution. Same four faces at
# RIDGE_EXTENT_PCT: 5.6%, 6.3%, 4.8%, 6.9% — and, just as necessary, an
# injected hair is traced 93.8% to 100% at every size instead of vanishing
# from the map entirely on the small one. See _ridge_bars for why the rank has
# to run over ALL skin pixels and not only the responding ones.
RIDGE_EXTENT_PCT = 99.0
RIDGE_SEED_PCT = 99.7

# Half-thickness a ridge component may reach and still be allowed to veto, as
# a fraction of face_d. A stray hair on a 270px face measures ~1-2px across;
# an eyeliner tail and a nasolabial crease stay under ~2% of the face. The
# percolated blob that condemned three marks on 321A4934 was far thicker than
# its own face. 0.02 keeps every real line and rejects the blob.
RIDGE_MAX_THICK = 0.02

# ...and LONG. A stray hair, an eyeliner tail and a nasolabial fold all run a
# good fraction of the face; that is what makes cutting one visible. A mark's
# own morphological response does not: measured on 321A5254, the injected
# bright crumb produced its own tophat ridge (35 against a 21 bar) of 56px,
# ~7px long on a 475px face, and that ridge was allowed to condemn the mark it
# came from. The veto was reading the blemish as evidence against itself.
# Length is estimated as area / width, which is what a ridge is.
RIDGE_MIN_LEN = 0.10

# ...but a GROOVE is thicker than a hair, and the thickness bar above was
# calibrated only on hairs and eyeliner. A nasolabial fold measured 5.6px on a
# 180px face (3.1%) and 8.2px on a 359px face (2.3%) — both over RIDGE_MAX_THICK,
# so the fold lost the right to veto and the healer cut it. Measured end to end
# before this existed: mean change ON the fold against ordinary skin ran 8.6x,
# 13.3x and 9.3x on three smiling faces.
#
# A papule sits in that same thickness range, so raising the bar alone would
# hand the veto to every blemish. What separates them is ELONGATION, and it is
# scale-free: for a disc, length/thickness = pi/2 ~ 1.57 at any size; for a line
# it is its aspect ratio. Measured on real folds: 22.3, 11.3, 15.8.
#
# So thickness stays the fast path for hairs, and a thicker component may still
# veto if it is unmistakably a line. The absolute ceiling remains, because the
# percolated noise blob this whole admission test exists to reject (235,270px on
# a 272px face) must never come back.
RIDGE_MIN_ELONGATION = 6.0
RIDGE_ABS_MAX_THICK = 0.05

# How much of a detection must lie on a measured crease before the detection is
# judged to BE that crease. Half: a mark beside a fold overlaps it slightly and
# must still be healed; a detection whose majority is the fold is the fold.
CREASE_OVERLAP_DROP = 0.5

# ...and overlap alone is not enough, for the reason RIDGE_MIN_LEN already
# documents: a mark generates its OWN morphological response, so a detection can
# sit on a "crease" that is nothing but its own shadow. Measured — with overlap
# as the only test, the injected dark-speck on 321A5173 was vetoed by its own
# response and recall fell 4/5 -> 2/5.
#
# The second test is the SHAPE OF THE DETECTION, which is the one thing the two
# cases never share. A blemish lying on a fold is still a blemish: compact,
# elongation ~1.6. A detection that has traced the fold is long and thin. Same
# scale-free measure as CREASE_MIN_ELONGATION in pigment.py, now applied to the
# repair component rather than to the ridge.
#
# Tried and rejected first: "the crease must extend several times past the
# detection". It cannot separate these cases, because a detection that traced
# the fold is ITSELF long, so the ratio collapses — measured, it let both folds
# back through (11.2x and 6.6x) while still vetoing the compact speck.
CREASE_REPAIR_ELONGATION = 3.0



@dataclasses.dataclass
class Detection:
    """What `confidence` measured about one face.

    Unpacks as the 4-tuple it used to be — `conf, region, face_d, model = got`
    still works, and every diagnostic script in this folder relies on that. The
    extra field is additive: `debris` is the bright-crumb detector's own map,
    kept so a candidate can be LABELLED by which detector found it instead of
    re-deriving that from its shape (a second heuristic that could disagree
    with the first is exactly the drift this module keeps fixing).
    """

    conf: np.ndarray
    region: np.ndarray
    face_d: float
    model: "skinmodel.SkinModel"
    debris: np.ndarray

    def __iter__(self):
        return iter((self.conf, self.region, self.face_d, self.model))


@dataclasses.dataclass
class Candidate:
    """One thing the detector found, and what the engine decided about it.

    `mask` is not a hint or a bounding shape: it is EXACTLY the region healing
    would rebuild if this candidate is treated. That is what lets the lab draw
    an outline and promise that the outline is the edit — see `_fill_holes` for
    why a contour is a lossless description of it.

    verdict:
      heal     — the engine treats it on its own
      line     — vetoed: it is one stretch of a longer line (hair, liner, crease)
      shading  — vetoed: the anomaly does not end, so it is lighting or blush
      size     — dropped by the size gate: too broad/thick to be a blemish
    """

    kind: str  # 'spot' | 'debris' | 'fluid'
    verdict: str
    mask: np.ndarray
    facts: dict


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
        if int(stats[index, cv2.CC_STAT_AREA]) > max_area:
            continue
        # The two bounding-box side tests that used to be here were redundant
        # with the radius test below AND stricter than it in the wrong way: a box
        # grows with a component's DIAGONAL, so a crumb lying at an angle was
        # rejected for being tilted. Area bounds how much there is; the distance
        # transform bounds how fat it is; the box measured neither.
        if shape.describe(component).thickness_max > 2.0 * max_radius:
            continue
        out[component] = 1.0

    if out.any():
        # A one-pixel highlight would disappear below decide()'s 0.60 seed after
        # feathering. Give accepted debris a tiny solid core; decide() still
        # controls its final halo and size.
        out = cv2.dilate(out, np.ones((3, 3), np.uint8))
        out *= region
    return out


def _orifice_context(rgb: np.ndarray):
    """Where fluids come from, and which way they run.

    Returns (orifice_mask, anchor_mask, down_field) at full resolution — the
    filled eye/nostril/mouth outlines of every detected face, the subset of
    those a trail may be ANCHORED to, and a per-pixel unit vector pointing
    "down the face" (eyes toward mouth). The field is written per face over its
    own disc, so a lying-down child keeps their own gravity even when a sibling
    stands upright in the same frame.

    The two masks differ by THE EYES, and the split is why they are separate.
    `orifice` must keep them: it is what carves the eye openings out of the
    search zone. `anchor` must not, and that is measured — with the eyes
    anchoring trails, every bright vertical strip of skin beside them qualified
    as a tear. On two dry faces the detector returned 5 and 3 "fluids", each one
    a shine streak on the temple or the strip between the eye and the peyot, and
    each one then rewrote the lower lid rim by up to 52 levels. That is the
    damage the user reported from the delivered images, and it is a precision
    failure, not a masking one: the strands really do run downward from
    something the code was told is an orifice.

    Cost of the split: a genuine tear track is no longer detected. It never was
    validated — the one real fluid in the corpus is drool from a lip — and a
    detector that invents 4 fluids per dry face to catch a case nobody has
    demonstrated is not worth its false-positive rate.
    """
    h, w = rgb.shape[:2]
    orifice = np.zeros((h, w), np.uint8)
    anchor = np.zeros((h, w), np.uint8)
    down = np.zeros((h, w, 2), np.float32)
    faces = masks._face_landmarks(rgb)
    for lm in faces or []:
        def pt(i):
            return np.array([lm[i].x * w, lm[i].y * h], np.float32)

        fw = float(np.linalg.norm(pt(masks.FACE_RIGHT) - pt(masks.FACE_LEFT)))
        if fw < 40:
            continue
        pts = lambda idx: np.array([pt(i) for i in idx], np.int32)
        cv2.fillConvexPoly(orifice, cv2.convexHull(pts(masks.LIPS)), 255)
        cv2.fillConvexPoly(anchor, cv2.convexHull(pts(masks.LIPS)), 255)
        cv2.fillConvexPoly(orifice, cv2.convexHull(pts(masks.LEFT_EYE)), 255)
        cv2.fillConvexPoly(orifice, cv2.convexHull(pts(masks.RIGHT_EYE)), 255)
        for ala in masks.NOSE_ALA:
            c = pt(ala)
            cv2.circle(orifice, (int(c[0]), int(c[1])), max(2, int(fw * 0.025)), 255, -1)
            cv2.circle(anchor, (int(c[0]), int(c[1])), max(2, int(fw * 0.025)), 255, -1)

        eye_c = (np.mean([pt(i) for i in masks.LEFT_EYE], axis=0)
                 + np.mean([pt(i) for i in masks.RIGHT_EYE], axis=0)) / 2
        mouth_c = (pt(masks.MOUTH_CORNERS[0]) + pt(masks.MOUTH_CORNERS[1])) / 2
        vec = mouth_c - eye_c
        n = float(np.linalg.norm(vec))
        if n < 1:
            continue
        vec /= n
        centre = ((eye_c + mouth_c) / 2).astype(int)
        disc = np.zeros((h, w), np.uint8)
        cv2.circle(disc, (int(centre[0]), int(centre[1])), int(fw * 1.2), 255, -1)
        down[disc > 0] = vec
    return orifice, anchor, down


def _fluid_trails(
    crop: np.ndarray,
    face_d: float,
    orifice: np.ndarray,
    anchor_src: np.ndarray,
    down_field: np.ndarray,
    skin_zone: np.ndarray,
) -> tuple[np.ndarray, int]:
    """Direct detector for the one blemish class the skin model cannot see.

    A drool strand (or a tear track, or a runny nose) hangs exactly inside the
    lip/eye-adjacent band that the anatomy exclusion blanks — that band is a
    chronic false-positive zone for the generic detector, so the fluid never
    becomes a candidate at all (measured on 321A1809: novelty 128 on the
    strand, region 0.0, conf 0.0). So this class gets its own detector, on its
    own physics: a fluid trail is a thin BRIGHT ridge with the skin's own hue,
    anchored at an orifice, running down the face, and ENDING in open skin.
    Hair fails the anchor; the philtrum fails the thinness; a necklace or a
    collar edge leaves the search zone and fails the termination.

    Returns (heal mask, count).
    """
    h, w = crop.shape[:2]
    out = np.zeros((h, w), np.uint8)
    ow = max(3, int(face_d * 0.05))
    # mouth and nostrils only — see _orifice_context for why the eyes are out
    anchor_zone = cv2.dilate(anchor_src, np.ones((ow, ow), np.uint8)) > 0
    # 0.55, not less: a hanging drool reaches half a face-width below the lip
    # (measured 120px on a 250px face — 0.28 put the rim mid-strand and the
    # rim-exit rule rejected the real drool)
    zr = max(7, int(face_d * 0.55)) | 1
    reach = cv2.dilate(orifice, np.ones((zr, zr), np.uint8)) > 0
    zone = reach & (orifice == 0) & (skin_zone > 0.35)
    if int(zone.sum()) < 64:
        return out, 0

    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB)
    k = max(5, int(face_d * 0.02)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    top = cv2.morphologyEx(lab[..., 0], cv2.MORPH_TOPHAT, kernel).astype(np.float32)
    med = float(np.median(top[zone]))
    sigma = 1.4826 * float(np.median(np.abs(top[zone] - med))) + 1e-6
    # floored like the structure gate's L channel: on a smooth baby cheek the
    # median tophat is exactly 0, the MAD is 0, and an unfloored bar admits
    # the whole zone as one giant "strand"
    # HYSTERESIS, for the same reason `hysteresis_core` exists for lesions — and
    # it is the same bug, found again in a second place.
    #
    # A drool strand is not uniformly bright: it glints where it catches the light
    # and nearly vanishes between the glints. A single threshold therefore returns
    # the glints and drops the trail connecting them, and every fragment is then
    # judged ALONE — measured on a real, plainly visible strand running down a
    # baby's chin, it broke into pieces of 27, 33 and 35px against a 129px minimum
    # area, each one also failing the orifice-anchor test because no single
    # fragment reaches the lip. The detector found the drool and then rejected it
    # four times over for being in pieces.
    #
    # High bar decides WHETHER there is a strand; low bar decides HOW FAR it runs.
    seed = ((top > max(6.0, med + 4.0 * sigma)) & zone).astype(np.uint8)
    if not seed.any():
        return out, 0
    extent = ((top > max(2.0, med + 1.5 * sigma)) & zone).astype(np.uint8)

    # Bridge along the direction a fluid actually travels. A vertical structuring
    # element joins glints separated by a dim stretch of the same strand without
    # merging two neighbouring strands sideways into one blob.
    bridge = max(3, int(face_d * 0.03)) | 1
    extent = cv2.morphologyEx(
        extent, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (1, bridge))
    )
    count, labels, _, _ = cv2.connectedComponentsWithStats(extent, connectivity=8)
    keep = np.zeros(count, bool)
    keep[np.unique(labels[seed > 0])] = True
    keep[0] = False
    strands = keep[labels].astype(np.uint8)
    strands = cv2.morphologyEx(strands, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    # the outer rim of the search zone: anything still bright THERE keeps
    # going beyond the zone and is not a fluid that ended on the chin
    rim = reach & ~cv2.erode(reach.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)

    found = 0
    n, labels, stats, _ = cv2.connectedComponentsWithStats(strands, connectivity=8)
    for i in range(1, n):
        comp = labels == i
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < max(16, int(face_d * 0.5)) or area > int(face_d * face_d * 0.01):
            continue
        # Thin and elongated — a strand, not a patch of shine. Measured with
        # `shape.describe`, NOT from the bounding box: a strand runs down AND
        # sideways, so max(box_w, box_h) is shorter than the strand and
        # `area / that` reports the thinnest object on the face as too wide.
        # That is what rejected this project's only validated drool, twice.
        # `thickness_typ` is a median over the distance transform, so it is
        # blind to orientation and curvature and ignores the droplet at the end.
        geom = shape.describe(comp)
        if geom.length < face_d * 0.05 or geom.thickness_typ > face_d * FLUID_MAX_WIDTH:
            continue
        anchor = comp & anchor_zone
        if not anchor.any() or (comp & rim).any():
            continue
        # the skin's own hue — shine, not pigment
        rw = max(3, int(face_d * 0.015))
        ring = (
            cv2.dilate(comp.astype(np.uint8), np.ones((rw, rw), np.uint8), iterations=2) > 0
        ) & ~comp & (skin_zone > 0.35)
        if ring.sum() < 16:
            continue
        da = abs(float(np.median(lab[..., 1][comp])) - float(np.median(lab[..., 1][ring])))
        db = abs(float(np.median(lab[..., 2][comp])) - float(np.median(lab[..., 2][ring])))
        if da + db > 14.0:
            continue
        # runs down the face from its anchor
        ay, ax = np.nonzero(anchor)
        a_pt = np.array([ax.mean(), ay.mean()], np.float32)
        vec = down_field[int(a_pt[1]), int(a_pt[0])]
        if float(np.linalg.norm(vec)) < 0.5:
            continue
        sy, sx = np.nonzero(comp)
        proj = (sx - a_pt[0]) * vec[0] + (sy - a_pt[1]) * vec[1]
        if (proj > 0).mean() < 0.55:
            continue
        out = np.maximum(out, cv2.dilate(comp.astype(np.uint8), np.ones((5, 5), np.uint8)))
        found += 1
    return out, found


def _ridge_bars(
    resp: np.ndarray, sample: np.ndarray, floor: float
) -> tuple[float, float]:
    """(seed bar, extent bar) for one morphological response plane.

    Ranks are taken over EVERY heal-eligible skin pixel, zeros included. That
    choice is the whole point: the quantity that has to be constant across
    resolutions is "what fraction of the SKIN counts as structure", and a rank
    over all skin pixels controls exactly that. Ranking the positive responses
    instead controls the fraction of RESPONDING pixels, which is a different
    thing on every face — a tophat is zero wherever the neighbourhood is flat,
    and a small face is smooth almost everywhere, so the same rank landed far
    higher there. Measured, positives-only at P99 against all-pixels at P99:

        face_d   cov  traced      cov  traced
          197   1.8%    0.0%     6.3%   93.8%
          474   3.3%   99.6%     4.8%  100.0%
          729   5.3%   98.8%     6.9%   99.6%

    The left column is the failure this whole gate suffers from: on the small
    face the injected hair was not in the ridge map AT ALL, so nothing could
    veto healing a stretch of it.

    The absolute floors stay as a MINIMUM. They are inactive at these ranks on
    every face measured, but they keep a flawless face from promoting its own
    noise: a rank always returns something, even when nothing on the skin is
    structure at all.
    """
    v = resp[sample]
    if v.size < 64:
        return max(floor, 0.0), max(floor * 0.5, 0.0)
    seed = max(floor, float(np.percentile(v, RIDGE_SEED_PCT)))
    extent = max(floor * 0.5, float(np.percentile(v, RIDGE_EXTENT_PCT)))
    return seed, extent


def _structure_gate(
    crop: np.ndarray,
    repair: np.ndarray,
    face_d: float,
    novelty: np.ndarray,
    novelty_bar: float,
    region: np.ndarray,
    orifice: np.ndarray | None = None,
    down_field: np.ndarray | None = None,
    report: list | None = None,
) -> tuple[np.ndarray, int, int, int]:
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

    `report`, when a list is passed, receives one record per component: the
    verdict, the numbers behind it, and the component's own mask. Counts alone
    were enough while the only consumer was a log line, and not enough the
    moment a person has to see WHICH mark was withheld and decide whether the
    veto was right — a veto that fires invisibly is indistinguishable from a
    detector that found nothing. Vetoed records carry the component BEFORE the
    growth loop: growth is driven by the same ring measure that produced the
    shading veto, so growing a vetoed component would inflate exactly the mark
    the engine already judged not to be a mark.

    A line-vetoed component gets one second chance: the WET-TRAIL test. Fluids
    on a face — drool, tears, a runny nose — leave a thin BRIGHT strand with
    the skin's own hue, anchored at an orifice and running down the face, and
    ending in open skin. A hair shares none of that anchor: hair never grows
    out of a lip. A component whose strand passes all five checks is healed —
    the WHOLE strand, not just the detected stretch, because healing part of a
    line is exactly the mid-air break the veto exists to prevent.

    Returns (mask, line_vetoed, shading_vetoed, wet_trails).
    """
    if not repair.any():
        return repair, 0, 0, 0

    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB)
    k = max(5, int(face_d * 0.02)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    seed = np.zeros(repair.shape, bool)
    extent = np.zeros(repair.shape, bool)
    top_l = black_l = None
    # The bars are calibrated on heal-eligible skin — the population the veto
    # actually judges — but applied to the whole crop, so a hair traced from
    # the cheek keeps running into the hairline where it belongs.
    sample = region > 0.35
    # Chroma deviations are numerically smaller than luminance ones, so the
    # floor drops for a/b — a faint red-pencil line must still register.
    for channel, floor in ((0, 6.0), (1, 4.0), (2, 4.0)):
        plane = lab[..., channel]
        for op in (cv2.MORPH_BLACKHAT, cv2.MORPH_TOPHAT):
            resp = cv2.morphologyEx(plane, op, kernel).astype(np.float32)
            if channel == 0:
                # kept for the wet-trail polarity check: shine is a TOPHAT
                # ridge, hair and creases are BLACKHAT
                if op == cv2.MORPH_TOPHAT:
                    top_l = resp
                else:
                    black_l = resp
            # Hysteresis, same as decide(): the high bar says "this is real
            # structure", the low bar follows how far it runs. A crease or
            # hair softens along its length; a single threshold would break
            # it there and hide the continuation. Both bars are ranks on the
            # skin's own response — see RIDGE_EXTENT_PCT for why the old
            # median+MAD form was degenerate.
            seed_bar, extent_bar = _ridge_bars(resp, sample, floor)
            seed |= resp > seed_bar
            extent |= resp > extent_bar
    # Bridge pixel-scale gaps so one hair stays one structure even where its
    # contrast dips below threshold for a moment.
    seed = cv2.dilate(seed.astype(np.uint8), np.ones((3, 3), np.uint8))
    extent = cv2.dilate(extent.astype(np.uint8), np.ones((3, 3), np.uint8))
    extent = np.maximum(extent, seed)

    # The two bars were computed and then never actually joined: `extent` was
    # used for the components directly, so pixels that merely cleared the LOW
    # bar could form their own structure with no confident evidence anywhere
    # in it. That is what a noise web is — and one such web is enough to veto
    # every mark it touches. Hysteresis is the missing half: the low bar
    # describes how far a structure runs, it does not get to declare one.
    # Measured on the 197px face: coverage 6.8% -> 4.7% of eligible skin with
    # the injected hair still traced (90.7% -> 82.5%).
    r_count, r_labels = cv2.connectedComponents(extent, connectivity=8)
    if seed.any():
        keep = np.zeros(max(2, r_count), bool)
        keep[np.unique(r_labels[seed > 0])] = True
        keep[0] = False
        extent = keep[r_labels].astype(np.uint8)

    r_count, r_labels = cv2.connectedComponents(extent, connectivity=8)
    totals = np.bincount(r_labels.ravel(), minlength=max(2, r_count))

    # --- only a THIN ridge may veto -----------------------------------------
    #
    # The veto asks "does this structure continue past the component?" and
    # never asks "is this a LINE at all?". On a small face that question has
    # only one answer: pores and sensor noise produce morphology responses the
    # size of real structure, the 3x3 bridge joins them, and the ridge map
    # percolates into one blob. Measured on 33/321A4934 (face_d 272): the
    # accusing component held 235,270px against a face whose whole skin area
    # is ~74,000 — three times the face — and it condemned three of the five
    # injected marks. A blob that spans a third of the cheek "continues past"
    # everything.
    #
    # What a stray hair, an eyeliner tail and a crease all share is that they
    # are THIN. So thickness is the admission test: the largest circle that
    # fits inside the ridge component must be small next to the face. This is
    # the mirror image of the rule already written into decide() — there,
    # elongation is not evidence of innocence; here, breadth is not evidence
    # of guilt.
    max_ridge_half = max(1.5, face_d * RIDGE_MAX_THICK)
    abs_max_half = max(2.0, face_d * RIDGE_ABS_MAX_THICK)
    min_ridge_len = max(6.0, face_d * RIDGE_MIN_LEN)
    ridge_thick = cv2.distanceTransform(extent, cv2.DIST_L2, 5)
    can_veto = np.zeros(max(2, r_count), bool)
    for rid in range(1, r_count):
        sel = r_labels == rid
        if not sel.any():
            continue
        half = float(ridge_thick[sel].max())
        if half > abs_max_half:
            continue  # a percolated blob, not a line, at any aspect ratio
        length = float(sel.sum()) / max(1.0, 2.0 * half + 1.0)
        if half > max_ridge_half:
            # thicker than a hair — admitted only as an unmistakable line
            if length / max(1.0, half) < RIDGE_MIN_ELONGATION:
                continue
        can_veto[rid] = length >= min_ridge_len

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

    near_orifice = None
    if orifice is not None and orifice.any():
        # the drool hangs from BELOW the vermilion the landmarks trace — the
        # anchor zone must reach past that gap (0.02 measured too short)
        ow = max(3, int(face_d * 0.05))
        near_orifice = cv2.dilate(orifice, np.ones((ow, ow), np.uint8)) > 0

    def wet_trail(rid: int, comp: np.ndarray):
        """The five checks, judged in a LOCAL window around the component.

        A fluid trail fits the window whole; a hair or a scenery-scale shadow
        web — the 445k-px structure that merges half the crop at the extent
        bar — leaves through the window's edge, which doubles as the
        termination check. Returns the heal mask for a fluid trail, or None.
        """
        if near_orifice is None or down_field is None:
            return None
        cys, cxs = np.nonzero(comp)
        pad = int(face_d * 0.40)
        wy0 = max(0, int(cys.min()) - pad)
        wy1 = min(repair.shape[0], int(cys.max()) + pad + 1)
        wx0 = max(0, int(cxs.min()) - pad)
        wx1 = min(repair.shape[1], int(cxs.max()) + pad + 1)
        sl = np.s_[wy0:wy1, wx0:wx1]
        strand = r_labels[sl] == rid
        if not strand.any():
            return None
        no = near_orifice[sl]
        us = usable[sl]

        # termination: the strand may touch the window edge only inside the
        # orifice zone (its anchor side). Any other exit means it is a piece
        # of something longer — exactly what the veto protects.
        border = np.zeros_like(strand)
        border[0, :] = border[-1, :] = True
        border[:, 0] = border[:, -1] = True
        if (strand & border & ~no).any():
            return None
        # (3) anchored at an orifice
        anchor = strand & no
        if not anchor.any():
            return None
        # (1) bright ridge — shine, not pigment or shadow
        top_w, black_w = top_l[sl], black_l[sl]
        if float(np.median(top_w[strand])) <= float(np.median(black_w[strand])) + 1.0:
            return None
        # (2) the skin's own hue: chroma of the strand vs its surrounding ring
        rw = max(3, int(face_d * 0.015))
        ring = (
            cv2.dilate(strand.astype(np.uint8), np.ones((rw, rw), np.uint8), iterations=2) > 0
        ) & ~strand & us
        if ring.sum() < 16:
            return None
        lab_w = lab[sl]
        da = abs(float(np.median(lab_w[..., 1][strand])) - float(np.median(lab_w[..., 1][ring])))
        db = abs(float(np.median(lab_w[..., 2][strand])) - float(np.median(lab_w[..., 2][ring])))
        if da + db > 14.0:
            return None
        # (4) runs down the face from its anchor
        ay, ax = np.nonzero(anchor)
        a_pt = np.array([ax.mean(), ay.mean()], np.float32)
        vec = down_field[sl][int(a_pt[1]), int(a_pt[0])]
        if float(np.linalg.norm(vec)) < 0.5:
            return None
        sy, sx = np.nonzero(strand)
        proj = (sx - a_pt[0]) * vec[0] + (sy - a_pt[1]) * vec[1]
        if (proj > 0).mean() < 0.55 or float(np.percentile(proj, 90)) < face_d * 0.02:
            return None
        # (5) the body of the strand lives on open, heal-eligible skin
        body = strand & ~no
        if body.sum() < 8 or float((body & us).sum()) < 0.8 * float(body.sum()):
            return None
        heal = np.zeros(repair.shape, np.uint8)
        heal[sl] = cv2.dilate((strand & us).astype(np.uint8), np.ones((3, 3), np.uint8))
        return heal

    out = repair.copy()
    line_vetoed = 0
    shading_vetoed = 0
    wet_trails = 0
    # face-normalised, like everything else in this function. These three were
    # absolute (7px reach, 6px engagement, 8px outside) inside a routine whose
    # every other number scales with the face, so on a 190px face they all bit
    # about twice as hard relative to the mark they were judging.
    gk = max(3, int(face_d * 0.025)) | 1
    grow = np.ones((gk, gk), np.uint8)
    engaged_floor = max(4, int(face_d * 0.02))
    outside_floor = max(6, int(face_d * 0.03))
    step = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    n, labels, _, _ = cv2.connectedComponentsWithStats(repair, connectivity=8)
    for i in range(1, n):
        component = (labels == i).astype(np.uint8)
        record = {"verdict": "keep", "wet": False, "facts": {}, "mask": component}
        if report is not None:
            report.append(record)

        rn = ring_novelty(component)
        record["facts"]["ringBar"] = round(float(ring_bar), 3)
        if rn is not None:
            record["facts"]["ringNovelty"] = round(float(rn), 3)
        if rn is not None and rn > ring_bar:
            out[component > 0] = 0
            shading_vetoed += 1
            record["verdict"] = "shading"
            continue

        reach = cv2.dilate(component, grow) > 0
        inside = np.bincount(r_labels[reach], minlength=r_count)
        # Only structures that actually RUN THROUGH the component can veto it.
        # A neighbouring crease that merely brushes the reach ring must not
        # condemn an isolated mark sitting next to it.
        engaged = max(engaged_floor, int(0.05 * component.sum()))
        line_hit = False
        for rid in np.nonzero(inside[1:])[0] + 1:
            if inside[rid] < engaged or not can_veto[rid]:
                continue
            outside = int(totals[rid] - inside[rid])
            if outside > max(outside_floor, int(0.6 * inside[rid])):
                rescue = wet_trail(rid, component)
                if rescue is not None:
                    # a fluid trail, not a hair: heal the whole strand
                    out = np.maximum(out, rescue)
                    wet_trails += 1
                    record["wet"] = True
                    record["rescue"] = rescue
                    line_hit = False
                    break
                out[component > 0] = 0
                line_vetoed += 1
                record["verdict"] = "line"
                record["facts"].update(
                    ridgeInside=int(inside[rid]),
                    ridgeOutside=int(outside),
                    ridgeTotal=int(totals[rid]),
                    ridgeThicknessPx=round(float(ridge_thick[r_labels == rid].max()) * 2.0, 1),
                )
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
        # cap raised from 0.02: at per-face scale (~250px) five iterations
        # covered a soft smudge's core but left its skirt — "healed into a
        # paler copy of itself". The ring-novelty bar is the real stop; the
        # cap only bounds a runaway.
        for _ in range(max(4, int(face_d * 0.045))):
            rn = ring_novelty(component)
            if rn is None or rn <= grow_bar:
                break
            grown = cv2.dilate(component, step)
            grown[~usable] = 0
            if int(grown.sum()) == int(component.sum()):
                break
            component = grown
        record["mask"] = (
            np.maximum(component, record["rescue"]) if record["wet"] else component
        )
        out = np.maximum(out, component)
    return out, line_vetoed, shading_vetoed, wet_trails


def process(image_b64: str, params: dict):
    """HTTP wrapper — internal chaining uses apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


# --- the structural prior --------------------------------------------------
#
# Every false positive this tool has been patched for sat at a BOUNDARY — just
# outside whatever mask protected the structure inside it. The eye hull and the
# lower-lid ridge below it. The lip hull and the philtrum above it. The nose and
# the alar crease beside it. The hair mask and the beard edge outside it.
#
# And every patch was the same patch: dilate that one mask a little further.
# `EYE_CORNER_CAP = 0.08`, the 3% eye dilation for lashes, the 3.5% hair
# dilation, the 3% erosion of `region` — four constants, one idea, four places.
# None of them worked for long, and BUG-004's own sweep says why: at 0.08 the
# corner cleared, at 0.10 and 0.12 the tool "starts eating real marks". A hard
# edge cannot win, because a structure's influence does not STOP at the mask
# boundary — it DECAYS across it. Widening the mask moves the residue band
# outward and takes open skin with it.
#
# So the binary is the bug. A structure's influence is a field, and the bar has
# to be a field too: not "inside forbidden, outside free", but *the more of your
# deviation something else already explains, the more evidence you must bring*.
# One function, three terms, each measurable on the 23-image bench:
#
#   geometry  — proximity to any protected structure, decaying outward
#   specular  — brighter than the skin's own field without gaining colour, i.e.
#               a highlight: wet lip, oily nose, the shine on a lid ridge
#   pigment   — a CREDIT, not a lift: deviation that is chromatic is the one
#               signature anatomy and lighting do not forge, so it buys the bar
#               back down
#
# Measured on 88 accepted heals across the set: the anatomy false positives are
# bright and colourless (5117 dL=+7 and +9 with da=-2), real marks are dark
# and/or red (4934 dL=-18 da=+3; 1791 dL=-10 da=+4). That separation is what
# the specular lift and the pigment credit encode. It is also why a plain
# magnitude floor was tried and thrown away — the anatomy is STRONGER, not
# weaker, than the marks it drowns out.
STRUCT_LIFT = 2.2  # sigmas of extra evidence demanded right at a structure
STRUCT_REACH = 0.045  # decay length, in face widths
SPECULAR_LIFT = 1.8  # ... and for a colourless highlight
PIGMENT_CREDIT = 1.2  # sigmas forgiven for a fully red-shifted deviation
PIGMENT_FULL = 2.0  # a* z-score that earns the whole credit
BRIGHT_FULL = 3.0  # L* z-score at which a highlight is charged in full


def _robust_sigma(v: np.ndarray) -> float:
    """Same estimator skinmodel uses: MAD, so the marks cannot inflate it."""
    med = float(np.median(v))
    mad = float(np.median(np.abs(v - med)))
    return max(1e-3, mad * 1.4826)


def _structural_lift(model, structures, region, face_d):
    """Extra evidence, in sigmas, demanded of a pixel by what already explains it.

    Returned as an array to SUBTRACT from novelty before scoring, so a mark that
    is genuinely strong still gets through next to a feature — the point is to
    charge for the explanation, not to wall the area off. Walling it off is what
    `region` already does for the places a repair must never touch.
    """
    usable = region > 0.5
    if usable.sum() < 64:
        return np.zeros(model.novelty.shape, np.float32)

    # 1. geometry — distance from the nearest protected structure, decaying out
    outside = (structures <= 0).astype(np.uint8)
    dist = cv2.distanceTransform(outside, cv2.DIST_L2, 5)
    near = np.exp(-dist / max(1.0, face_d * STRUCT_REACH))
    lift = STRUCT_LIFT * near

    # 2. specular — the mid band brighter than the field, and NOT redder for it.
    #
    #    The direction is the whole point, and getting it wrong is what made the
    #    first version of this function do nothing: chroma as a MAGNITUDE
    #    (`hypot(a, b)`) is large for a highlight too — a specular patch moves
    #    away from skin colour just as far as a papule moves toward it — so the
    #    credit below refunded exactly the lift charged here and both verified
    #    false positives on 321A5117 survived untouched.
    #
    #    Measured, per candidate, in this skin's own sigmas (`_gt_lift.py`):
    #
    #      321A5117  the two verified FPs   z_bright +5.00 / +3.91   z_red -2.36 / -1.63
    #      321A1791  the real marks         z_bright  ~0             z_red +1.6 .. +2.7
    #
    #    Bright and less red is light. Redder is pigment. That is the axis.
    #
    #    And it is charged THROUGH `near`, not beside it. Bright-and-colourless
    #    describes a highlight, but it equally describes a crumb, a flake, a
    #    fleck of dry skin — real objects the tool exists to remove. Measured
    #    when the two terms were merely added: `bright-crumb` on 321A5254 went
    #    from `part` (residual 7.7 of 15.6) to a flat MISS. What separates them
    #    is not the pixels, it is the geography — a highlight needs a structure
    #    to make it, a crumb sits wherever it landed. So lighting is allowed to
    #    explain a deviation only where there is something there to do the
    #    explaining, and open cheek stays open.
    mid = model.mid
    sigma_l = _robust_sigma(mid[..., 0][usable])
    sigma_a = _robust_sigma(mid[..., 1][usable])
    z_bright = np.clip(mid[..., 0] / sigma_l, 0.0, None)
    z_red = mid[..., 1] / sigma_a  # SIGNED: negative is a highlight, not a mark
    pigment = np.clip(z_red / PIGMENT_FULL, 0.0, 1.0)
    lift += (
        SPECULAR_LIFT
        * np.clip(z_bright / BRIGHT_FULL, 0.0, 1.0)
        * (1.0 - pigment)
        * near
    )

    # 3. pigment credit — a red shift is the one signature neither geometry nor
    #    lighting forges, so it buys the bar back down. But it buys it down on
    #    OPEN SKIN only: `(1 - near)`.
    #
    #    Letting the credit refund the geometry lift is not a compromise between
    #    two pieces of evidence, it is one argument answering a different one —
    #    "this is pigment, not a highlight" does not address "you are standing on
    #    the brow". Measured when it could: 321A5235 went 3 heals -> 4, the whole
    #    set's only regression, and all four sat on the brow tail and the lip
    #    corner, which are genuinely a little redder than open cheek.
    #
    #    So: near a structure, position decides; out on open skin, colour does.
    lift -= PIGMENT_CREDIT * pigment * (1.0 - near)

    return (np.clip(lift, 0.0, None) * region).astype(np.float32)


def confidence(rgb, params: dict):
    """Measure this face. -> Detection (unpacks as conf, region, face_d, model)."""
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


    # Mole protection lives in the PIGMENT stage, not here.
    #
    # It used to be subtracted from the judged region too, and that made the
    # spot healer refuse any small round dark mark — which is most of what it
    # exists to remove. Measured: a 3px dark speck was withheld outright
    # (region 0.00, conf 0.00) on 321A5254 because it is, by every property a
    # photograph exposes, shaped like a mole.
    #
    # The distinction that matters is WHICH OPERATOR. Colour evening runs over
    # the whole field and would bleach a mole as a silent side effect nobody
    # asked for, so it keeps the guard (see pigment.even_pigment). Spot healing
    # is an explicit, local request to remove a mark; refusing it there is the
    # tool overruling the person using it. Product call, 2026-07-30.
    #
    # If a photographer wants a specific mole kept, that is what the manual
    # brush protects — a decision at the mark, not a blanket rule.

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

    # The bar is no longer one number for the whole face — see `_structural_lift`.
    # It is raised wherever the face's own geometry or the light already explains
    # the deviation, and lowered where the deviation is chromatic. Computed from
    # the model that is being scored, so the refinement pass below gets its own.
    structures = np.maximum(features, hair)

    def score(m: skinmodel.SkinModel) -> np.ndarray:
        bar = lo + _structural_lift(m, structures, region, face_d)
        c = np.clip((m.novelty - bar) / (hi - lo), 0.0, 1.0)
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
    debris = _bright_debris_confidence(
        model, region, np.maximum(simple_features, hair), face_d, strength
    )
    conf = np.maximum(conf, debris)

    # Safety net: a blemish is LOCAL. Anything larger than this is skin
    # character the model failed to absorb (a broad shadow, strong blush on an
    # unusual face) — never "correct" it.
    #
    # Measured as AREA and THICKNESS, matching `decide`. It used to test the
    # bounding box, which is the error this file documents twice already and
    # which had simply survived here: a box punishes a mark for being LONG, so a
    # scratch was discarded at 38x50 while its real area was 396px. `decide` was
    # fixed; `confidence` was not, and it runs FIRST — so the scratch never
    # reached the gate that had been corrected.
    max_side = max(8, int(face_d * 0.16))
    max_area = max_side * max_side * 0.5
    max_radius = max_side * 0.35
    blobs = (conf > 0.35).astype(np.uint8)
    for _, comp, geom in shape.describe_all(blobs):
        if geom.area > max_area or geom.thickness_max > 2.0 * max_radius:
            conf[comp] = 0.0

    # feather so the correction fades in
    fr = max(3, int(face_d * 0.006)) | 1
    conf = cv2.GaussianBlur(conf, (fr, fr), 0)
    return Detection(conf, region, face_d, model, debris)


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


def decide(
    conf: np.ndarray,
    face_d: float,
    mask: np.ndarray | None = None,
    size_gate: bool = True,
) -> np.ndarray:
    """Turn gated tight lesions into solid, slightly grown repair regions.

    Thresholding pixel by pixel is what broke every previous attempt: a lesion
    is a REGION, and a ragged mask full of pinholes makes reconstruction sample
    the blemish in order to repair the blemish — so the mark survives its own
    removal.

    `mask` is normally the structure-gated hysteresis core; when omitted the
    raw core is used (diagnostic scripts call it this way).

    `size_gate=False` is for ONE caller: a person looking at the outline of a
    mark the gate rejected and saying "that is a scab, treat it". The gate is a
    guard against skin character the model failed to absorb, and it is right
    often enough to stay the default — but it is a guess about a photograph,
    and a guess must not outrank the photographer who is looking at the mark.
    Nothing in the automatic path passes this.
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
        if not size_gate:
            continue
        radius = float(cv2.distanceTransform(core, cv2.DIST_L2, 3).max())
        if core.sum() > max_area or radius > max_radius:
            mask[component] = 0
    return mask


# --------------------------------------------------------------- candidates
#
# ONE definition of "what would be healed", shared by the automatic path and by
# the lab's mark-and-choose pass. The automatic result is now literally "every
# candidate whose verdict is heal" — not a second implementation that is
# expected to agree. That distinction is not pedantic here: this module has
# already had to fix two cases of exactly that drift (the detector reading stage
# A's output instead of the original, and the wet-trail test re-deriving the
# fluid detector's checks), and a marking UI that disagrees with the healer by
# even one component is worse than no marking UI at all — it teaches the
# photographer to distrust the outline. test_cleanup_marking.py asserts the two
# paths agree pixel for pixel.


def _geom_facts(mask: np.ndarray, conf: np.ndarray, novelty: np.ndarray, face_d: float):
    """The numbers a person needs to judge one candidate, measured ON it."""
    solid = mask.astype(np.uint8)
    m = solid > 0
    area = int(m.sum())
    if area == 0:
        return {"areaPx": 0}
    half = float(cv2.distanceTransform(solid, cv2.DIST_L2, 3).max())
    return {
        "areaPx": area,
        "thicknessPx": round(2.0 * half, 1),
        # sqrt(area)/face_d — the same scale-free form every gate here uses, so
        # "how big is this" means the same thing on a 200px and a 900px face
        "faceFraction": round(float(np.sqrt(area)) / max(1.0, float(face_d)), 4),
        "noveltyPeak": round(float(novelty[m].max()), 2),
        "confidencePeak": round(float(conf[m].max()), 3),
    }


def _forced_repair(conf, face_d, component, size_gate=False):
    """`decide` for ONE component, computed in a window around it.

    A window, not the whole crop: every operation in `decide` is local (a close
    at face_d*0.010, a dilate at 0.006), so a margin several times that returns
    the same pixels for a fraction of the work — and this runs once per rejected
    candidate on a face that can carry a hundred.
    """
    ys, xs = np.nonzero(component)
    if xs.size == 0:
        return None
    pad = max(8, int(face_d * 0.06))
    y0 = max(0, int(ys.min()) - pad)
    y1 = min(component.shape[0], int(ys.max()) + pad + 1)
    x0 = max(0, int(xs.min()) - pad)
    x1 = min(component.shape[1], int(xs.max()) + pad + 1)
    sub = decide(
        conf[y0:y1, x0:x1],
        face_d,
        component[y0:y1, x0:x1].astype(np.uint8),
        size_gate=size_gate,
    )
    out = np.zeros(component.shape, np.uint8)
    out[y0:y1, x0:x1] = sub
    return out


def _candidates(crop, crop_pre, det: Detection, orifice, anchor_src, down_field, strength, fluids):
    """Every candidate on one face, each with the verdict the engine reached.

    Returns (candidates, repair, counts). `repair` is the automatic mask — the
    union of the accepted candidates, and the array the healer receives when
    nobody has marked anything.
    """
    conf, region, face_c, model = det.conf, det.region, det.face_d, det.model

    core = hysteresis_core(conf)
    report: list[dict] = []
    gated, line_vetoed, shading_vetoed, wet_trails = _structure_gate(
        crop_pre,
        core,
        face_c,
        model.novelty,
        _novelty_bar(strength),
        region,
        orifice=orifice,
        down_field=down_field,
        report=report,
    )
    repair = decide(conf, face_c, gated)

    # --- hard stop at the border of the eligible region ----------------------
    #
    # `decide` GROWS what it was given — a morphological close, `_fill_holes`,
    # then a dilate of 0.6% of face_d "because a mark fades at its rim" — and
    # grow-to-isolation widens it again. Every one of those is right, and not
    # one of them was re-confined, so the mask walked straight out of the
    # heal-eligible region and onto the anatomy that region exists to withhold.
    #
    # Measured before this line existed: 24.6% / 36.1% / 20.4% of the repair
    # mask on three faces sat OUTSIDE `region`, and 100% of the pixels that
    # changed by more than 5 levels inside `face-eye-region` were inside BOTH
    # protection masks. The visible result is the one the user reported — a
    # dark smudge appearing on the lower lash line. The eyeball itself was
    # never touched (max 2.7 levels); the damage is 4-12px outside it, on the
    # lid rim, which is exactly where the grown mask lands.
    #
    # Same rule pigment.py already writes for its own blur: smooth inside, hard
    # stop at the border. Applied to `decide`'s output only — the fluid pass
    # merges AFTER this, and it must keep reaching the lips (see its call site:
    # subtracting anatomy there set drool reachability to exactly 0.000).
    repair = (repair & (region > 0.35)).astype(np.uint8)

    # --- a detection that IS a crease is not a mark --------------------------
    #
    # `region` already withholds a nasolabial band, but that band is a straight
    # line from the ala to the mouth corner and a real smile fold is not: it
    # bows outward over the cheek and keeps running BELOW the corner. Measured
    # against the fold traced from the image on four faces, the drawn band
    # covers 0.0%-20.7% of it — 0.0% on the two worst. And there is no landmark
    # at all for a crow's foot, a forehead line or a dimple; MediaPipe marks
    # eyes, nose, lips and the oval, and no face model of any topology marks
    # creases. So the fold is MEASURED (pigment.crease_map) rather than assumed.
    #
    # Applied HERE, to the finished repair mask, and not to `region` upstream.
    # Subtracting it from `region` was tried first and cost recall outright —
    # 321A5173 fell 4/5 -> 2/5 — because `region` also defines where the skin
    # model SAMPLES and where erosion bites, so shrinking it moved the detector
    # rather than just the repair. At this point nothing upstream changes.
    #
    # Whole components, never pixels: cutting a component in half leaves the
    # ragged mask `decide` exists to prevent. A mark that merely touches a
    # crease is still healed; a "mark" that is mostly the crease is the crease.
    crease_vetoed = 0
    if repair.any():
        crease = pigment.crease_map(crop, region, face_c) > 0.5
        if crease.any():
            n_r, l_r = cv2.connectedComponents(repair, connectivity=8)
            for i in range(1, n_r):
                sel = l_r == i
                if float(crease[sel].mean()) <= CREASE_OVERLAP_DROP:
                    continue
                comp = sel.astype(np.uint8)
                area = float(comp.sum())
                half = float(cv2.distanceTransform(comp, cv2.DIST_L2, 3).max())
                length = area / max(1.0, 2.0 * half)
                # NOT migrated to `shape.describe`, deliberately. This measure is
                # already distance-transform based, so it does not carry the
                # bounding-box bug — but its convention differs (it divides by the
                # HALF-thickness at the widest point, so its numbers run ~2x
                # shape's `elongation`, and it is driven by the fattest point
                # rather than the typical one). CREASE_REPAIR_ELONGATION=3.0 was
                # calibrated against measured folds (11.2x, 6.6x) and a compact
                # speck (1.6x) on 321A5173, and re-expressing a measured constant
                # without those fixtures to re-measure on would be a guess.
                # Unify when they are available; ~1.5 is the expected equivalent.
                if length / max(1.0, half) >= CREASE_REPAIR_ELONGATION:
                    repair[sel] = 0
                    crease_vetoed += 1

    fluid = np.zeros(repair.shape, np.uint8)
    fluid_found = 0
    if fluids:
        # fluids live in the orifice-adjacent band the generic detector cannot
        # judge — they get their own pass, merged into the same repair mask.
        #
        # The fluid pass must be kept off the EYES — and only the eyes.
        #
        # It had no anatomy protection at all, and it was the one route that could
        # still reach one: measured on a 290px face, all 135 pixels that changed
        # by more than 40 RGB units sat inside the fluid mask on the lower lid — a
        # 111-unit rewrite of a child's eye. On a baby it nominated BOTH eyes as
        # fluid candidates and was stopped only by the runs-downward gate at 0.45
        # against a 0.55 bar.
        #
        # The obvious fix — subtract `face-anatomy`, as every other path does —
        # is WRONG here, and measurably so: anatomy contains the lips, and a
        # fluid's whole purpose is to start at the mouth. It set lip reachability
        # to exactly 0.000, i.e. it made drool permanently unremovable in order to
        # protect an eye. `face-eye-region` withholds the eyes and nothing else.
        skin_zone = np.clip(
            masks.get_mask(crop, "face-skin") * masks.get_mask(crop, "face-oval")
            - masks.get_mask(crop, "face-eye-region"),
            0.0,
            1.0,
        )
        # Detect on the ORIGINAL, heal on the corrected field — the same
        # composition rule the spot detector already follows, applied to the one
        # place that still chained instead. Reading `crop` made this detector a
        # function of whatever the pigment stage happened to do upstream: adding
        # the crease veto shifted the Lab values under the strand just enough to
        # fail the hue check, and the real drool on 321A1809 — the single
        # validated true positive in the corpus — went from found to not found
        # while its seed pixels barely moved (711 -> 707). A detector that a
        # different operator can silently switch off is not a detector.
        fluid, fluid_found = _fluid_trails(
            crop_pre, face_c, orifice, anchor_src, down_field, skin_zone
        )
        if fluid_found:
            repair = np.maximum(repair, fluid)

    # --- attribution --------------------------------------------------------
    #
    # Candidates are the connected components of the REAL repair mask, not of
    # anything reconstructed from the report. Two marks a hair's breadth apart
    # merge into one component inside `decide`, and they must then be ONE thing
    # on screen: a person cannot mark half of a merged blob, so offering them as
    # two would be a control that does not exist.
    def kind_of(m):
        if fluid_found and bool(np.any((m > 0) & (fluid > 0))):
            return "fluid"
        if bool(np.any((m > 0) & (det.debris > 0.5))):
            return "debris"
        return "spot"

    cands: list[Candidate] = []
    count, labels, _, _ = cv2.connectedComponentsWithStats(repair, connectivity=8)
    accepted = np.zeros(repair.shape, np.uint8)
    for i in range(1, count):
        solid = _fill_holes((labels == i).astype(np.uint8))
        accepted = np.maximum(accepted, solid)
        fed = [
            rec
            for rec in report
            if rec["verdict"] == "keep" and bool(np.any((solid > 0) & (rec["mask"] > 0)))
        ]
        for rec in fed:
            rec["claimed"] = True
        wet = any(rec["wet"] for rec in fed)
        facts = _geom_facts(solid, conf, model.novelty, face_c)
        facts["parts"] = len(fed)
        cands.append(
            Candidate(
                kind="fluid" if wet else kind_of(solid),
                verdict="heal",
                mask=solid,
                facts=facts,
            )
        )

    # ...and the ones that were found and REFUSED. They are the whole reason a
    # person needs to see this: a veto that fires invisibly looks exactly like a
    # detector that found nothing, and the two call for opposite responses.
    for rec in report:
        rejected = rec["verdict"] != "keep"
        if not rejected and rec.get("claimed"):
            continue
        # a kept component with nothing left in the repair mask can only have
        # been dropped by decide()'s size gate — nothing else in that function
        # removes pixels, and its no-core branch cannot fire on a hysteresis
        # component (which contains a confident seed by construction)
        verdict = rec["verdict"] if rejected else "size"
        forced = _forced_repair(conf, face_c, rec["mask"], size_gate=False)
        if forced is None or not forced.any():
            continue
        forced = _fill_holes(forced)
        facts = {**rec["facts"], **_geom_facts(forced, conf, model.novelty, face_c)}
        cands.append(
            Candidate(kind=kind_of(forced), verdict=verdict, mask=forced, facts=facts)
        )

    counts = {
        "lineVetoed": line_vetoed,
        "shadingVetoed": shading_vetoed,
        "creaseVetoed": crease_vetoed,
        "wetTrails": wet_trails,
        "fluidTrails": fluid_found,
    }
    # The automatic mask IS the union of the accepted candidates, by
    # construction and not by coincidence. The only difference from `repair` as
    # decide/_fluid_trails left it is that each blob is hole-filled, which a
    # repair region has to be anyway (see `decide`: a ragged mask makes
    # reconstruction sample the blemish in order to repair the blemish). Making
    # this the returned mask is what turns "the outline you marked is what gets
    # rebuilt" from a claim into an identity — select every accepted candidate
    # and you get the automatic result back, bit for bit.
    return cands, accepted, counts


@dataclasses.dataclass
class FaceScan:
    """One face, staged and measured.

    `None` from `_scan_face` and a scan with `detection is None` are different
    outcomes and must not be collapsed: the first means the frame holds nothing
    this tool can work on, the second means the colour stages already produced a
    real result that still has to be composited back. Returning the untouched
    frame in the second case is a bug this module has had — it silently threw
    the pigment correction away.
    """

    box: tuple
    crop: np.ndarray
    crop_pre: np.ndarray
    stage_meta: dict
    detection: Detection | None = None
    candidates: list = dataclasses.field(default_factory=list)
    repair: np.ndarray | None = None
    counts: dict = dataclasses.field(default_factory=dict)
    quiet: bool = False
    # The spot dial was set to zero. Distinct from `quiet` (nothing to find) and
    # from `detection is None` (nothing to find it on) — this one is a decision
    # the person made, and it has to be reported as such rather than as an
    # absence of dirt.
    spots_off: bool = False


def _scan_face(rgb, params: dict, candidates: bool = True, frame_eye=None) -> FaceScan | None:
    """Stage the correctable field, then detect on the untouched original."""
    redness, strength, spot_params = _params(params)
    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    if face_d < MIN_FACE_PX:
        return None

    box = common.region_box(skin, int(face_d * 0.25), rgb.shape)
    if box is None:
        return None
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1]
    # The evidence for spot detection is the UNTOUCHED crop.
    #
    # The stages below rewrite `crop`, and the detector used to read their
    # output. The intent was documented and reasonable — evening the field
    # first lowers the model's own sigma, so discrete papules should stand
    # clearer — but measured on the recall suite it does the opposite, badly:
    # the pigment pass partially bleaches the marks themselves, the detector
    # then sees a WEAKER deviation, and a mark that would have been rebuilt is
    # merely faded instead. Recall with detection reading stage A's output vs
    # reading the original: 321A4934 2/5 -> 4/5, 321A5254 1/5 -> 3/5.
    #
    # So the two operators are composed, not chained: detect on the original,
    # heal on the evened field. The repair mask is spatial, so reconstruction
    # still samples the corrected neighbourhood — which is what we want.
    crop_pre = crop.copy()

    # --- stage A: diffuse pigment, BEFORE any spot detection ----------------
    #
    # Broad uneven redness is not a set of spots, and asking the reconstruction
    # path to remove it made it rebuild a quarter of the face. It gets its own
    # operator (see pigment.py), and it runs first for a second reason that is
    # not obvious: the detector's bar is a robust sigma of this skin's own
    # variation, and diffuse erythema inflates that sigma — so a face with a lot
    # wrong RAISED ITS OWN BAR and saw less. Evening the field first drops the
    # sigma, and the discrete papules that remain finally stand clear of it.
    # The two operators are not merely stacked; each makes the other work.
    pig_meta = {}
    if redness > 0:
        face_pc = float(np.sqrt(masks.get_mask(crop, "face-skin").sum()))
        # `face-oval` is the landmark contour, and it runs noticeably INSIDE the
        # real skin: measured here it withheld the upper forehead band and both
        # outer cheeks — 58k px of ordinary, acne-covered skin, and the home of
        # nearly every mark still surviving at full strength. It exists to keep
        # RECONSTRUCTION off the ear, which is a mass of ridge and shadow no skin
        # model can explain. Colour correction has no such failure mode: an ear's
        # deviation is luminance/structure, which the chroma pass ignores, and
        # the lift only reaches compact blobs. So the containment is widened for
        # this stage, while the hairline stays protected by the hair mask.
        ovr = max(3, int(face_pc * 0.06)) | 1
        oval_c = cv2.dilate(masks.get_mask(crop, "face-oval"), np.ones((ovr, ovr), np.uint8))
        skin_c = masks.get_mask(crop, "face-skin") * oval_c
        hair_c = masks.get_mask(crop, "hair")
        hpr = max(3, int(face_pc * 0.02)) | 1
        hair_c = cv2.dilate(hair_c, np.ones((hpr, hpr), np.uint8))
        # One mask for both halves. `face-pigment-protect` frees exactly the three
        # pure-geometry parts a colour operator provably cannot damage and keeps
        # everything else — see the note on that mask kind for what was measured
        # when the eye region and infraorbital strip were freed instead.
        pig_judge = np.clip(
            skin_c - masks.get_mask(crop, "face-pigment-protect") - hair_c, 0.0, 1.0
        )
        # The eye is a NO-GO ZONE, not a correction boundary, and the difference
        # decides whether it may be feathered.
        #
        # A feather is right where a correction meets open skin: it hides the
        # edge of the operator's own work. It is wrong around an eye, because
        # "60% protected" then means "40% of the correction still lands on the
        # lid rim". Measured after every other leak into the eye was closed:
        # 100% of the pixels still moving by more than 5 levels sat inside
        # face-anatomy, at protection 0.50-0.86 — squarely in the feather — and
        # 40% of the correction there was still 11-12 levels.
        #
        # The delta is blurred BEFORE it is confined (see even_pigment), so a
        # hard stop here is still smooth on the inside. Same rule as the repair
        # mask a few stages down: smooth inside, hard stop at the border.
        #
        # And the mask is taken from the FRAME when the caller has one, not
        # recomputed on this crop. The same kind, computed on a crop, does not
        # agree with itself: MediaPipe re-detects on the smaller image and the
        # region lands a few pixels off. Measured on a four-face frame, 2,078
        # pixels were protected by the frame mask and NOT by the union of the
        # crop masks — and 53 of the 62 pixels still changing near an eye were
        # exactly those. A protection mask that moves when you crop is not a
        # protection mask.
        eye_guard = (
            frame_eye[y0:y1, x0:x1] if frame_eye is not None
            else masks.get_mask(crop, "face-eye-region")
        )
        pig_judge *= (eye_guard <= 0.35).astype(np.float32)
        crop, pig_meta = pigment.even_pigment(crop, pig_judge, face_pc, redness)

    # --- stage B: specular highlights (wet lips) -----------------------------
    #
    # Its own stage because it is its own physics: a reflection, not a mark. The
    # lips are the one surface every other path deliberately withholds, so this
    # is the only place drool can be reached at all — `_fluid_trails` excludes
    # them by construction (`orifice == 0`) and the skin detector excludes them
    # via `face-anatomy`. Measured before this existed: change on a drooling
    # baby's lips was 0.39 mean / 2.3 max, i.e. nothing.
    # Two surfaces, two dials, one operator — the physics is identical and the
    # taste is not. A photographer may want an oily forehead calmed while a
    # child's lips keep every bit of their shine, or the reverse. They are also
    # different SCALES: `reduce_specular` derives its gloss radius from the
    # region's own extent, so a forehead and a lip must not share a call.
    spec_meta = {}
    gloss = common.clamp01(params.get("gloss", params.get("strength", 60)))
    if gloss > 0:
        lips = masks.get_mask(crop, "face-lips")
        if lips.max() > 0:
            crop, spec_meta = specular.reduce_specular(crop, lips, gloss)

    shine_meta = {}
    shine = common.clamp01(params.get("shine", 0))
    if shine > 0:
        skin_s = masks.get_mask(crop, "face-skin") * masks.get_mask(crop, "face-oval")
        hs = max(3, int(np.sqrt(masks.get_mask(crop, "face-skin").sum()) * 0.02)) | 1
        surface = np.clip(
            skin_s
            - masks.get_mask(crop, "face-pigment-protect")
            - cv2.dilate(masks.get_mask(crop, "hair"), np.ones((hs, hs), np.uint8)),
            0.0,
            1.0,
        )
        if surface.max() > 0:
            crop, sm2 = specular.reduce_specular(crop, surface, shine)
            shine_meta = {f"skin{k[0].upper()}{k[1:]}": v for k, v in sm2.items()}

    scan = FaceScan(
        box=box,
        crop=crop,
        crop_pre=crop_pre,
        stage_meta={**pig_meta, **spec_meta, **shine_meta},
    )

    # Zero on the dial means OFF. It did not, and nothing said so: the bar is
    # `_novelty_bar(strength)` = 4.5 sigma at zero — finite, not infinite — so
    # the spot half went on finding and rebuilding marks with the slider all the
    # way down. Measured across the 23-frame set: 54 accepted heals at
    # `spots=0`, against 87 at the shipped default of 25.
    #
    # Gated HERE, in the shared scan, so `detect` and `apply` cannot disagree
    # about it — the marking-parity invariant is the reason this file has a
    # single scan in the first place. The colour and gloss halves are untouched:
    # they have their own dials, and turning off spot healing is not a request
    # to stop evening pigment.
    if common.clamp01(spot_params.get("strength", 60)) <= 0:
        scan.spots_off = True
        return scan

    scan.detection = confidence(crop_pre, spot_params)
    if scan.detection is None:
        return scan
    if float((scan.detection.conf > 0.35).sum()) < 4:
        scan.quiet = True  # a clean face: the spot half has nothing to do
        return scan

    # The legacy frequency-separation mode has no repair mask to describe — it
    # attenuates a band by confidence — so it never pays for the candidate pass.
    if candidates and str(params.get("mode", "reconstruct")) == "reconstruct":
        orifice, anchor_src, down_field = _orifice_context(rgb)
        scan.candidates, scan.repair, scan.counts = _candidates(
            crop,
            crop_pre,
            scan.detection,
            orifice[y0:y1, x0:x1],
            anchor_src[y0:y1, x0:x1],
            down_field[y0:y1, x0:x1],
            strength,
            fluids=bool(params.get("fluids", FLUID_TRAILS_ENABLED)),
        )
    return scan


def _contours(mask: np.ndarray, ox: int, oy: int, w: int, h: int):
    """Frame-normalised outline of a solid mask.

    Normalised to 0..1 of the frame, not pixels, for one reason that decides
    whether this feature is honest: what a person marks on a preview has to
    apply to the FULL-RESOLUTION file, because that is the only version that
    ever gets delivered. Six decimals is ~0.003px on a 6000px frame, so the
    round trip back to pixels is exact.
    """
    found, _ = cv2.findContours(
        mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    out = []
    for contour in found:
        pts = contour.reshape(-1, 2)
        if len(pts) < 3:
            continue
        out.append(
            [[round((int(x) + ox) / w, 6), round((int(y) + oy) / h, 6)] for x, y in pts]
        )
    return out


def _selection_mask(shape, polygons) -> np.ndarray:
    """Rasterise the outlines a person marked.

    `drawContours(FILLED)` is the same primitive `_fill_holes` builds every
    repair blob with, so filling an outline that came out of `findContours` on
    such a blob returns that blob exactly — which is what makes "the outline you
    marked is the region that was rebuilt" a fact about this code and not a
    hope. test_cleanup_marking.py asserts the round trip.
    """
    h, w = shape[:2]
    out = np.zeros((h, w), np.uint8)
    polys = []
    for entry in polygons or []:
        pts = entry.get("points") if isinstance(entry, dict) else entry
        if not pts or len(pts) < 3:
            continue
        arr = np.empty((len(pts), 1, 2), np.int32)
        for i, point in enumerate(pts):
            arr[i, 0, 0] = int(np.rint(float(point[0]) * w))
            arr[i, 0, 1] = int(np.rint(float(point[1]) * h))
        polys.append(arr)
    if polys:
        cv2.drawContours(out, polys, -1, 1, thickness=cv2.FILLED)
    return out


def _face_boxes(rgb, faces):
    """One working crop per face, with room for the below-mouth fluid zone."""
    h, w = rgb.shape[:2]
    boxes = []
    for lm in faces:
        xs = np.array([p.x * w for p in lm])
        ys = np.array([p.y * h for p in lm])
        fw = float(np.hypot(
            (lm[masks.FACE_RIGHT].x - lm[masks.FACE_LEFT].x) * w,
            (lm[masks.FACE_RIGHT].y - lm[masks.FACE_LEFT].y) * h,
        ))
        if fw < 40:
            continue
        # margin: chin, forehead and the below-mouth fluid zone included
        x0 = max(0, int(xs.min() - fw * 0.35))
        x1 = min(w, int(xs.max() + fw * 0.35))
        y0 = max(0, int(ys.min() - fw * 0.35))
        y1 = min(h, int(ys.max() + fw * 0.65))
        if x1 - x0 < 48 or y1 - y0 < 48:
            continue
        boxes.append((x0, y0, x1, y1))
    return boxes


def detect(rgb, params: dict) -> dict:
    """Every candidate in the frame, outlined and explained — the marking pass.

    Same detector, same gates, same repair geometry as `apply`: this calls the
    identical helpers, so the outline a person marks IS the region that would be
    rebuilt. Rejected candidates are included, each with the measurement that
    rejected it, so a veto can be overruled by the one party entitled to
    overrule it — the person looking at the photograph.
    """
    h, w = rgb.shape[:2]
    faces = masks._face_landmarks(rgb) or []
    if len(faces) >= 2:
        boxes = _face_boxes(rgb, faces)
    else:
        boxes = [(0, 0, w, h)]

    items = []
    notes: dict = {}
    for face_index, (fx0, fy0, fx1, fy1) in enumerate(boxes):
        scan = _scan_face(rgb[fy0:fy1, fx0:fx1], params)
        if scan is None:
            notes["faceTooSmall"] = notes.get("faceTooSmall", 0) + 1
            continue
        if scan.spots_off:
            notes["spotsOff"] = notes.get("spotsOff", 0) + 1
            continue
        if scan.detection is None:
            notes["noSkinRegion"] = notes.get("noSkinRegion", 0) + 1
            continue
        ox = fx0 + scan.box[0]
        oy = fy0 + scan.box[1]
        for key, value in scan.counts.items():
            notes[key] = notes.get(key, 0) + int(value)
        for index, cand in enumerate(scan.candidates):
            contours = _contours(cand.mask, ox, oy, w, h)
            if not contours:
                continue
            ys, xs = np.nonzero(cand.mask)
            items.append({
                "id": f"{face_index}-{index}",
                "face": face_index,
                "kind": cand.kind,
                "verdict": cand.verdict,
                "contours": contours,
                "bbox": [
                    round((int(xs.min()) + ox) / w, 6),
                    round((int(ys.min()) + oy) / h, 6),
                    round((int(xs.max()) + ox) / w, 6),
                    round((int(ys.max()) + oy) / h, 6),
                ],
                "facts": cand.facts,
            })

    return {
        "width": w,
        "height": h,
        "faces": len(faces),
        "items": items,
        "notes": notes,
    }


def apply(rgb, params: dict):
    """params: { redness: 0..100, spots: 0..100 }  (`strength` = master fallback)

    Two operators, two dials — see `_params` for why one dial could not work.

    `params["selection"]` switches the spot half from automatic to chosen: it
    carries the outlines a person marked in the lab (frame-normalised, from
    `detect`), and exactly those are rebuilt. An EMPTY polygon list is a real
    answer — "I looked, and none of them" — and is deliberately different from
    the key being absent, which means "decide for me". The colour half is not
    affected either way: uneven pigment is a field, not a set of objects, so
    there is nothing there to mark.
    """
    redness, spots, _ = _params(params)
    selection = params.get("selection")
    marked = isinstance(selection, dict) and selection.get("polygons") is not None
    if redness <= 0 and spots <= 0 and not marked:
        return rgb, {"spotsRemoved": 0}

    # A marked selection is rasterised ONCE, against the whole frame, and the
    # per-face crops then take their slice of it. Doing it here rather than per
    # crop is what keeps the coordinates trivially correct in the group case:
    # the polygons are frame-normalised, so they need to meet the frame exactly
    # once and never again.
    sel_mask = _selection_mask(rgb.shape, selection.get("polygons")) if marked else None

    # A group photo is N faces, not one big one. face_d here is sqrt of the
    # TOTAL skin area — four ~250px children read as one 557px face, and every
    # size-relative threshold (detection kernel, mark-size gates) runs ~2x too
    # coarse. Measured on 321A1809: 5/12 injected marks healed, one child 0/3.
    # So each face is processed in its own crop at its own scale; the frame
    # composites progressively so overlapping crops keep earlier heals.
    faces = masks._face_landmarks(rgb)
    if len(faces) >= 2:
        out = rgb.copy()
        # `faceTooSmall` belongs here or it is LOST. The single-face path already
        # reports it, but this loop accumulates only keys declared up front, so
        # in a group photo — the one case where small faces actually occur — a
        # skipped child vanished without a word. Measured on 321A5078: three of
        # the five faces are 137-154px against MIN_FACE_PX 180, so the tool did
        # nothing to them and said nothing about it.
        totals = {"spotsRemoved": 0, "correctedPx": 0, "lineVetoed": 0, "creaseVetoed": 0,
                  "shadingVetoed": 0, "wetTrails": 0, "fluidTrails": 0,
                  "pigmentPx": 0, "protectedSpotPx": 0, "selected": 0,
                  "faceTooSmall": 0, "spotsOff": 0}
        # Protection masks belong to the FRAME. Computing them once here and
        # slicing per crop is not an optimisation: recomputed on a crop they
        # come back in a slightly different place (see the note at eye_guard),
        # and a per-face pass then edits skin the frame said was off limits.
        frame_eye = masks.get_mask(rgb, "face-eye-region")
        for x0, y0, x1, y1 in _face_boxes(rgb, faces):
            healed_sub, m = _apply_one(
                out[y0:y1, x0:x1],
                params,
                sel_mask=None if sel_mask is None else sel_mask[y0:y1, x0:x1],
                frame_eye=frame_eye[y0:y1, x0:x1],
            )
            out[y0:y1, x0:x1] = healed_sub
            for key in totals:
                totals[key] += int(m.get(key, 0))
        totals["faces"] = len(faces)
        if sel_mask is None:
            totals.pop("selected", None)
        return out, totals

    # Single face still crops — `_scan_face` takes its own region box — so it
    # needs the frame-computed guard for the same reason the group path does.
    out, meta = _apply_one(
        rgb, params, sel_mask=sel_mask,
        frame_eye=masks.get_mask(rgb, "face-eye-region"),
    )
    # `faces` on the single-face path too. The group path already reported it,
    # and the lab needs the DENOMINATOR in both: "1 face skipped" and "1 of 4
    # skipped" are different sentences, and without a total the front end can
    # only say the harsher one.
    meta.setdefault("faces", len(faces))
    return out, meta


def _params(params: dict):
    """Split the request into the two operators' own strengths.

    One slider driving both was the wrong control, and it cost the tool its whole
    result in practice. The two halves have OPPOSITE risk profiles:

      pigment evening  cannot write structure, passes test_blush at full
                       strength. ("cannot flatten a crease" was also claimed
                       here and was false — it flattened a nasolabial fold at
                       9-16x the rate of ordinary skin until pigment.crease_map
                       was added. See CREASE_MIN_ELONGATION there.)
      spot healing     recall ~30% and a known missing mid-frequency band, so
                       what it does repair can still read as a patch. Needs a
                       conservative hand.

    A single dial therefore has no good setting: measured on the reference acne
    face, the shipped default of 60 threw away more than half the achievable
    improvement (marks -17% against -44%) purely to keep the risky half calm.

    `strength` stays supported as a master fallback so every existing recipe and
    preset keeps working; `redness` and `spots` override it when present.
    """
    master = params.get("strength", 60)
    redness_raw = params.get("redness", master)
    spots_raw = params.get("spots", master)
    return (
        common.clamp01(redness_raw),
        common.clamp01(spots_raw),
        {**params, "strength": spots_raw},
    )


# How far above the floor a rescaled face is taken (a face landing exactly on
# MIN_FACE_PX would sit on the knee of every gate), and the hard ceiling on the
# factor. Every face blocked in the 23-frame set needs 1.19x-1.39x; 2.0 leaves
# room for a smaller one without ever entering the range where the resampler is
# the thing producing the detail.
UPSCALE_MARGIN = 1.15
UPSCALE_MAX = 2.0


def _apply_upscaled(rgb, params: dict, factor: float, frame_eye=None):
    """Run the pipeline on an enlarged crop, return only what it changed.

    The composite is the whole point. `edit` is taken back to the original size
    and blended through the mask of pixels the pipeline actually touched, so
    every untouched pixel is bit-identical to the input: the resample can only
    ever reach the repairs themselves, never the skin around them.
    """
    h, w = rgb.shape[:2]
    big = cv2.resize(rgb, (int(w * factor), int(h * factor)),
                     interpolation=cv2.INTER_LANCZOS4)
    edit, meta = _apply_one(big, params, frame_eye=frame_eye, _rescaled=True)

    touched = (np.abs(edit.astype(np.int16) - big.astype(np.int16)).max(axis=2) > 0)
    if not touched.any():
        return rgb, {**meta, "upscaled": round(factor, 2), "upscaledChangedPx": 0}

    back = cv2.resize(edit, (w, h), interpolation=cv2.INTER_AREA)
    alpha = cv2.resize(touched.astype(np.float32), (w, h),
                       interpolation=cv2.INTER_AREA)
    r = max(3, int(min(h, w) * 0.004)) | 1
    alpha = cv2.GaussianBlur(alpha, (r, r), 0)[..., None]
    out = (rgb.astype(np.float32) * (1.0 - alpha) + back.astype(np.float32) * alpha)
    return (
        np.clip(out, 0, 255).astype(np.uint8),
        {**meta, "upscaled": round(factor, 2),
         "upscaledChangedPx": int(touched.sum())},
    )


def _apply_one(rgb, params: dict, sel_mask=None, frame_eye=None, _rescaled=False):
    """The single-face pipeline: every threshold scales from THIS face.

    `sel_mask` is a crop-aligned 0/1 array when a person marked what to treat.
    It REPLACES detection's verdict about which pixels to rebuild, and nothing
    else: the colour stages, the skin model, the donor search and the colour
    harmonisation are the same code doing the same thing, because none of them
    is a judgement about what counts as a blemish.
    """
    # A face under the size floor is not a face this tool cannot help — it is a
    # face this tool does not have enough pixels to measure. Every threshold in
    # here is a fraction of `face_d`, so below the floor the detection kernel and
    # the mark-size gates run several times too coarse and the honest answer was
    # to refuse. Measured cost of that refusal on this set: 11 of 40 faces, and
    # on 321A5078 three of five children — including one with visible irritation.
    #
    # So give it the pixels. The crop is resampled up until it clears the floor
    # and the pipeline runs unchanged; `UPSCALE_MAX` caps how far, because past a
    # point this stops being "resolve the thresholds" and starts being "invent
    # detail". On this set every blocked face needs 1.19x-1.39x — modest.
    #
    # The result comes back through the CHANGED PIXELS ONLY (`_downscale_edit`).
    # A whole crop pushed up and pulled back would soften every pore on the face
    # to repair four spots, which is a worse trade than doing nothing — the
    # failure this whole exercise exists to avoid.
    if not _rescaled and sel_mask is None:
        skin = masks.get_mask(rgb, "face-skin")
        gate = float(np.sqrt(skin.sum()))
        if 0 < gate < MIN_FACE_PX:
            factor = min(UPSCALE_MAX, (MIN_FACE_PX * UPSCALE_MARGIN) / gate)
            if factor > 1.02:
                return _apply_upscaled(rgb, params, factor, frame_eye)

    scan = _scan_face(rgb, params, candidates=sel_mask is None, frame_eye=frame_eye)
    if scan is None:
        return rgb, {"spotsRemoved": 0, "faceTooSmall": 1}

    x0, y0, x1, y1 = scan.box
    crop, crop_pre = scan.crop, scan.crop_pre

    # Stage A already produced a real result, so no later early-exit may return
    # the untouched frame — that silently threw the colour correction away.
    def _composited(extra: dict):
        merged = rgb.copy()
        merged[y0:y1, x0:x1] = crop
        return merged, {**extra, **scan.stage_meta}

    if scan.spots_off:
        return _composited({"spotsRemoved": 0, "spotsOff": 1})
    if scan.detection is None:
        return _composited({"spotsRemoved": 0})
    conf, region, face_c, model = scan.detection

    # A clean face: nothing for the spot half to do. Kept as an early exit
    # because it also withholds the fluid pass, which is where that pass has
    # always sat — a marked selection is the one thing that overrules it, since
    # someone looked at this face and pointed at something.
    if scan.quiet and sel_mask is None:
        return _composited({"spotsRemoved": 0, "correctedPx": 0})

    # --- healing -----------------------------------------------------------
    if str(params.get("mode", "reconstruct")) == "reconstruct":
        # Attenuating `mid` only ever DIMS a mark — its structure survives, which
        # is why every earlier attempt left a ghost. Reconstruction rebuilds what
        # should be under it instead.
        #
        # This gives up the structural blush guarantee that frequency blending
        # had (low was untouched by construction). The size gate is what
        # replaces it: we only ever reconstruct marks small enough that the ring
        # feeding the diffusion is the same patch of skin — so local blush is
        # reproduced, not averaged away. test_blush.py holds this honest.
        if sel_mask is not None:
            # exactly what was marked. `_fill_holes` because a repair region has
            # to be solid — a ragged mask makes reconstruction sample the blemish
            # in order to repair the blemish, and the mark survives its own
            # removal (see `decide`).
            # `sel_mask` is in the coordinates of the frame THIS call received;
            # the working crop is a box inside it.
            repair = _fill_holes((sel_mask[y0:y1, x0:x1] > 0).astype(np.uint8))
            counts = {"selected": max(0, int(cv2.connectedComponents(repair, 8)[0]) - 1)}
        else:
            # already computed by the scan — the automatic mask IS the union of
            # the candidates it accepted, so there is nothing to recompute here
            repair = scan.repair
            counts = scan.counts
        if repair is None or not repair.any():
            return _composited({"spotsRemoved": 0, "correctedPx": 0, **counts})
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
        out = rgb.copy()
        out[y0:y1, x0:x1] = harmonized.image
        n, _, _stats, _ = cv2.connectedComponentsWithStats(repair, connectivity=8)
        return out, {
            "spotsRemoved": max(0, n - 1),
            "correctedPx": int((repair > 0).sum()),
            **counts,
            "colorHarmonization": harmonized.metadata,
            **scan.stage_meta,
        }

    # low is reassembled untouched -> natural colour cannot be neutralised.
    # mid is where the blemish lives -> suppressed by confidence.
    # high is texture -> kept almost entirely, so there is no flat patch.
    c = conf[..., None]
    healed_lab = model.low + model.mid * (1.0 - c) + model.high * (1.0 - c * 0.30)
    healed = cv2.cvtColor(np.clip(healed_lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)

    blend = np.clip(conf, 0.0, 1.0)[..., None]
    out_crop = (crop.astype(np.float32) * (1 - blend) + healed.astype(np.float32) * blend)

    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(out_crop, 0, 255).astype(np.uint8)

    n, _, _stats, _ = cv2.connectedComponentsWithStats(
        (conf > 0.35).astype(np.uint8), connectivity=8
    )
    return out, {
        "spotsRemoved": max(0, n - 1),
        "correctedPx": int((conf > 0.35).sum()),
    }
