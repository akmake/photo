"""MaskProvider — the single place that answers "where is X in this image?".

Every AI tool in this product is (mask + operation). Adding a tool means
picking a mask kind here and writing the pixel operation — not wiring up a new
model each time. Models are MediaPipe (Apache 2.0), run locally.

Mask kinds:
  subject        — everything that isn't background   (background blur)
  hair           — hair only                          (hair tones)
  face-skin      — facial skin only                   (skin smoothing / cleanup)
  body-skin      — exposed non-face skin
  eyes           — both eye openings                  (eye sparkle)
  cheeks         — cheek patches                      (rosy blush)
  face-features  — eyes+brows+lips+nose: NEVER retouch (protection mask)
"""

import contextlib
import hashlib
import os
import threading
from collections import OrderedDict

import cv2
import numpy as np
import mediapipe as mp

import common
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

# selfie_multiclass_256x256 class ids
CLS_BACKGROUND = 0
CLS_HAIR = 1
CLS_BODY_SKIN = 2
CLS_FACE_SKIN = 3
CLS_CLOTHES = 4

_lock = threading.Lock()
_segmenter = None
_landmarker = None

# FaceMesh landmark index sets
LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
# Upper lid rims — the lash line the eyelid fold runs parallel to, just above.
LEFT_EYE_UPPER = [33, 246, 161, 160, 159, 158, 157, 173, 133]
RIGHT_EYE_UPPER = [263, 466, 388, 387, 386, 385, 384, 398, 362]
# Lower lid rims, corner to corner — the ridge the tear trough hangs under.
LEFT_LOWER_LID = [33, 7, 163, 144, 145, 153, 154, 155, 133]
RIGHT_LOWER_LID = [263, 249, 390, 373, 374, 380, 381, 382, 362]
LEFT_EYEBROW = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107]
RIGHT_EYEBROW = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336]
# The two corners of each eye (outer canthus, inner canthus). The landmark ring
# above is tight to the sclera opening; the canthus tissue — the reddish inner
# caruncle and the small skin fold at the outer corner — sits just OUTSIDE it.
EYE_CORNERS = {"l": (33, 133), "r": (263, 362)}
# Radius of the canthus protection cap, as a fraction of face width. Measured on
# 321A1809 (four faces): with the eye protected only by its hull + 3%, twelve
# detections landed within 0.18*face_d of a corner and TWO were accepted heals
# sitting on the corner itself (a baby's outer canthus at 0.04*face_d, a child's
# at 0.06). A disc here protects exactly that tissue without fattening the lid
# centre — the tight hull is deliberately kept (see anatomy_parts) so an outer-
# lid lesion stays reachable.
#
# Radius swept on those four faces (fresh masks, disk cache bypassed):
#   cap     corner heals   any corner cand.(d<.10)   real cheek heals
#   0.00        2                 8                       12
#   0.06        0                 3                       13
#   0.08        0                 0                       14
#   0.10        0                 0                       13   <- starts eating
#   0.12        0                 0                       12      real marks
# 0.08 clears every near-corner detection AND keeps the most real heals; larger
# only costs recall. Not a value fitted to one mark — it is the knee of the curve.
EYE_CORNER_CAP = 0.08
LIPS = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    409, 270, 269, 267, 0, 37, 39, 40, 185,
]
# The mouth APERTURE — the inner rim, where the lips stop and teeth, gums and
# tongue begin. `LIPS` above is the outer ring, and a convex hull of it swallows
# the opening whole: on an open mouth that is not "the lips", it is the lips
# plus everything behind them. Measured on 321A5078 (a laughing man, 179px face):
# 960px of teeth and gums sat inside `face-lips`, and the lip-gloss reduction
# treated them as lip surface — teeth came out dL -3.49 / da +1.83, i.e. darker
# and redder. Pink teeth, from an operator that was never asked to touch them.
LIPS_INNER = [
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
    324, 318, 402, 317, 14, 87, 178, 88, 95,
]
NOSE = [1, 2, 98, 97, 326, 327, 4, 45, 275, 220, 440]
LEFT_CHEEK_CENTER = 50
RIGHT_CHEEK_CENTER = 280
FACE_LEFT = 234
FACE_RIGHT = 454

# Anatomy the old feature hulls missed entirely: the face's own CREASES and
# contours. They read as strong deviations to the skin model — a fold changes
# lightness and a lip border is the highest-contrast edge on the face — so
# without them the detector spends its sensitivity on the person's structure
# instead of on dirt.
#
# These are derived from a few anchors that survive pose changes rather than
# from long hand-copied contour lists, and every band is deliberately THIN:
# a child's food and scratch marks sit millimetres from the mouth corner and
# the nasolabial fold, so a generous protection band here would make the marks
# we most need to remove permanently unreachable.
NOSE_ALA = (129, 358)  # outer edge of each nostril wing
NASION = 168  # bridge top, midway between the eyes
NOSE_TIP = 1
MOUTH_CORNERS = (61, 291)
LOWER_LIP_BOTTOM = 17
CHIN_CENTER = 199
FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
    379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93,
    234, 127, 162, 21, 54, 103, 67, 109,
]


def _segmenter_instance():
    global _segmenter
    with _lock:
        if _segmenter is None:
            opts = vision.ImageSegmenterOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=os.path.join(
                        MODELS_DIR, "selfie_multiclass_256x256.tflite"
                    )
                ),
                output_category_mask=True,
                # soft per-class probabilities — required for real matting,
                # a binary argmax mask turns hair into a paper cut-out
                output_confidence_masks=True,
            )
            _segmenter = vision.ImageSegmenter.create_from_options(opts)
    return _segmenter


def _landmarker_instance():
    global _landmarker
    with _lock:
        if _landmarker is None:
            opts = vision.FaceLandmarkerOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=os.path.join(MODELS_DIR, "face_landmarker.task")
                ),
                num_faces=6,
            )
            _landmarker = vision.FaceLandmarker.create_from_options(opts)
    return _landmarker


def _category_map(rgb: np.ndarray) -> np.ndarray:
    """Per-pixel class ids, cached like every other mask.

    This is the single most expensive call in the engine and it was the one
    thing reaching MediaPipe WITHOUT a cache: cleanup asks for landmarks per
    face crop, so one render of a group photo segmented the same pixels eleven
    times. Measured on 321A5078 at w=1400: 2.34s of a 5.24s render, every time.
    """
    key = _cache_key(rgb, "__category")
    hit = _CAT_CACHE.get(key)
    if hit is not None and hit.shape[:2] == rgb.shape[:2]:
        _CAT_CACHE.move_to_end(key)
        return hit

    on_disk = _disk_path(rgb, "__category")
    computed = _load_cached(on_disk, rgb)
    if not _reusable(computed, rgb, "__category"):
        computed = _segment(rgb)
        _save_cached(on_disk, computed.astype(np.uint8), rgb)

    cat = computed
    if cat.shape[:2] != rgb.shape[:2]:
        # class ids, so NEAREST — averaging two labels invents a third.
        cat = cv2.resize(
            cat.astype(np.uint8), (rgb.shape[1], rgb.shape[0]),
            interpolation=cv2.INTER_NEAREST,
        )
    _CAT_CACHE[key] = cat
    if len(_CAT_CACHE) > _CAT_CACHE_MAX:
        _CAT_CACHE.popitem(last=False)
    return cat


def _segment(rgb: np.ndarray) -> np.ndarray:
    """Per-pixel class ids from the multiclass selfie segmenter."""
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    result = _segmenter_instance().segment(mp_img)
    # some builds return (H, W, 1) — masks must always be 2-D
    #
    # np.array(), not np.asarray(): numpy_view() is a WINDOW onto memory that
    # MediaPipe frees with `result`. Reading it straight through was safe only
    # while every caller consumed it immediately; the cache above outlives the
    # result, and a view into freed memory segfaults the process rather than
    # raising. Copy at the boundary.
    cat = np.array(np.squeeze(result.category_mask.numpy_view()))
    h, w = rgb.shape[:2]
    if cat.shape[0] != h or cat.shape[1] != w:
        cat = cv2.resize(cat, (w, h), interpolation=cv2.INTER_NEAREST)
    return cat


def confidence_masks(rgb: np.ndarray):
    """Per-class soft probabilities (H, W) float32, indexed by class id."""
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    result = _segmenter_instance().segment(mp_img)
    h, w = rgb.shape[:2]
    out = []
    for m in result.confidence_masks:
        arr = np.squeeze(m.numpy_view()).astype(np.float32)
        if arr.shape[0] != h or arr.shape[1] != w:
            arr = cv2.resize(arr, (w, h), interpolation=cv2.INTER_LINEAR)
        out.append(arr)
    return out


LANDMARK_MAX_DIM = 1280


class _Pt:
    """A landmark remapped into full-frame normalised coordinates."""

    __slots__ = ("x", "y", "z")

    def __init__(self, x: float, y: float, z: float = 0.0):
        self.x = x
        self.y = y
        self.z = z


def _fit(img: np.ndarray, max_dim: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = max_dim / max(h, w)
    if s >= 1.0:
        return img
    return cv2.resize(
        img, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA
    )


def _detect_on(img: np.ndarray):
    mp_img = mp.Image(
        image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(_fit(img, LANDMARK_MAX_DIM))
    )
    return _landmarker_instance().detect(mp_img).face_landmarks


def _face_landmarks(rgb: np.ndarray):
    """Face landmarks in FULL-FRAME normalised coordinates.

    MediaPipe's bundled face detector is short-range: it expects a face to fill
    a good part of the frame and silently returns nothing for a face that is,
    say, 10% of a 3648px-wide camera file. That made every landmark-based mask
    (eyes, cheeks, features) come back EMPTY on real full-resolution photos —
    silently disabling feature protection.

    So: try the whole frame first (cheap, fine for tight portraits) — but do
    NOT trust it to be COMPLETE. The short-range detector routinely drops the
    smallest head in a group (measured: 3 of 4 faces in a 2330px crop — the
    baby vanished, and with him every landmark mask on his face, so cleanup's
    eligible region there was literally zero). Every face-skin blob the
    segmenter sees — it works at any scale — that no detected face claims gets
    the per-blob pass, whether the frame pass found zero faces or three.
    """
    h, w = rgb.shape[:2]

    out = list(_detect_on(rgb) or [])

    cat = _category_map(rgb)
    face_skin = (cat == CLS_FACE_SKIN).astype(np.uint8)
    if not face_skin.any():
        return out

    def noses():
        return [(f[NOSE_TIP].x * w, f[NOSE_TIP].y * h) for f in out]

    n, labels, stats, _ = cv2.connectedComponentsWithStats(face_skin, connectivity=8)
    min_area = max(64, int(0.00002 * h * w))
    for i in range(1, n):
        if int(stats[i, cv2.CC_STAT_AREA]) < min_area:
            continue
        bx = int(stats[i, cv2.CC_STAT_LEFT])
        by = int(stats[i, cv2.CC_STAT_TOP])
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        # a blob already claimed by a detected face needs no second pass
        if any(
            bx - bw * 0.3 <= nx <= bx + bw * 1.3 and by - bh * 0.3 <= ny <= by + bh * 1.3
            for nx, ny in noses()
        ):
            continue
        # generous padding: the skin class excludes hair, brows and lips, so the
        # real head is considerably larger than this box
        pad = int(max(bw, bh) * 0.6)
        x0 = max(0, bx - pad)
        y0 = max(0, by - pad)
        x1 = min(w, bx + bw + pad)
        y1 = min(h, by + bh + pad)
        cw, ch = x1 - x0, y1 - y0
        if cw < 32 or ch < 32:
            continue
        for lms in _detect_on(rgb[y0:y1, x0:x1]):
            mapped = [
                _Pt((x0 + p.x * cw) / w, (y0 + p.y * ch) / h, getattr(p, "z", 0.0))
                for p in lms
            ]
            # the padded crop can re-find a neighbour the frame pass already
            # has — one nose, one face
            mx, my = mapped[NOSE_TIP].x * w, mapped[NOSE_TIP].y * h
            fw_new = abs(mapped[FACE_RIGHT].x - mapped[FACE_LEFT].x) * w
            if all(
                np.hypot(mx - nx, my - ny) >= max(24.0, fw_new * 0.5)
                for nx, ny in noses()
            ):
                out.append(mapped)
    return out


def face_boxes(rgb: np.ndarray, pad_x=0.35, pad_top=0.35, pad_bot=0.65):
    """Per-face crop boxes for tools whose thresholds scale from face_d.

    sqrt(total skin area) reads a group as one giant face — four ~250px
    children as a 557px face — and every size-relative parameter runs ~2x
    coarse (cleanup missed marks; smoothing ate texture). Tools dispatch on
    len(boxes) >= 2 and run their unchanged single-face pipeline per crop.
    """
    h, w = rgb.shape[:2]
    out = []
    for lm in _face_landmarks(rgb):
        xs = [p.x * w for p in lm]
        ys = [p.y * h for p in lm]
        fw = float(np.hypot((lm[FACE_RIGHT].x - lm[FACE_LEFT].x) * w,
                            (lm[FACE_RIGHT].y - lm[FACE_LEFT].y) * h))
        if fw < 40:
            continue
        x0 = max(0, int(min(xs) - fw * pad_x))
        x1 = min(w, int(max(xs) + fw * pad_x))
        y0 = max(0, int(min(ys) - fw * pad_top))
        y1 = min(h, int(max(ys) + fw * pad_bot))
        if x1 - x0 >= 48 and y1 - y0 >= 48:
            out.append((x0, y0, x1, y1))
    return out


def _poly_mask(rgb: np.ndarray, polys, feather_px: int) -> np.ndarray:
    h, w = rgb.shape[:2]
    m = np.zeros((h, w), dtype=np.uint8)
    for poly in polys:
        if len(poly) >= 3:
            cv2.fillPoly(m, [np.array(poly, dtype=np.int32)], 255)
    if feather_px > 0:
        k = feather_px * 2 + 1
        m = cv2.GaussianBlur(m, (k, k), 0)
    return m.astype(np.float32) / 255.0


def _kern(size: float) -> np.ndarray:
    k = max(1, int(size)) | 1
    return np.ones((k, k), np.uint8)


def anatomy_parts(rgb: np.ndarray, lm) -> "OrderedDict[str, np.ndarray]":
    """Named protection regions for one face, as uint8 masks.

    Returned per part (rather than pre-merged) so the debug view and the mask
    are built from the same source — a protection region that is wrong is
    otherwise invisible until it silently blocks a repair.
    """
    h, w = rgb.shape[:2]
    fw = max(1.0, abs(lm[FACE_RIGHT].x - lm[FACE_LEFT].x) * w)

    def pt(i):
        return (int(round(lm[i].x * w)), int(round(lm[i].y * h)))

    def blank():
        return np.zeros((h, w), np.uint8)

    parts: "OrderedDict[str, np.ndarray]" = OrderedDict()

    # Eye, brow and the fold between them, each protected as what it actually is.
    #
    # These were one convex hull, because separate hulls left the eyelid crease
    # exposed and the detector kept flagging it. That worked, and it walled off
    # the entire upper orbit: an inflamed patch on the OUTER lid measured 0.0%
    # eligible — zero pixels, confidence never even computed — while its colour
    # said pigment outright (da=+3.0, db=+4.7 against the surrounding ring), the
    # exact class this tool exists for. A protection that a real lesion cannot
    # escape is not caution, it is a blind spot.
    #
    # So: hulls for the things that ARE regions, and a band for the thing that
    # is a line. A hull spanning lash line to brow is convex, so it bulges past
    # the outer canthus and swallows the lid — the same "fat hull" mistake the
    # lip mask already made once. The fold is a stripe above the lash line;
    # protect it as one. Measured at lift 0.035 / thickness 0.05: crease healing
    # stays at 1px (identical to the merged hull) and the lid opens to 13.3%.
    for side, eye, brow, upper in (
        ("l", LEFT_EYE, LEFT_EYEBROW, LEFT_EYE_UPPER),
        ("r", RIGHT_EYE, RIGHT_EYEBROW, RIGHT_EYE_UPPER),
    ):
        m = blank()
        cv2.fillConvexPoly(m, cv2.convexHull(np.array([pt(i) for i in eye], np.int32)), 255)
        m = cv2.dilate(m, _kern(fw * 0.030))  # lashes sit outside the ring
        # Canthus caps at both corners. The hull's own vertices ARE the corner
        # landmarks, so the 3% margin reaches only ~3% past them — and the corner
        # tissue the skin model keeps flagging (caruncle, outer skin fold) lives
        # just beyond that. A disc centred on each corner covers it. See
        # EYE_CORNER_CAP for the measurement that set the radius.
        for cid in EYE_CORNERS[side]:
            cx, cy = pt(cid)
            cv2.circle(m, (cx, cy), max(2, int(fw * EYE_CORNER_CAP)), 255, -1)
        parts[f"eye-{side}"] = m

        m = blank()
        cv2.fillConvexPoly(m, cv2.convexHull(np.array([pt(i) for i in brow], np.int32)), 255)
        parts[f"brow-{side}"] = cv2.dilate(m, _kern(fw * 0.012))

        m = blank()
        pts = np.array([(x, y - fw * 0.035) for x, y in (pt(i) for i in upper)], np.int32)
        cv2.polylines(m, [pts[np.argsort(pts[:, 0])]], False, 255, max(2, int(fw * 0.050)))
        parts[f"eyelid-crease-{side}"] = m

    # Infraorbital hollow — the tear trough. Audited: 6 of 22 healed lesions sat
    # in this band and every one was orbital shadow rather than dirt, another 2
    # sat on the lid rim itself: 30% of all healing spent giving a small child
    # retouched under-eyes. The colour weighting does not filter it, because the
    # hollow is not merely darker — it is BLUISH, a genuine `b` deviation.
    # A band that follows the lid, never a disc: the cheek below it is exactly
    # where a child's real scratches live.
    for name, lid in (("infraorbital-l", LEFT_LOWER_LID), ("infraorbital-r", RIGHT_LOWER_LID)):
        m = blank()
        pts = np.array([pt(i) for i in lid], np.int32)
        pts = pts[np.argsort(pts[:, 0])]
        drop = max(2, int(fw * 0.12))
        cv2.fillPoly(m, [np.vstack([pts, (pts + [0, drop])[::-1]])], 255)
        parts[name] = m

    m = blank()
    cv2.fillConvexPoly(m, cv2.convexHull(np.array([pt(i) for i in NOSE], np.int32)), 255)
    parts["nose"] = cv2.dilate(m, _kern(fw * 0.010))

    # Nose dorsum and flanks. The shading band along the side of the bridge is
    # illumination geometry, and every statistical gate that tried to except
    # it eventually let a "repair" flatten the nose. The bridge's position is
    # KNOWN from landmarks — protect it as anatomy instead of arguing with it
    # as statistics.
    m = blank()
    cv2.line(m, pt(NASION), pt(NOSE_TIP), 255, max(2, int(fw * 0.14)))
    parts["nose-bridge"] = m

    # Lips: the vermillion border is the highest-contrast edge on a face. It is
    # protected as a THIN band, not by fattening the hull — a fat lip mask is
    # what blocked healing of the marks beside the mouth.
    m = blank()
    cv2.fillConvexPoly(m, cv2.convexHull(np.array([pt(i) for i in LIPS], np.int32)), 255)
    parts["lips"] = cv2.dilate(m, _kern(fw * 0.012))

    # Nasolabial fold: ala of the nose to the mouth corner. Kept narrow on
    # purpose — the scratch we are trying to remove sits right beside it.
    m = blank()
    for ala, corner in zip(NOSE_ALA, MOUTH_CORNERS):
        cv2.line(m, pt(ala), pt(corner), 255, max(2, int(fw * 0.022)))
    parts["nasolabial"] = m

    # Mentolabial sulcus: the crease under the lower lip.
    m = blank()
    lip = pt(LOWER_LIP_BOTTOM)
    chin = pt(CHIN_CENTER)
    mid = ((lip[0] + chin[0]) // 2, (lip[1] + chin[1]) // 2)
    cv2.ellipse(
        m,
        mid,
        (max(2, int(fw * 0.16)), max(2, int(fw * 0.035))),
        0,
        0,
        360,
        255,
        -1,
    )
    parts["chin-crease"] = m

    # Face contour: the jaw/hairline edge is a tonal cliff, not skin.
    m = blank()
    oval = np.array([pt(i) for i in FACE_OVAL], np.int32)
    cv2.polylines(m, [oval], True, 255, max(2, int(fw * 0.030)))
    parts["contour"] = m

    return parts


_CACHE: "OrderedDict[tuple, np.ndarray]" = OrderedDict()
_CACHE_MAX = 24

# The segmenter's own small cache. It holds class-id maps, which are bigger
# than a mask and asked for far fewer times, so it is short.
_CAT_CACHE: "OrderedDict[tuple, np.ndarray]" = OrderedDict()
_CAT_CACHE_MAX = 8

# Cache invalidation when the mask CODE changes.
#
# Both caches below key on the IMAGE only. So after any edit to how a mask is
# computed, a stale mask keeps being served for every already-seen frame — in
# the app AND in tests — with no error and no warning. That silent staleness
# once cost a whole debugging session: an eye-corner fix "did nothing" because
# the disk still held the pre-fix anatomy mask, and the app and a fresh script
# disagreed on the SAME image for no visible reason.
#
# The key must therefore carry a token that moves when this file's logic moves.
# A content hash of the module source is automatic — it cannot be forgotten the
# way a hand-bumped version number is. It over-invalidates on a comment edit,
# but recomputation is cheap next to shipping a wrong mask, and mask code is not
# edited often. Old on-disk files simply stop matching and are recomputed.
try:
    _MASK_CODE_VERSION = hashlib.blake2b(
        open(__file__, "rb").read(), digest_size=6
    ).hexdigest()
except OSError:  # source unreadable (frozen/zipped) — degrade to per-process
    _MASK_CODE_VERSION = "src"

# When a whole recipe is rendered, every tool receives the OUTPUT of the
# previous one — so masks would be recomputed for each step. Masks describe
# *where things are*, and retouching does not move them, so they are computed
# once from the pristine original. This is both faster and more stable.
_source = threading.local()


def set_source(rgb: np.ndarray, key: str | None = None) -> None:
    """`key` names the PHOTOGRAPH, not this particular rendering of it.

    Without it the disk cache can only key on the pixels it is handed, and the
    pixels change with the panel width — so the same photograph at 1100px and
    at 1400px were two different cache entries and the second one paid the full
    segmentation again. Measured: 3.7s for a seen frame, 17.3s for the same
    frame one resize later. A window resize re-segmented the whole set.
    """
    _source.rgb = rgb
    _source.key = key
    _source.scope = ()


def clear_source() -> None:
    _source.rgb = None
    _source.key = None
    _source.scope = ()


@contextlib.contextmanager
def scope(name: str):
    """Name a sub-frame so its masks get an identity of their own.

    Cleanup works each face in its own crop, and a crop is a different picture
    to a content hash — including at a different panel width, where the crop is
    a different SIZE. Naming the crop by where it sits in the frame (0..1, so
    it does not move with the width) keeps its masks addressable across renders.
    """
    prev = getattr(_source, "scope", ())
    _source.scope = prev + (str(name),)
    try:
        yield
    finally:
        _source.scope = prev


# How far two 8x8 thumbnails may drift and still be the same picture. The same
# photograph resampled to two panel widths lands within a level or two; another
# crop of it is off by tens. A disagreement costs one recomputation — never a
# mask borrowed from a different picture.
_FINGERPRINT_TOL = 8.0


def _fingerprint(rgb: np.ndarray) -> np.ndarray:
    """8x8 averages — what the picture looks like, independent of its size."""
    return cv2.resize(rgb, (8, 8), interpolation=cv2.INTER_AREA).astype(np.uint8)


def _same_picture(a: np.ndarray, b: np.ndarray) -> bool:
    if a is None or b is None or a.shape != b.shape:
        return False
    return float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean()) <= _FINGERPRINT_TOL


def _identity(kind: str, rgb: np.ndarray) -> str | None:
    """A cache name for this picture, or None when the photograph is unknown.

    The name has to carry a coarse look at the pixels, and that is not
    negotiable: cleanup crops per face and some passes crop again inside that,
    without a scope of their own. Naming an entry by the photograph alone made
    every one of those sub-crops write to the SAME file and then reject it on
    the way back — measured as 33 files serving 90 distinct masks, and a warm
    render no faster than a cold one.

    So the name is quantised, not exact: 8x8 averages at 16 levels, which the
    same picture at two panel widths usually agrees on. When it does not, the
    cost is one recomputation. The fingerprint stored inside the file is the
    second lock — it is what makes "usually" safe.
    """
    key = getattr(_source, "key", None)
    if not key:
        return None
    tiny = cv2.resize(rgb, (8, 8), interpolation=cv2.INTER_AREA)
    coarse = hashlib.blake2b((tiny >> 4).tobytes(), digest_size=8).hexdigest()
    parts = "|".join(
        (str(key),) + tuple(getattr(_source, "scope", ())) + (kind, coarse)
    )
    return hashlib.blake2b(parts.encode("utf-8"), digest_size=16).hexdigest()


def _load_cached(on_disk: str, rgb: np.ndarray):
    """The stored array, but only if it was computed from THIS picture."""
    try:
        if on_disk.endswith(".npz"):
            with np.load(on_disk) as z:
                if not _same_picture(z["fp"], _fingerprint(rgb)):
                    return None
                return z["a"]
        return np.load(on_disk)
    except Exception:  # noqa: BLE001 — a bad cache file is not a failure
        return None


def _save_cached(on_disk: str, arr: np.ndarray, rgb: np.ndarray) -> None:
    try:
        os.makedirs(os.path.dirname(on_disk), exist_ok=True)
        # The suffix has to match what numpy writes: np.save APPENDS ".npy" and
        # np.savez_compressed APPENDS ".npz" to any name lacking it, so a plain
        # ".tmp" was written under a different name than the os.replace below
        # then looked for. That OSError was swallowed and the cache silently
        # stored nothing while the directory filled with orphaned temp files.
        if on_disk.endswith(".npz"):
            tmp = on_disk + ".tmp.npz"
            np.savez_compressed(tmp, a=arr, fp=_fingerprint(rgb))
        else:
            tmp = on_disk + ".tmp.npy"
            np.save(tmp, arr)
        os.replace(tmp, on_disk)
    except OSError:
        pass  # a cache that cannot be written still serves pixels


def _cache_key(rgb: np.ndarray, kind: str) -> tuple:
    # hash a small thumbnail: cheap, and identical frames hit the cache
    thumb = cv2.resize(rgb, (64, 64), interpolation=cv2.INTER_AREA)
    return (kind, _MASK_CODE_VERSION, rgb.shape,
            hashlib.blake2b(thumb.tobytes(), digest_size=16).digest())


def _disk_dir() -> str:
    base = (
        os.environ.get("TEZA_HOME")
        or os.environ.get("LOCALAPPDATA")
        or os.path.expanduser("~")
    )
    return os.path.join(base, "TEZA", "cache", "masks")


def _disk_path(small: np.ndarray, kind: str) -> str:
    """Keyed on the PICTURE, never on the recipe.

    A mask says where the subject, the skin and the fabric are. Grading the
    frame does not move them, so a look that changes must not cost the
    segmentation again — that was the difference between re-grading a set in a
    moment and re-grading it in minutes.
    """
    # `_MASK_CODE_VERSION` in the filename: a mask computed by older code stops
    # matching instead of being served stale. See the note by that constant.
    ident = _identity(kind, small)
    if ident is not None:
        return os.path.join(_disk_dir(), f"id-{ident}-{_MASK_CODE_VERSION}.npz")
    # No named photograph: fall back to hashing the pixels we were handed. This
    # is correct but width-bound — every size pays its own segmentation.
    digest = hashlib.blake2b(
        np.ascontiguousarray(small).tobytes(), digest_size=16
    ).hexdigest()
    return os.path.join(_disk_dir(), f"{digest}-{_MASK_CODE_VERSION}-{kind}.npy")


def _reusable(computed, small: np.ndarray, kind: str) -> bool:
    """Is a cached array good enough for the frame in hand?

    Only at the SAME size. Reusing a mask across sizes was tried and measured:
    stretching a 1024px mask onto a 1280px frame moved single pixels by up to
    38 levels, and even scaling one DOWN left 17, both of them along the edges
    of the marks being healed — which is exactly where a retouch is judged.

    Nothing is lost by refusing: the server renders on a fixed ladder of widths
    (see _quantise_width), so a panel returns to the same size every time and
    the entry matches exactly. A window dragged to another rung pays once.
    Reuse must buy time, never accuracy.
    """
    return computed is not None and computed.shape[:2] == small.shape[:2]


def get_mask(rgb: np.ndarray, kind: str) -> np.ndarray:
    """Return a float32 mask in 0..1 with the same H,W as the image.

    Masks are computed at PROC_MAX_DIM and upscaled: they carry no fine detail,
    so running segmentation maths on a 20MP frame is wasted work. Results are
    cached because a tool chain asks for the same masks repeatedly.

    TWO caches, and the second one is why a set stops costing minutes. The
    in-memory one serves the same frame inside one render; the DISK one serves
    it across widths, across recipes and across restarts. Measured on a frame
    with a learned colour on it: 11.8s to segment, 0.1s once the masks exist.
    The strip, the picker and the contact sheet were each paying the 11.8s.

    What is written to disk is the SMALL mask, before the upscale — a fraction
    of the bytes, and it goes back through the identical upscale on the way
    out, so a cached frame and a freshly computed one produce the same array.
    """
    src = getattr(_source, "rgb", None)
    if src is not None and src.shape == rgb.shape:
        rgb = src

    key = _cache_key(rgb, kind)
    hit = _CACHE.get(key)
    if hit is not None:
        _CACHE.move_to_end(key)
        return hit

    small = common.downscale(rgb)

    on_disk = _disk_path(small, kind)
    computed = _load_cached(on_disk, small)
    if not _reusable(computed, small, kind):
        computed = _compute_mask(small, kind)
        _save_cached(on_disk, computed.astype(np.float32), small)

    mask = np.clip(common.upscale_to(computed, rgb.shape), 0.0, 1.0)

    _CACHE[key] = mask
    if len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return mask


def _compute_mask(rgb: np.ndarray, kind: str) -> np.ndarray:
    h, w = rgb.shape[:2]

    if kind == "subject":
        # delegated to the dedicated matting tool (soft alpha, crop-refined).
        # imported lazily because matting imports this module.
        from matting import subject_alpha

        return subject_alpha(rgb)

    if kind in ("hair", "face-skin", "body-skin"):
        cat = _category_map(rgb)
        if kind == "hair":
            m = (cat == CLS_HAIR)
        elif kind == "face-skin":
            m = (cat == CLS_FACE_SKIN)
        else:
            m = (cat == CLS_BODY_SKIN)
        return m.astype(np.float32)

    if kind == "face-features":
        # Everything a retoucher masks OFF before healing skin: eyes, eyebrows,
        # lips and nostrils. Removing "dark spots" inside these erases the
        # person's actual features.
        faces = _face_landmarks(rgb)
        if not faces:
            return np.zeros((h, w), dtype=np.float32)
        m = np.zeros((h, w), dtype=np.uint8)
        for lm in faces:
            fw = abs(lm[FACE_RIGHT].x - lm[FACE_LEFT].x) * w
            # Hair-bearing features need a margin (a stray lash or brow hair
            # sits outside the landmark ring). Lips and nose do not — an over-
            # generous margin there blocks healing of marks beside the mouth,
            # which is exactly where a child's food/irritation marks live.
            for idx_set, grow_ratio in (
                (LEFT_EYE, 0.030),
                (RIGHT_EYE, 0.030),
                (LEFT_EYEBROW, 0.030),
                (RIGHT_EYEBROW, 0.030),
                (LIPS, 0.004),
                (NOSE, 0.004),
            ):
                pts = np.array(
                    [[lm[i].x * w, lm[i].y * h] for i in idx_set], dtype=np.float32
                )
                hull = cv2.convexHull(pts.astype(np.int32))
                part = np.zeros((h, w), dtype=np.uint8)
                cv2.fillConvexPoly(part, hull, 255)
                g = max(1, int(fw * grow_ratio))
                part = cv2.dilate(part, np.ones((g, g), np.uint8))
                m = np.maximum(m, part)
        k = max(3, int(min(h, w) * 0.003)) | 1
        return cv2.GaussianBlur(m, (k, k), 0).astype(np.float32) / 255.0

    if kind == "face-anatomy":
        # Superset of `face-features`: adds the face's own creases and contour.
        faces = _face_landmarks(rgb)
        if not faces:
            return np.zeros((h, w), dtype=np.float32)
        m = np.zeros((h, w), dtype=np.uint8)
        for lm in faces:
            for part in anatomy_parts(rgb, lm).values():
                m = np.maximum(m, part)
        k = max(3, int(min(h, w) * 0.003)) | 1
        return cv2.GaussianBlur(m, (k, k), 0).astype(np.float32) / 255.0

    if kind == "face-lips":
        # The lip vermilion on its own. Every other mask here either protects the
        # lips or ignores them; `specular.py` needs to WORK inside them, which no
        # existing kind expresses. Tight (no margin): a generous lip mask would
        # let highlight reduction spill onto the philtrum and the skin below.
        faces = _face_landmarks(rgb)
        if not faces:
            return np.zeros((h, w), dtype=np.float32)
        m = np.zeros((h, w), dtype=np.uint8)
        for lm in faces:
            pts = np.array([[lm[i].x * w, lm[i].y * h] for i in LIPS], np.int32)
            cv2.fillPoly(m, [cv2.convexHull(pts)], 255)
            # ... and take the mouth opening back out. The hull is the right
            # shape for a closed mouth and the wrong one for an open mouth,
            # where it also contains teeth, gums and tongue — none of which are
            # a lip and none of which anyone asked this mask to reach. NOT a
            # hull: the aperture is genuinely concave when the mouth is open,
            # and on a closed mouth the ring collapses to a line, so this
            # subtracts almost nothing and the mask is unchanged.
            inner = np.array([[lm[i].x * w, lm[i].y * h] for i in LIPS_INNER],
                             np.int32)
            cv2.fillPoly(m, [inner], 0)
        k = max(3, int(min(h, w) * 0.002)) | 1
        return cv2.GaussianBlur(m, (k, k), 0).astype(np.float32) / 255.0

    if kind == "face-eye-region":
        # Eyes, brows, lid creases and the infraorbital strip — nothing else.
        #
        # Exists for the FLUID pass, which needs the opposite exclusion from
        # every other path: a drool strand or a runny nose starts at the mouth or
        # a nostril and runs down, so the mouth and nose must stay INSIDE its
        # search zone while the eyes must be out. Handing it the whole
        # `face-anatomy` mask (the obvious fix for the eye bug below) set lip
        # reachability to exactly 0.000 and made drool permanently unreachable.
        #
        # The eye bug it guards against is not hypothetical. On a 290px face the
        # fluid pass rewrote 111 RGB units on a child's lower lid, and on a baby
        # it nominated BOTH eyes as fluid candidates — saved only by the
        # runs-downward gate at 0.45 against a 0.55 bar. A 0.10 margin in one
        # parameter is not a safety mechanism.
        faces = _face_landmarks(rgb)
        if not faces:
            return np.zeros((h, w), dtype=np.float32)
        m = np.zeros((h, w), dtype=np.uint8)
        for lm in faces:
            for name, part in anatomy_parts(rgb, lm).items():
                if name.startswith(("eye", "brow", "infraorbital")):
                    m = np.maximum(m, part)
        k = max(3, int(min(h, w) * 0.003)) | 1
        return cv2.GaussianBlur(m, (k, k), 0).astype(np.float32) / 255.0

    if kind == "face-pigment-protect":
        # What a COLOUR correction must stay off — which is much less than what a
        # reconstruction must stay off, and conflating the two was expensive.
        #
        # `face-anatomy` withholds every crease, the contour band and the
        # nasolabial fold because reconstruction would flatten them. Handing that
        # same mask to pigment evening covered ~1.0 of every strong papule that
        # survived at full strength — the marks most needing removal were
        # permanently unreachable. So the three pure-geometry parts are freed.
        #
        # The ORIGINAL justification for freeing them was "a crease carries no
        # colour excess, and it is a line, so both of that operator's gates
        # reject it". THE FIRST HALF IS FALSE and was measured on three faces:
        # a crease is a shadowed groove and shadowed skin is redder AND yellower,
        # so the colour gate reads 0.98 on a real nasolabial fold. Freeing them
        # here is still right — a landmark band is the wrong instrument, it is a
        # straight line covering 0-20.7% of the real fold — but what makes it
        # SAFE is pigment.crease_map, which measures the fold from the image.
        # Do not widen this mask back; fix the measurement if it under-covers.
        #
        # So this is `face-anatomy` MINUS the three parts that are pure geometry:
        # the nasolabial fold, the chin crease and the contour band. Those are
        # lines with no colour of their own, and freeing them is what makes the
        # marks living on the cheek, jaw and nose reachable at all.
        #
        # Everything else stays protected, including the parts a colour operator
        # might seem able to handle safely:
        #   · INFRAORBITAL — its darkness is anatomy, but it is BLUISH, a true `b`
        #     deviation, so the colour gate does not recognise it as structure.
        #     Unprotected, a child gains smudged under-eye circles.
        #   · EYELID CREASE and the eye hulls — measured on a 290px face, freeing
        #     these for colour raised eye-region damage from 1.65 to 2.56 mean.
        #     A small face has no margin: the lash line and the lid are within a
        #     few pixels of each other, so a band that is safe at 573px is not.
        # Tried and rejected: freeing the infraorbital strip for colour while
        # blocking only the lift. It bought 3 marks out of 222 and cost that.
        skip = ("nasolabial", "chin-crease", "contour")
        base = _compute_mask(rgb, "face-features")
        faces = _face_landmarks(rgb)
        if not faces:
            return base
        m = np.zeros((h, w), dtype=np.uint8)
        for lm in faces:
            for name, part in anatomy_parts(rgb, lm).items():
                if not name.startswith(skip):
                    m = np.maximum(m, part)
        k = max(3, int(min(h, w) * 0.003)) | 1
        kept = cv2.GaussianBlur(m, (k, k), 0).astype(np.float32) / 255.0
        return np.clip(np.maximum(base, kept), 0.0, 1.0)

    if kind == "face-oval":
        # Containment, not protection: the filled facial contour.
        #
        # `face-skin` comes from segmentation and happily includes the EAR, the
        # neck and jaw spill — all of it real skin, none of it a face. Measured
        # on the test frame: 28% of every pixel the cleanup healed landed there,
        # on 5.6% of the eligible area — a fivefold over-representation, and
        # the ear is a mass of ridges and shadow that no skin model can explain.
        # Fails OPEN (all ones) when there are no landmarks, so this can only
        # ever narrow a face we actually found.
        faces = _face_landmarks(rgb)
        if not faces:
            return np.ones((h, w), dtype=np.float32)
        m = np.zeros((h, w), dtype=np.uint8)
        for lm in faces:
            pts = np.array([[lm[i].x * w, lm[i].y * h] for i in FACE_OVAL], np.int32)
            cv2.fillPoly(m, [pts], 255)
        k = max(3, int(min(h, w) * 0.003)) | 1
        return cv2.GaussianBlur(m, (k, k), 0).astype(np.float32) / 255.0

    if kind in ("eyes", "cheeks"):
        faces = _face_landmarks(rgb)
        if not faces:
            return np.zeros((h, w), dtype=np.float32)

        if kind == "eyes":
            polys = []
            for lm in faces:
                for idx_set in (LEFT_EYE, RIGHT_EYE):
                    polys.append([(lm[i].x * w, lm[i].y * h) for i in idx_set])
            return _poly_mask(rgb, polys, feather_px=max(1, int(min(h, w) * 0.002)))

        # cheeks: soft discs sized relative to each face
        m = np.zeros((h, w), dtype=np.uint8)
        for lm in faces:
            fw = abs(lm[FACE_RIGHT].x - lm[FACE_LEFT].x) * w
            r = max(3, int(fw * 0.16))
            for idx in (LEFT_CHEEK_CENTER, RIGHT_CHEEK_CENTER):
                cv2.circle(m, (int(lm[idx].x * w), int(lm[idx].y * h)), r, 255, -1)
        k = max(3, int(min(h, w) * 0.02)) | 1
        m = cv2.GaussianBlur(m, (k, k), 0)
        return m.astype(np.float32) / 255.0

    raise ValueError(f"unknown mask kind: {kind}")
