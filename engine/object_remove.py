"""Per-photo object removal: click selection and reproducible local fill.

The selected mask is stored in the recipe as PNG bytes. It is deliberately
independent of a fresh segmentation run: preview and export use the same
selection, scaled to their respective frame sizes.
"""

import base64
import threading

import cv2
import numpy as np

import gen_fill
import lama_fill
import manual_clean
import object_fill
import paths

SELECT_MAX_DIM = 1024
#: Fraction of frame width the selection is grown by before the fill.
#:
#: A fringe, and nothing more. The segmenter stops a few pixels inside the
#: outline, and this covers that.
#:
#: IT MUST NOT BE USED TO CATCH WHAT THE SEGMENTER MISSED. On 321A4954 it left
#: the tip of a held phone and the dark toe of a shoe outside the outline, and
#: 1% of the frame width (55px there) cleared both. It also inflated the mask
#: into a balloon over the horse's chest in 321A5078, a hand's width past
#: anything the man occupied, and the fill replaced photographed horse with
#: invented background. That trade is the wrong way round: a leftover sliver
#: the photographer brushes away in a second costs him a second, and a chest
#: rebuilt out of nothing costs him the frame. Leftovers belong to the brush.
DEFAULT_MARGIN = 0.003
SWALLOW = 12  # a candidate this much larger than the click is the scene, not it
#: Where the segmenter's own confidence is cut into a yes or a no.
#:
#: Its default, 0, is the outline it is sure of, and it stops short: on
#: 321A4954 the dark toe of the man's shoe, against ground it barely contrasts
#: with, fell outside. Reading the outline at -4 takes in what it half-believed
#: and nothing else — the mask grows by 5%, the toe comes in, and the balloon a
#: blunt dilation put over the horse's chest in 321A5078 does not appear,
#: because there the answer is not uncertain, it is no.
MASK_THRESHOLD = -4.0
_predictor = None
_predict_lock = threading.Lock()


def _thin(mask: np.ndarray) -> bool:
    """Long and narrow — a rein, a rope, a pipe, a wire: its skeleton is more
    than THIN_RATIO times its typical half-width."""
    m8 = mask.astype(np.uint8)
    if m8.sum() < 20:
        return False
    skeleton = cv2.ximgproc.thinning(m8 * 255) > 0
    half = cv2.distanceTransform(m8, cv2.DIST_L2, 3)[skeleton]
    return len(half) > 0 and skeleton.sum() > THIN_RATIO * max(1.0, float(np.median(half)))


#: Skeleton length over half-width above which an object counts as thin.
THIN_RATIO = 25


def _choose_candidate(candidates: np.ndarray, scores: np.ndarray, thin_first: bool = False) -> int:
    """Prefer the enclosing object when the predictor also offers a part.

    A shirt can score a little higher than the whole person. Keep the broader
    candidate only when it contains the precise one, is similarly confident,
    and is not the scene itself: past half the frame, or more than SWALLOW
    times the area it was supposed to extend, it is no longer that object.
    A subject can legitimately fill a third of a portrait, so the guard is a
    ratio to what was clicked, not a small fixed share of the frame. The caller
    still receives every candidate for visual review.
    """
    if thin_first:
        # A thin thing is attached to something, and "the object enclosing
        # it" is that something: a click on the rein in 321A5089 took the
        # rein AND the horse's head; on the black pipe in 321A5078, the post.
        # When the smallest answer is thin, it is what was clicked.
        smallest = min(range(len(candidates)), key=lambda i: int(candidates[i].sum()))
        if _thin(candidates[smallest]):
            return smallest
    best = int(np.argmax(scores))
    core = candidates[best].astype(bool)
    core_area = int(core.sum())
    if not core_area:
        return best
    eligible = [best]
    for index, candidate in enumerate(candidates):
        if index == best or float(scores[index]) < float(scores[best]) - 0.03:
            continue
        expanded = candidate.astype(bool)
        area = int(expanded.sum())
        if area <= core_area or area > SWALLOW * core_area:
            continue
        if area / expanded.size > 0.5:
            continue
        if np.count_nonzero(core & expanded) / core_area < 0.85:
            continue
        eligible.append(index)
    return max(eligible, key=lambda index: int(candidates[index].sum()))


def _mask_data(mask: np.ndarray) -> str:
    ok, png = cv2.imencode(".png", (mask > 0).astype(np.uint8) * 255)
    if not ok:
        raise RuntimeError("Could not encode object mask")
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _read_mask(data: str, shape: tuple, smooth: bool = False) -> np.ndarray:
    if not isinstance(data, str) or not data.startswith("data:image/png;base64,"):
        raise ValueError("Object removal requires a PNG selection mask")
    try:
        raw = base64.b64decode(data.split(",", 1)[1], validate=True)
        if len(raw) > 16_000_000:
            raise ValueError("Object mask is too large")
        mask = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValueError("Invalid object mask") from exc
    if mask is None or mask.size == 0:
        raise ValueError("Invalid object mask")
    h, w = shape[:2]
    interp = cv2.INTER_LINEAR if smooth else cv2.INTER_NEAREST
    return (cv2.resize(mask, (w, h), interpolation=interp) > 127).astype(np.uint8)


_image_key = None  # which picture the predictor holds; None = unknown


def _small(rgb: np.ndarray) -> np.ndarray:
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError("Selection requires an RGB photograph")
    h, w = rgb.shape[:2]
    scale = min(1.0, SELECT_MAX_DIM / max(h, w))
    return cv2.resize(rgb, (max(1, round(w * scale)), max(1, round(h * scale))),
                      interpolation=cv2.INTER_AREA) if scale < 1 else rgb


def _hold(small: np.ndarray, key) -> None:
    """Make the predictor hold this picture. Call under _predict_lock.

    Reading a picture costs ~0.3s; each question about it after that costs
    milliseconds. Hovering asks dozens of questions about one picture, so a
    picture with a key is read once and kept until another replaces it.
    """
    global _predictor, _image_key
    if _predictor is None:
        from mobile_sam import SamPredictor, sam_model_registry

        import os
        checkpoint = os.path.join(paths.models_dir(), "mobile_sam.pt")
        if not os.path.isfile(checkpoint):
            raise RuntimeError("MobileSAM model is unavailable")
        model = sam_model_registry["vit_t"](checkpoint=checkpoint).eval()
        _predictor = SamPredictor(model)
    if key is None or key != _image_key:
        _predictor.set_image(small)
        _image_key = key


def _points(small: np.ndarray, clicks) -> tuple:
    sh, sw = small.shape[:2]
    coords, labels = [], []
    for x, y, keep in clicks:
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError("Selection point must be inside the photograph")
        coords.append([min(sw - 1, round(x * (sw - 1))), min(sh - 1, round(y * (sh - 1)))])
        labels.append(1 if keep else 0)
    return np.array(coords), np.array(labels)


def _pick(small: np.ndarray, clicks, key, index=None):
    """-> (candidates, scores, chosen index) for these clicks. Under the lock."""
    _hold(small, key)
    coords, labels = _points(small, clicks)
    # One click is ambiguous (pipe, post, post and fence) and gets three
    # answers. With a "not this" click the prompt is no longer ambiguous, and
    # the segmenter's authors ask for its single answer then: on 321A5078 the
    # three-answer head still ranked post-and-fence first (0.882 vs 0.880 for
    # the pipe); the single answer is the pipe. No growth toward an enclosing
    # object either — the photographer has just said what it is not.
    several = len(clicks) > 1
    raw, scores, _ = _predictor.predict(point_coords=coords, point_labels=labels,
                                        multimask_output=not several, return_logits=True)
    candidates = (raw > MASK_THRESHOLD).astype(np.uint8)
    if len(candidates) == 0:
        raise RuntimeError("No object mask found at the selected point")
    if several:
        return candidates, scores, 0
    if index is not None and 0 <= int(index) < len(candidates):
        return candidates, scores, int(index)   # a repeat click asked for this size
    keep = _not_a_person(small, coords[0], candidates)
    chosen = _choose_candidate(candidates[keep], scores[keep], thin_first=True)
    return candidates, scores, keep[chosen]


def _not_a_person(small: np.ndarray, point, candidates) -> list:
    """Indices of the candidates a click at `point` may take.

    A click on a thing is not a click on the person beside it: on the red pipe
    a child stands against in 321A4983 the segmenter ranked "post, fence and
    the child" first (0.864) over the pipe alone (0.829). When the clicked
    pixel is not a person, a candidate that takes a real part of a person (TAKES_PERSON
    of one person blob) is dropped — unless every candidate does. Not a share
    of the candidate on people: the rein a woman holds in 321A5095 is 35% on
    her hand and is still the rein. The mirror of _whole_person's own gate.
    """
    import masks

    cat = masks._category_map(small)
    if cat[int(point[1]), int(point[0])] != masks.CLS_BACKGROUND:
        return list(range(len(candidates)))
    n, blobs, stats, _ = cv2.connectedComponentsWithStats((cat != masks.CLS_BACKGROUND).astype(np.uint8))
    floor = 0.001 * cat.size
    people = [blobs == i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= floor]

    def takes(c):
        return any(np.count_nonzero(c[p]) > TAKES_PERSON * np.count_nonzero(p) for p in people)

    keep = [i for i, c in enumerate(candidates) if not takes(c > 0)]
    return keep or list(range(len(candidates)))


#: Share of one person a click on a thing may not take with it. Measured on 8
#: clicks (2026-09-25): the right answers take <= 2% of a person, the wrong
#: ones 35-96% (the child beside the pipe in 4983: 49.9% — 0.5 missed it).
TAKES_PERSON = 0.25


def hover(rgb: np.ndarray, x: float, y: float, key=None) -> dict:
    """What a click here would select — shown before the click."""
    small = _small(rgb)
    with _predict_lock:
        candidates, _, index = _pick(small, [(x, y, True)], key)
    return {"maskPng": _mask_data(candidates[index])}


def _whole_person(small: np.ndarray, base: np.ndarray, x: float, y: float) -> np.ndarray:
    """A click on a person's clothes returns the clothes; the person is the
    clothes AND the head, hair and arms above them.

    Measured on untuned frames (2026-09-25): the girl in front of the horse in
    321A5117 came back as her dress only — head, hair and arm left in the
    photograph; the mother in 321A5015 without her head. What is left of a
    person wrecks the removal. So: find the face that sits over the clicked
    body (the face landmarker — already in the engine), ask the segmenter
    again with the click AND that face, and keep what it adds only where the
    person model sees a person (not the horse's cheek she leans on) and not
    where another face's person is (the child in the mother's arms).
    Returns `base` unchanged when no face belongs to it (a pipe, a post, a man
    seen from behind).
    """
    import masks

    sh, sw = small.shape[:2]
    ys, xs = np.nonzero(base)
    if not len(ys):
        return base
    # only a click on a PERSON grows to the person: a click on a fence post
    # beside a child took the child in with it (321A4983)
    cat = masks._category_map(small)
    if float((cat[base] != masks.CLS_BACKGROUND).mean()) < 0.6:
        return base
    bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
    # faces are looked for at twice the working size: at 1024 a toddler's
    # face in a family group is under the landmarker's 40px floor (321A5015)
    big = cv2.resize(small, (sw * 2, sh * 2), interpolation=cv2.INTER_CUBIC)
    faces = [((a + c) / 4, (b + d) / 4, (c - a) / 2) for a, b, c, d in masks.face_boxes(big)]
    best = None
    for cx, cy, fw in faces:
        # over the body: its centre within the body's columns, not deep below its top
        if bx0 - fw <= cx <= bx1 + fw and cy <= by0 + 2.5 * fw:
            if base[max(0, int(cy)):, max(0, int(cx - fw)):int(cx + fw)].any():
                d = abs(cy - by0) + 0.3 * abs(cx - (bx0 + bx1) / 2)
                if best is None or d < best[0]:
                    best = (d, cx, cy, fw)
    if best is None:
        return base
    _, cx, cy, fw = best
    others = [(qx, qy) for qx, qy, _ in faces if abs(qx - cx) > 1 or abs(qy - cy) > 1]
    px, py = int(x * (sw - 1)), int(y * (sh - 1))
    box = np.array([min(bx0, cx - fw), min(by0, cy - fw), max(bx1, cx + fw), by1])
    raw, _, _ = _predictor.predict(
        point_coords=np.array([[px, py], [cx, cy]] + [[qx, qy] for qx, qy in others]),
        point_labels=np.array([1, 1] + [0] * len(others)), box=box,
        multimask_output=True, return_logits=True)
    cands = raw > MASK_THRESHOLD
    area = max(1, int(base.sum()))
    pick = max(range(len(cands)), key=lambda i: (cands[i] & base).sum() / area
               + 0.5 * cands[i][int(cy), int(cx)] - 2 * max(0.0, cands[i].mean() - 3 * base.mean()))
    person = cv2.dilate((cat != masks.CLS_BACKGROUND).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    added = cands[pick] & ~base & person
    for qx, qy in others:
        raw, _, _ = _predictor.predict(point_coords=np.array([[qx, qy], [cx, cy]]),
                                       point_labels=np.array([1, 0]), multimask_output=True,
                                       return_logits=True)
        whole = [c for c in (raw > 0) if not c[int(cy), int(cx)] and c.mean() < 0.3]
        if whole:
            added &= ~max(whole, key=lambda c: int(c.sum()))
    return base | added


def _drop_specks(mask: np.ndarray) -> np.ndarray:
    """The segmenter's answer comes with stray dots: the rein in 321A5097 had
    two of 2px — one on the girl's fingertip, one on her leg — and the removal
    redrew her hand. A piece under SPECK px that is more than SPECK_GAP px
    from the object is such a dot. Measured on 12 clicks (2026-09-25): dots
    2-20px, 47-125px away; real pieces 104-523px, or within 15px (a guide's
    hand behind a rope, 25px at 8px)."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 2:
        return mask
    main = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    gap = cv2.distanceTransform((lab != main).astype(np.uint8), cv2.DIST_L2, 3)
    out = mask.copy()
    for i in range(1, n):
        if i != main and st[i, cv2.CC_STAT_AREA] < SPECK and gap[lab == i].min() > SPECK_GAP:
            out[lab == i] = 0
    return out


#: A stray piece of a selection, in px of the working frame (SELECT_MAX_DIM).
SPECK = 30
SPECK_GAP = 10


def select(rgb: np.ndarray, x: float, y: float, exclude=(), key=None, index=None) -> dict:
    """Choose a MobileSAM mask at a normalized click; the user must review it.

    `index` — which of the three sizes to take (a repeat click at the same
    spot steps through them: fence post, then the pipe on it). `exclude` —
    "not this" points; kept for callers, the screens no longer send them.
    """
    small = _small(rgb)
    clicks = [(x, y, True)] + [(float(ex), float(ey), False) for ex, ey in exclude]
    with _predict_lock:
        candidates, scores, index = _pick(small, clicks, key, index)
    mask = candidates[index].astype(np.uint8)
    if not mask.any():
        raise RuntimeError("No object mask found at the selected point")
    with _predict_lock:
        _hold(small, key)  # another request may have set its own meanwhile
        if len(clicks) == 1:
            mask = _whole_person(small, mask.astype(bool), x, y).astype(np.uint8)
        mask = _drop_specks(mask)
        grown = _grow_on_backdrop(small, _around(mask), mask) if mask.mean() <= CLICK_GROW_MAX else None
        if grown is not None:
            mask = grown
        candidates = candidates.copy()
        candidates[index] = mask
        behind = None if grown is not None else _find_behind(small, mask.astype(bool))
    sh, sw = small.shape[:2]
    alternatives = [
        {"maskPng": _mask_data(candidate), "coverage": round(float(candidate.mean()), 5),
         "score": round(float(score), 4)}
        for candidate, score in zip(candidates, scores)
    ]
    # The margin travels with the selection so the screen and the render agree
    # on it, and so it stays one decision, made here.
    out = {**alternatives[index], "width": sw, "height": sh, "margin": DEFAULT_MARGIN,
           "selectedIndex": index, "candidates": alternatives}
    if behind is not None:
        out["behind"] = {"maskPng": _mask_data(behind)}
    return out


#: A piece the click model adds to the rectangle's object may be at most this
#: share of that object: a phone or a held lead, never the neighbour.
HELD_MAX = 0.25


def _held_pieces(small: np.ndarray, box, mask: np.ndarray) -> np.ndarray:
    """The rectangle's object plus what it holds. Call under _predict_lock.

    SAM 2.1 with a rectangle outlines the person and leaves out a thing in
    the hand that lies over something else: the guide's phone over the
    horse's flank in 321A4954 stayed floating in the air after the removal
    (the photographer, 2026-10-13: "it used to work") — a click there took
    the phone with the man. So the click model is asked once, at the
    object's deepest point, and what it adds inside the rectangle, touching
    the object and small beside it, joins.
    """
    h, w = mask.shape
    d = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    py, px = np.unravel_index(int(np.argmax(d)), d.shape)
    raw, scores, _ = _predictor.predict(point_coords=np.array([[px, py]]), point_labels=np.array([1]),
                                        multimask_output=True, return_logits=True)
    cands = (raw > MASK_THRESHOLD).astype(np.uint8)
    click = cands[_choose_candidate(cands, scores)] > 0
    x0, y0, x1, y1 = box
    inbox = np.zeros((h, w), bool)
    inbox[int(y0 * h):int(np.ceil(y1 * h)), int(x0 * w):int(np.ceil(x1 * w))] = True
    extra = (click & inbox & ~(mask > 0)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(extra, connectivity=8)
    touch = cv2.dilate(mask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    out = mask.copy()
    limit = HELD_MAX * int(mask.sum())
    for i in range(1, n):
        piece = labels == i
        if stats[i, cv2.CC_STAT_AREA] <= limit and (piece & touch).any():
            out[piece] = 1
    return out


def select_box(rgb: np.ndarray, box, key=None) -> dict:
    """The object inside a rectangle the photographer drew (box_select).

    Same answer shape as `select`, with one size: the rectangle already says
    which object, so a repeat click has nothing to step through.
    """
    import box_select

    small = _small(rgb)
    mask = _drop_specks(box_select.mask_in_box(small, box))
    grown = _grow_on_backdrop(small, box, mask)
    with _predict_lock:
        _hold(small, key)
        if grown is None:
            mask = _held_pieces(small, box, mask)
        # On a studio backdrop nothing stands behind the clamp but the paper
        # and the wall, and the probes took those for an object: 4 of 22
        # clamps (254, 304, 322, 383) went to the layered fill, which rebuilt
        # the wall's edge as a rounded lump and smeared grey under it. The
        # plain fill continues a backdrop on its own.
        behind = None if grown is not None else _find_behind(small, mask.astype(bool))
    if grown is not None:
        mask = grown
    sh, sw = small.shape[:2]
    one = {"maskPng": _mask_data(mask), "coverage": round(float(mask.mean()), 5), "score": 1.0}
    out = {**one, "width": sw, "height": sh, "margin": DEFAULT_MARGIN,
           "selectedIndex": 0, "candidates": [one]}
    if behind is not None:
        out["behind"] = {"maskPng": _mask_data(behind)}
    return out


#: Texture of the backdrop around a rectangle (75th percentile of the L*
#: gradient on the 1024 frame) below which it counts as a studio backdrop.
#: Measured 2026-10-13: 22 clamps and stands on the newborn shoot's paper and
#: fabric 0.8-4.3, the felt heart on the blanket 5.1; every scene with
#: anything behind (table, foliage, gravel, a car) 11-34.
SMOOTH_BACKDROP = 8.0
#: CIELAB distance from every backdrop colour: what is surely object, and what
#: is still not backdrop (its blur, its shadow, its colour cast).
BACKDROP_OBJ, BACKDROP_HALO = 12.0, 2.5
#: How far past the rectangle the halo may reach (fraction of the rectangle)
#: and how far from the object (fraction of the frame).
BACKDROP_BAND, BACKDROP_REACH = 0.35, 0.025


#: A clicked outline larger than this share of the frame is the backdrop or a
#: person, not a piece of studio gear: it is not grown.
CLICK_GROW_MAX = 0.05
#: The rectangle a click stands for: the outline's bounds and this much of
#: its size on every side — the clamp's orange tip, outside the outline, falls
#: inside it.
CLICK_BOX_PAD = 0.3


def _around(mask: np.ndarray):
    """(x0, y0, x1, y1) fractions: the outline's bounds, padded (CLICK_BOX_PAD)."""
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    py = CLICK_BOX_PAD * (np.ptp(ys) + 1)
    px = CLICK_BOX_PAD * (np.ptp(xs) + 1)
    return (max(0.0, (xs.min() - px) / w), max(0.0, (ys.min() - py) / h),
            min(1.0, (xs.max() + 1 + px) / w), min(1.0, (ys.max() + 1 + py) / h))


def _lab100(rgb: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab[..., 0] *= 100 / 255.0
    lab[..., 1:] -= 128
    return lab


def _grow_on_backdrop(small: np.ndarray, box, core: np.ndarray):
    """On a smooth backdrop: everything in the rectangle that is not backdrop,
    and the soft edge around it. None when the surroundings are not one
    smooth backdrop (the segmenter's outline stays as it is).

    The segmenter outlines an object's sharp core. A studio clamp is out of
    focus: its blur, its shadow on the paper and the orange glow of its tip
    reach well past that outline, and the fill CONTINUED them — a dark ghost
    in the clamp's shape and an orange smear (chayamushka-383, 2026-10-13;
    22 of 22 clamps on that shoot came back with a ghost or a piece left).
    The backdrop's colours are read from a ring around the rectangle; inside
    it, what they do not explain is the object; around it, a pixel still not
    quite backdrop is the object's blur, taken while it touches the object.
    Busy surroundings (a table of lemons, a teddy beside the jar) are not
    one backdrop — there the colours explain nothing, the rectangle would take
    its neighbours, and the segmenter's outline stays as it was.
    """
    h, w = core.shape
    x0, y0, x1, y1 = box
    X0, Y0 = int(x0 * w), int(y0 * h)
    X1, Y1 = int(np.ceil(x1 * w)), int(np.ceil(y1 * h))
    bw, bh = X1 - X0, Y1 - Y0
    pad = max(6, int(BACKDROP_BAND * max(bw, bh)))
    far = pad + max(6, pad // 2)
    near = np.zeros((h, w), bool)
    near[max(0, Y0 - pad):Y1 + pad, max(0, X0 - pad):X1 + pad] = True
    ring = np.zeros((h, w), bool)
    ring[max(0, Y0 - far):Y1 + far, max(0, X0 - far):X1 + far] = True
    core = core > 0
    ring &= ~near & ~(cv2.dilate(core.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
    if ring.sum() < 40:
        return None
    lab = _lab100(small)
    grad = np.hypot(cv2.Sobel(lab[..., 0], cv2.CV_32F, 1, 0), cv2.Sobel(lab[..., 0], cv2.CV_32F, 0, 1))
    if np.percentile(grad[ring], 75) > SMOOTH_BACKDROP:
        return None
    lab = cv2.GaussianBlur(lab, (0, 0), 1.0)
    bg = _clusters(lab[ring], 6)
    d = np.zeros((h, w), np.float32)
    d[near] = _nearest(lab[near], bg)
    inbox = np.zeros((h, w), bool)
    inbox[Y0:Y1, X0:X1] = True
    # inside the rectangle: what touches the object, or is a piece of its own
    n, labels, stats, _ = cv2.connectedComponentsWithStats(
        (((d > BACKDROP_OBJ) & inbox) | core).astype(np.uint8), connectivity=8)
    keep = np.zeros(n, bool)
    keep[np.unique(labels[core])] = True
    keep |= stats[:, cv2.CC_STAT_AREA] > 0.02 * bw * bh
    keep[0] = False
    fg = keep[labels] | core
    # around it: the blur, while it touches the object and stays near it
    reach = max(3, round(BACKDROP_REACH * max(h, w)))
    within = cv2.distanceTransform((~fg).astype(np.uint8), cv2.DIST_L2, 5) <= reach
    may = (d > BACKDROP_HALO) & near & within
    k = np.ones((3, 3), np.uint8)
    for _ in range(pad):
        grown = (cv2.dilate(fg.astype(np.uint8), k) > 0) & (may | fg)
        if np.array_equal(grown, fg):
            break
        fg = grown
    fg = cv2.dilate(fg.astype(np.uint8), k)                      # the anti-aliased rim
    return cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))


def select_painted(rgb: np.ndarray, strokes, key=None) -> dict:
    """Exactly what the photographer painted over — the removal brush.

    Professional removal brushes remove what is painted; they do not guess an
    object from the stroke. Snapping a stroke to "the object under it" was
    tried three ways on 321A5078 and failed each time (a stroke along the
    black pipe became the whole fence post twice; a stroke on the horse
    became a sliver of it), so the paint is the selection. What stands behind
    it is still looked for, so painting over the man keeps the horse whole.
    """
    small = _small(rgb)
    sh, sw = small.shape[:2]
    painted = manual_clean.strokes_mask(small.shape, strokes or []) > 0
    if not painted.any():
        raise ValueError("Nothing was painted")
    with _predict_lock:
        _hold(small, key)
        behind = _find_behind(small, painted)
    # The strokes travel with the selection and are drawn again at every
    # render size: the PNG is 1024 wide, and stretched to 5472 its edge was a
    # 5px staircase that left the rim of a pipe outside the removal.
    paint = [{"id": str(s.get("id", i)), "points": [[float(x), float(y)] for x, y in s.get("points") or []],
              "r": float(s.get("r", 0.0))} for i, s in enumerate(strokes or [])]
    out = {"maskPng": _mask_data(painted), "coverage": round(float(painted.mean()), 5),
           "width": sw, "height": sh, "margin": 0.0, "paint": paint}
    if behind is not None:
        out["behind"] = {"maskPng": _mask_data(behind)}
    return out


#: How far past a brush stroke the object under it may still be taken, as a
#: fraction of the frame width (66px at 5472): enough for the edges of a
#: strap painted a little too narrow, never the whole post behind a pipe.
SNAP_BAND = 0.012


def _snap_under(small: np.ndarray, painted: np.ndarray):
    """What of the object under a stroke lies just outside it, or None.

    A stroke narrower than the object leaves its edges, and the fill rebuilds
    the object from them — the reins in 321A5095 came back from a stroke 24px
    wide on straps 28px wide. The earlier "snap to the object" attempts took
    the segmenter's LARGEST answer (the whole post for a pipe). Here the
    segmenter is asked along the stroke and the answer that best MATCHES the
    stroke wins (overlap over union, inside a band around it); only its part
    inside that band is added. A pipe painted generously gains nothing; a
    strap painted narrowly gains its edges. Runs under _predict_lock with the
    picture set.
    """
    sh, sw = painted.shape
    band_r = max(2, round(SNAP_BAND * sw))
    band = cv2.dilate(painted.astype(np.uint8), cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * band_r + 1,) * 2)) > 0
    skel = cv2.ximgproc.thinning(painted.astype(np.uint8) * 255) > 0
    ys, xs = np.nonzero(skel)
    if not len(ys):
        ys, xs = np.nonzero(painted)
    order = np.lexsort((xs, ys))
    pick = order[np.linspace(0, len(order) - 1, min(12, len(order))).astype(int)]
    pts = np.stack([xs[pick], ys[pick]], 1)
    raw, _, _ = _predictor.predict(point_coords=pts, point_labels=np.ones(len(pts), int),
                                   multimask_output=True, return_logits=True)
    P = painted
    best, best_iou = None, 0.4
    for c in raw > MASK_THRESHOLD:
        if (c & P).sum() < 0.5 * P.sum():
            continue                      # not the thing the stroke is on
        cb = c & band
        iou = (cb & P).sum() / max(1, (cb | P).sum())
        if iou > best_iou:
            best, best_iou = cb, iou
    if best is None:
        return None
    # only what continues the stroke: a piece of the answer that does not
    # touch the paint (a knot in the post beside the pipe) is not the object
    n, lab = cv2.connectedComponents((best | P).astype(np.uint8), connectivity=8)
    touching = np.unique(lab[P])
    extra = best & ~P & np.isin(lab, touching[touching > 0])
    return extra if extra.any() else None


#: How many leftover suggestions one selection may come back with.
LEFTOVERS_MAX = 8


def _line_like(c: np.ndarray, side: int) -> bool:
    """A lead, a rein, a tail, a shadow line: narrow everywhere, and its area
    is its length times that width - no body hanging off it (a horse's
    skeleton is long too; _thin let whole horses through)."""
    m8 = c.astype(np.uint8)
    sk = cv2.ximgproc.thinning(m8 * 255) > 0
    if sk.sum() < 0.03 * side:
        return False
    half = cv2.distanceTransform(m8, cv2.DIST_L2, 3)
    hw = float(np.percentile(half[sk], 90))
    return hw <= 0.006 * side and m8.sum() <= 2.6 * sk.sum() * max(1.0, hw)


def leftovers(rgb: np.ndarray, selection: dict, key=None) -> dict:
    """What may stay behind when the selection goes: the lead in the guide's
    hand, the tip of a tail whose root is behind him, the shadow at his feet.

    SUGGESTIONS for the photographer to accept with a click, never removed on
    their own. Finding them automatically was tried four ways on 2026-10-13
    and none told a cut tail from a fence rail passing behind the same man
    (docs/OBJECT-REMOVE-TIMELINE.md); the photographer sees which is which in
    a glance. Probes just outside the selection, as _find_behind does; keeps
    an answer that is one thin piece, touches the selection, stays clear of
    the frame's edge and is not mostly the selection itself.
    """
    small = _small(rgb)
    h, w = small.shape[:2]
    mask = _read_mask(selection["maskPng"], (h, w)) > 0
    if not mask.any():
        return {"width": w, "height": h, "suggestions": []}
    r = max(2, round(0.006 * max(h, w)))
    grown = cv2.dilate(mask.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1,) * 2))
    contours, _ = cv2.findContours(grown, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    ring = max(contours, key=cv2.contourArea)[:, 0, :]
    d = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    ny, nx = np.unravel_index(int(np.argmax(d)), d.shape)
    touch = cv2.dilate(mask.astype(np.uint8), np.ones((2 * r + 3,) * 2, np.uint8)) > 0
    found = []
    with _predict_lock:
        _hold(small, key)
        for px, py in ring[np.linspace(0, len(ring) - 1, 48).astype(int)]:
            raw, _, _ = _predictor.predict(point_coords=np.array([[px, py], [nx, ny]]),
                                           point_labels=np.array([1, 0]), multimask_output=True,
                                           return_logits=True)
            for c in raw > 0:
                c = c & ~mask
                if c.sum() < 30 or c.mean() > 0.05 or not (c & touch).any():
                    continue
                n, _, st, _ = cv2.connectedComponentsWithStats(c.astype(np.uint8), connectivity=8)
                if n < 2 or st[1:, cv2.CC_STAT_AREA].max() < 0.9 * c.sum():
                    continue
                if c[:2].any() or c[-2:].any() or c[:, :2].any() or c[:, -2:].any():
                    continue
                if not _line_like(c, max(h, w)):
                    continue
                if any((c & f).sum() > 0.5 * min(c.sum(), f.sum()) for f in found):
                    continue
                found.append(c)
    found.sort(key=lambda f: -int(f.sum()))
    return {"width": w, "height": h,
            "suggestions": [{"maskPng": _mask_data(f), "coverage": round(float(f.mean()), 5)}
                            for f in found[:LEFTOVERS_MAX]]}


#: How far outside the removed object the ring of probe clicks sits.
PROBE_RING = 0.02
#: How many probes around it, and how many must name the same object.
PROBES, AGREE = 28, 4


def _find_behind(small: np.ndarray, removed: np.ndarray):
    """The object the removed one stands in front of, found without a click.

    A second click asked the photographer something the picture already says:
    the man stands in front of the horse. Probe a ring just outside the
    removed outline — each probe a click for the segmenter, the removed
    object a "not this" — and keep the object several probes agree on, if it
    is a thing (a bounded shape that stands out from what surrounds it) and
    not the backdrop (bushes, ground, sky: large, or no edge of their own).
    None when nothing qualifies; the fill then treats everything as background.
    Runs under _predict_lock with the image already set.
    """
    h, w = removed.shape
    ring_r = max(3, round(PROBE_RING * max(h, w)))
    grown = cv2.dilate(removed.astype(np.uint8),
                       cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * ring_r + 1,) * 2))
    contours, _ = cv2.findContours(grown, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    ring = max(contours, key=cv2.contourArea)[:, 0, :]
    inside = cv2.distanceTransform(removed.astype(np.uint8), cv2.DIST_L2, 5)
    ny, nx = np.unravel_index(int(np.argmax(inside)), inside.shape)
    lab = cv2.cvtColor(small, cv2.COLOR_RGB2LAB).astype(np.float32)
    removed_bottom = int(np.nonzero(removed.any(1))[0].max())
    band_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * ring_r + 1,) * 2)
    found = []
    for px, py in ring[np.linspace(0, len(ring) - 1, PROBES).astype(int)]:
        if not (0 <= px < w and 0 <= py < h):
            continue
        raw, scores, _ = _predictor.predict(
            point_coords=np.array([[px, py], [nx, ny]]), point_labels=np.array([1, 0]),
            multimask_output=True, return_logits=True)
        c = raw[int(np.argmax(scores))] > 0
        area = c.mean()
        if not 0.01 <= area <= 0.35 or (c & removed).sum() > 0.2 * c.sum():
            continue
        # backdrop runs off the frame: ground in 321A5078 spans edge to edge
        edges = [c[:, :3].any(), c[:, -3:].any(), c[:3, :].any(), c[-3:, :].any()]
        if (edges[0] and edges[1]) or (edges[2] and edges[3]) or sum(edges) >= 3:
            continue
        # it must stand farther back: its footing higher in the frame than the
        # removed one's. In 321A5015 the father stands behind the mother, whose
        # hem runs off the frame — no footing to compare, so she is left alone.
        if edges[3] or np.nonzero(c.any(1))[0].max() >= removed_bottom:
            continue
        # a thing has its own edge: inside and just outside differ clearly
        c8 = c.astype(np.uint8)
        rim_in = c & ~(cv2.erode(c8, band_k) > 0)
        rim_out = (cv2.dilate(c8, band_k) > 0) & ~c & ~removed
        if rim_in.sum() < 50 or rim_out.sum() < 50:
            continue
        if np.linalg.norm(lab[rim_in].mean(0) - lab[rim_out].mean(0)) < 25:
            continue
        for group in found:
            inter = (group[0] & c).sum()
            if inter / max(1, (group[0] | c).sum()) > 0.6:
                group[1] += 1
                break
        else:
            found.append([c, 1])
    if not found:
        return None
    best, votes = max(found, key=lambda g: g[1])
    if votes < AGREE:
        return None
    # Cut the object once more, the way select() cuts what is clicked: at its
    # deepest point, read at MASK_THRESHOLD. The probes' tight cut (logit 0)
    # stopped short along the horse's thigh in 321A5078 and the completed rump
    # ballooned to the ground; this cut matches the approved rump (IoU 0.95).
    d = cv2.distanceTransform(best.astype(np.uint8), cv2.DIST_L2, 5)
    py, px = np.unravel_index(int(np.argmax(d)), d.shape)
    raw, scores, _ = _predictor.predict(
        point_coords=np.array([[px, py], [nx, ny]]), point_labels=np.array([1, 0]),
        multimask_output=True, return_logits=True)
    cands = (raw > MASK_THRESHOLD).astype(np.uint8)
    cut = cands[_choose_candidate(cands, scores)].astype(bool) & ~removed
    return cut if cut.any() else best


#: The band outside a brush stroke in which a remnant of the object is caught,
#: as a fraction of the frame width (19px at 5472).
REMNANT_BAND = 0.0035
#: How far (CIELAB, L* on 0-100) a stroke pixel must be from every background
#: colour to count as the object.
REMNANT_TOL = 14.0


def _clusters(x: np.ndarray, k: int) -> np.ndarray:
    """k colour centres, deterministically (the same answer at every render)."""
    if len(x) > 20000:
        x = x[:: len(x) // 20000]
    k = max(1, min(k, len(x)))
    c = [x.mean(0)]
    for _ in range(k - 1):   # farthest point from the centres so far
        d = np.min([((x - ci) ** 2).sum(1) for ci in c], axis=0)
        c.append(x[int(np.argmax(d))])
    c = np.array(c, np.float32)
    for _ in range(8):
        lab = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(-1), 1)
        for j in range(k):
            if (lab == j).any():
                c[j] = x[lab == j].mean(0)
    return c


def _nearest(x: np.ndarray, c: np.ndarray) -> np.ndarray:
    return np.sqrt(((x[:, None, :] - c[None]) ** 2).sum(-1)).min(1)


def catch_remnants(rgb: np.ndarray, painted: np.ndarray) -> np.ndarray:
    """The brush stroke plus what it left of the object at the object's edge.

    A stroke rarely covers an object exactly: its anti-aliased rim and a pixel
    or three of its edge stay outside, and the fill then CONTINUES them — the
    pipe on the post in 321A5078 came back as a dark smudge at its foot, where
    the fitting stuck out past the stroke. The background's colours are learned
    from a ring well outside the stroke; the object's are the stroke pixels the
    background does not explain; a pixel in a thin band just outside joins the
    removal only if it looks like the object and not like the background, and
    touches the stroke. The band is bounded, so a stroke on a pipe cannot run
    away to the whole post (the three "snap to the object" attempts did).
    """
    h, w = painted.shape
    band = max(3, int(round(REMNANT_BAND * w)))
    ys, xs = np.nonzero(painted)
    if not len(ys):
        return painted
    pad = 4 * band
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
    P = (painted[y0:y1, x0:x1] > 0).astype(np.uint8)
    lab = cv2.cvtColor(rgb[y0:y1, x0:x1], cv2.COLOR_RGB2LAB).astype(np.float32)
    lab[..., 0] *= 100 / 255.0
    lab[..., 1:] -= 128
    disc = lambda r: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    near = cv2.dilate(P, disc(band)) > 0
    ring = near & (P == 0)
    outer = (cv2.dilate(P, disc(3 * band)) > 0) & ~near
    if outer.sum() < 50:
        return painted
    bg = _clusters(lab[outer], 6)
    inside = lab[P > 0]
    obj = inside[_nearest(inside, bg) > REMNANT_TOL]
    if len(obj) < 30:
        return painted            # the stroke holds nothing unlike its surroundings
    oc = _clusters(obj, 4)
    rv = lab[ring]
    d_obj, d_bg = _nearest(rv, oc), _nearest(rv, bg)
    take = np.zeros_like(P)
    take[ring] = (d_obj < d_bg) & (d_bg > 0.5 * REMNANT_TOL)
    grown = P.copy()
    for _ in range(band):          # only what touches the stroke
        nxt = ((cv2.dilate(grown, disc(1)) > 0) & ((take > 0) | (grown > 0))).astype(np.uint8)
        if np.array_equal(nxt, grown):
            break
        grown = nxt
    # one pixel more: the anti-aliased rim of what was caught
    grown = np.maximum(grown, (cv2.dilate(grown, disc(1)) * near).astype(np.uint8))
    out = painted.copy()
    out[y0:y1, x0:x1] = np.maximum(out[y0:y1, x0:x1], grown)
    return out


def repair_mask(shape: tuple, selection: dict, rgb: np.ndarray = None) -> np.ndarray:
    """Expand the chosen object, then apply hand corrections at render size.

    A brush selection (`paint`) is drawn again here at render size, and given
    `rgb`, the remnants it left at the object's edge are caught.
    """
    h, w = shape[:2]
    paint = selection.get("paint")
    if isinstance(paint, list) and paint:
        # The brush removes exactly what was painted — the photographer's rule
        # (2026-09-24): painting means "this area", clicking means "this
        # object". Growing a stroke (remnant catcher, snap) was tried and
        # reverted; the code stays for the click path if it proves useful.
        mask = manual_clean.strokes_mask(shape, paint)
    else:
        mask = _read_mask(selection.get("maskPng"), shape)
    # Hand-added pixels are part of the object too. Growing only the model's
    # mask left a halo around the very corrections the photographer made.
    add = manual_clean.strokes_mask(shape, selection.get("add") or [])
    mask = np.maximum(mask, add)
    margin = float(selection.get("margin", DEFAULT_MARGIN))
    if not (0 <= margin <= 0.03):
        raise ValueError("Object mask margin must be between 0 and 0.03")
    radius = round(margin * w)
    if radius:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                            (2 * radius + 1, 2 * radius + 1))
        mask = cv2.dilate(mask, kernel)
    subtract = manual_clean.strokes_mask(shape, selection.get("subtract") or [])
    mask[subtract > 0] = 0
    return mask


#: The layered fill's working size for the background. Measured on 321A5078:
#: with the horse taken out of the context, 900 returned a grey-green fog where
#: the man stood; 512 returned bamboo, fence and soil. 320 broke into blocks.
LAYERED_WORK_HOLE = 512
#: The width at which a hidden outline is completed, whatever the render size.
OUTLINE_WIDTH = 5472  # the frame the completion was judged on (321A5078)


def _complete_outline(behind: np.ndarray, hole: np.ndarray) -> np.ndarray:
    """Where the object behind continues under the removed one.

    The object's outline disappears into the hole at one point and comes out
    at another. Among the curves that join the two, keep their directions and
    stay hidden inside the hole (anything outside would have been visible in
    the photograph), take the one that bends least — the classical rule for
    completing an occluded contour. On 321A5078 a fuller, hand-picked rump
    left the hole on an eighth of its length and was judged wrong on sight.

    -> bool mask of the hidden part of `behind`. Empty when there is no clean
    single entry/exit (the object is only touched, not crossed).
    """
    h, w = hole.shape
    empty = np.zeros_like(hole, dtype=bool)
    vis = cv2.morphologyEx((behind & ~hole).astype(np.uint8), cv2.MORPH_OPEN,
                           np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(vis, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return empty
    c = max(contours, key=cv2.contourArea)[:, 0, :]
    dist = cv2.distanceTransform((~hole).astype(np.uint8), cv2.DIST_L2, 5)
    adj = dist[c[:, 1], c[:, 0]] <= max(3, 0.00073 * w)  # 4px at 5472
    n = len(c)
    if adj.all() or not adj.any():
        return empty
    start = int(np.argmax(~adj))
    cc, aa = np.roll(c, -start, 0), np.roll(adj, -start)
    runs, i = [], 0
    while i < n:
        if aa[i]:
            j = i
            while j < n and aa[j]:
                j += 1
            runs.append((i, j - 1))
            i = j
        else:
            i += 1
    i0, i1 = max(runs, key=lambda r: r[1] - r[0])
    k = max(6, round(0.015 * w))
    if (i1 - i0) + 2 * k + 2 >= n:
        return empty
    # the outline is closed: the tangents are read around it, not off an end
    A, B = cc[(i0 - 1) % n].astype(float), cc[(i1 + 1) % n].astype(float)
    ta, tb = A - cc[(i0 - 1 - k) % n], B - cc[(i1 + 1 + k) % n]
    if not np.linalg.norm(ta) or not np.linalg.norm(tb):
        return empty
    ta, tb = ta / np.linalg.norm(ta), tb / np.linalg.norm(tb)
    span = np.linalg.norm(A - B)
    t = np.linspace(0, 1, 400)[:, None]
    h00, h10 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t
    h01, h11 = -2 * t**3 + 3 * t**2, t**3 - t**2

    def bend(curve):
        d1 = np.gradient(curve, axis=0)
        d2 = np.gradient(d1, axis=0)
        speed = np.maximum(np.linalg.norm(d1, axis=1), 1e-9)
        kappa = (d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]) / speed**3
        return float(np.sum(kappa**2 * speed))

    best = None
    for a in np.linspace(0.1, 2.5, 25):
        for b in np.linspace(0.1, 2.5, 25):
            curve = h00 * A + h10 * (ta * a * span) + h01 * B + h11 * (-tb * b * span)
            pts = np.clip(np.rint(curve[12:-12]).astype(int), 0, [w - 1, h - 1])
            if hole[pts[:, 1], pts[:, 0]].mean() < 0.99:
                continue
            e = bend(curve)
            if best is None or e < best[0]:
                best = (e, curve)
    if best is None:
        return empty
    poly = np.vstack([best[1], cc[i0:i1 + 1][::-1]]).astype(np.int32)  # i0..i1 never wraps: cc starts outside a run
    out = np.zeros((h, w), np.uint8)
    cv2.fillPoly(out, [poly], 1)
    return (out > 0) & hole


def _push_pull(img: np.ndarray, known: np.ndarray) -> np.ndarray:
    """A smooth membrane through the known pixels (normalized-convolution pyramid)."""
    if min(img.shape[:2]) < 4:
        weight = max(float(known.sum()), 1e-6)
        mean = (img * known[..., None]).sum((0, 1)) / weight
        return np.broadcast_to(mean, img.shape).astype(np.float32).copy()
    k = known.astype(np.float32)
    num, den = cv2.pyrDown(img * k[..., None]), cv2.pyrDown(k)
    coarse_known = den > 1e-3
    coarse = np.where(coarse_known[..., None], num / np.maximum(den, 1e-6)[..., None], 0)
    up = cv2.pyrUp(_push_pull(coarse.astype(np.float32), coarse_known),
                   dstsize=(img.shape[1], img.shape[0]))
    return np.where(known[..., None], img, up)


def _layered(rgb: np.ndarray, hole: np.ndarray, behind: np.ndarray, front: np.ndarray):
    """Remove `hole`, filling each side from its own material.

    One fill across the whole hole mixes the object behind with the
    background: on 321A5078 that gave a fog, a ghost leg and a grey stain on
    the horse. Split it instead: complete the object's outline under the
    hole, fill the background part from background only, the object part from
    the object only (its light carried in smoothly, its own grain borrowed),
    and meet at an edge as soft as the object's photographed edge.

    `front` is what stands in front of the object — the clicked selection.
    Brush additions are erased too but are not assumed to be in front: on
    321A5078 the tail, added by hand, hangs behind the horse's leg, and
    counting it as an occluder ran the horse's outline down to the hoof.
    """
    h, w = hole.shape
    # The outline is completed at one fixed size and scaled, so the preview
    # and the export draw the same horse. At a 1600px preview the tangents are
    # a handful of pixels and the completion found nothing at all.
    cw, ch = OUTLINE_WIDTH, round(OUTLINE_WIDTH * h / w)
    size = lambda m, sz: cv2.resize(m.astype(np.uint8), sz, interpolation=cv2.INTER_NEAREST) > 0
    hidden = size(_complete_outline(size(behind, (cw, ch)), size(front & hole, (cw, ch))), (w, h)) & hole
    obj = (behind & ~hole) | hidden
    ys, xs = np.nonzero(hole)
    pad = int(0.35 * max(xs.max() - xs.min(), ys.max() - ys.min()))
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
    win = rgb[y0:y1, x0:x1]
    sl = (slice(y0, y1), slice(x0, x1))

    near_obj = cv2.dilate(obj.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    # only the object's rim near the hole joins the fill; the rest of the
    # outline is never written, and filling it cost time for nothing
    by_hole = cv2.dilate(hole.astype(np.uint8), np.ones((51, 51), np.uint8)) > 0
    bg_unknown = (hole | (near_obj & by_hole))[sl].astype(np.uint8)
    # Tried 2026-09-24: this background through object_fill (the plain
    # removal's fill). On the guide in 321A5078 it was 10x slower (37s against
    # 3.6s at 2400px) and left a pale haze column; the network at 512 is what
    # the photographer had approved here. Kept.
    background = lama_fill._fill_window(lama_fill._model(), win, bg_unknown, LAYERED_WORK_HOLE)

    comp = background.astype(np.float32)
    if hidden.any():
        core = (behind & ~hole) & ~(cv2.dilate(hole.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
        unknown = (~core[sl]).astype(np.uint8)
        hy, hx = np.nonzero(hidden[sl])
        f = min(1.0, 256.0 / max(1, hx.max() - hx.min(), hy.max() - hy.min()))
        small = cv2.resize(win, None, fx=f, fy=f, interpolation=cv2.INTER_AREA).astype(np.float32)
        us = cv2.resize(unknown, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
        us = cv2.dilate(us.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        low = cv2.GaussianBlur(small, (0, 0), 3)
        smooth = _push_pull(low, ~us)
        for _ in range(3):
            smooth = np.where(us[..., None], cv2.GaussianBlur(smooth, (0, 0), 6), low)
        smooth = cv2.resize(np.clip(smooth, 0, 255).astype(np.uint8), (win.shape[1], win.shape[0]),
                            interpolation=cv2.INTER_CUBIC)
        base = np.where(unknown[..., None] > 0, smooth, win)
        # grain borrowed only into the hidden part, from the object around it
        bh, bw = hy.max() - hy.min() + 1, hx.max() - hx.min() + 1
        sy0, sy1 = max(0, hy.min() - 2 * bh), min(win.shape[0], hy.max() + 2 * bh)
        sx0, sx1 = max(0, hx.min() - 2 * bw), min(win.shape[1], hx.max() + 2 * bw)
        textured = base.copy()
        textured[sy0:sy1, sx0:sx1] = lama_fill._regrain(
            win[sy0:sy1, sx0:sx1], base[sy0:sy1, sx0:sx1],
            hidden[sl][sy0:sy1, sx0:sx1].astype(np.uint8), 1.0 / f)
        edge = max(0.6, 0.00027 * w)   # the photographed horse's own edge, 1.5px at 5472
        alpha = cv2.GaussianBlur(obj[sl].astype(np.float32), (0, 0), edge)[..., None]
        comp = comp * (1 - alpha) + textured.astype(np.float32) * alpha

    m = hole[sl].astype(np.float32)
    blend = np.maximum(m, cv2.GaussianBlur(m, (0, 0), max(1.0, 0.00055 * w)))[..., None]
    out = rgb.copy()
    out[sl] = np.clip(np.rint(win.astype(np.float32) * (1 - blend) + comp * blend), 0, 255).astype(np.uint8)
    return out, int(hidden.sum())


#: Share of the hole's rim the object behind may occupy before the hole counts
#: as lying inside that object rather than on its edge.
#:
#: 0.6 let in things that only stand BESIDE an object (2026-10-05, the 12
#: real removals at 1400): the stone at the foot of the post in 321A4954
#: (0.54) and the pipe at the post's edge in 321A4983 (0.56) were filled in
#: layers — the stone left a grey slab on the fence — while the plain fill
#: closed both cleanly. The guide in front of the horse in 321A5078: 0.24.
INSIDE_SHARE = 0.4
#: Share of the hole the object's completed outline must take before the hole
#: is filled in layers: below it, the object only touches the hole and the
#: plain fill continues its edge better. Measured on the same 12: the guide in
#: front of the horse 15% (layers: a whole rump; plain: the rump cut off flat),
#: the rein ending at the horse's mouth 3.8%, the guide beside the horse in
#: 321A4954 0% — layered there left a light rectangle on the rump, plain fill
#: gave rump, legs and tail.
HIDDEN_SHARE = 0.08


def _straddles(hole: np.ndarray, behind: np.ndarray) -> bool:
    """Does the hole sit on the object's edge (object on one side, backdrop on
    the other) — the only case the layered fill is for?

    Layered filling separates two materials. A hole the object surrounds has
    one material around it, and the plain fill continues it from every side:
    the black pipe on the fence post in 321A5078, filled in layers, left a dark
    slot through the post; filled plainly, the wood closes over it.
    And enough of the object must go on under the hole (HIDDEN_SHARE) for
    the layers to have anything to rebuild.
    """
    w = hole.shape[1]
    r = max(3, round(0.004 * w))
    rim = (cv2.dilate(hole.astype(np.uint8), cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0) & ~hole
    if not rim.any():
        return False
    if float((behind & rim).sum()) / float(rim.sum()) >= INSIDE_SHARE:
        return False
    return int(_complete_outline(behind, hole).sum()) >= HIDDEN_SHARE * int(hole.sum())


#: How close (fraction of width) a removal must come to a drawn one to be drawn too.
GEN_NEAR = 0.01


def _step_masks(rgb: np.ndarray, selection: dict):
    """(hole, behind-or-None) of one removal, the way _remove_one reads them."""
    base = {k: v for k, v in selection.items() if k not in ("paint", "snap")}
    behind = selection.get("behind")
    b = _read_mask(behind["maskPng"], rgb.shape) > 0 if isinstance(behind, dict) and behind.get("maskPng") else None
    layered = b is not None and _straddles(repair_mask(rgb.shape, base) > 0, b)
    hole = repair_mask(rgb.shape, base if layered else selection, None if layered else rgb) > 0
    return hole, (b if layered else None)


def _drawn_group(rgb: np.ndarray, steps) -> list:
    """Indexes of the removals the model should draw: every removal that cuts
    an object standing behind it, and every removal that touches one of those
    (a leftover of the same scene — the tail under the horse)."""
    masks = [_step_masks(rgb, s) for s in steps]
    group = [i for i, (_, b) in enumerate(masks) if b is not None]
    if not group:
        return []
    r = max(2, round(GEN_NEAR * rgb.shape[1]))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1,) * 2)
    grown = True
    while grown:
        grown = False
        area = np.zeros(rgb.shape[:2], bool)
        for i in group:
            area |= masks[i][0]
        near = cv2.dilate(area.astype(np.uint8), k) > 0
        for i, (m, _) in enumerate(masks):
            if i not in group and m.any() and near[m].any():
                group.append(i)
                grown = True
    return sorted(group)


def _remove_one(rgb: np.ndarray, selection: dict, drawn: np.ndarray = None, allow_gen: bool = True):
    # The object behind was cut against the 1024-wide selection. When it is in
    # play, the hole must come from that same raster: redrawn at render size,
    # or grown by the remnant catcher, the hole's edge drifts off the object's
    # cut edge, the outline completion loses where the object goes under — and
    # the catcher took white horse pixels for pipe-like "remnants". Measured on
    # the photographer's own brush over the guide in 321A5078 (2400px): hidden
    # part rebuilt 20,729px from the 1024 selection, 590 redrawn, 0 with the
    # catcher — a ghost where the rump was. So: an object behind -> the
    # selection exactly as picked; nothing behind -> redrawn and caught.
    base = {k: v for k, v in selection.items() if k not in ("paint", "snap")}
    behind = selection.get("behind")
    layered = isinstance(behind, dict) and behind.get("maskPng") and _straddles(
        repair_mask(rgb.shape, base) > 0, _read_mask(behind["maskPng"], rgb.shape) > 0)
    mask = repair_mask(rgb.shape, base if layered else selection, None if layered else rgb)
    count = int(mask.sum())
    if not count:
        return rgb, {"removedPx": 0, "filler": "none"}
    near_drawn = False
    if drawn is not None and drawn.any() and gen_fill.available():
        # a leftover beside an area the model drew (the tail under the horse,
        # after the guide) is drawn by the same model: the classical fill
        # beside a drawn area left a hazy smudge at the hoof in 321A5078
        r = max(2, round(GEN_NEAR * rgb.shape[1]))
        near = cv2.dilate(drawn.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1,) * 2))
        near_drawn = bool((near > 0)[mask > 0].any())
    if allow_gen and (layered or near_drawn) and gen_fill.available():
        # an object stands behind the removed one: part of it has to be DRAWN
        # (gen_fill.py). Falls back to the layered fill below, saying so.
        try:
            out = gen_fill.fill(rgb, mask > 0,
                                _read_mask(behind["maskPng"], rgb.shape) > 0 if layered else None)
            return out, {"removedPx": count, "filler": "generative"}
        except gen_fill.GenFillError as exc:
            gen_error = str(exc)
    else:
        gen_error = None
    if layered:
        front = _read_mask(selection["maskPng"], rgb.shape)
        radius = round(float(selection.get("margin", DEFAULT_MARGIN)) * rgb.shape[1])
        if radius:
            front = cv2.dilate(front, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)))
        out, hidden = _layered(rgb, mask > 0, _read_mask(behind["maskPng"], rgb.shape) > 0, front > 0)
        meta = {"removedPx": count, "filler": "layered", "hiddenPx": hidden}
        if gen_error:
            meta["genError"] = gen_error
        return out, meta
    return object_fill.fill(rgb, mask), {"removedPx": count, "filler": "photo"}


def _on_backdrop(rgb: np.ndarray, hole: np.ndarray) -> bool:
    """Does the hole sit on a smooth studio backdrop (SMOOTH_BACKDROP)?"""
    s = min(1.0, 1024 / max(hole.shape))
    small = cv2.resize(rgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else rgb
    hs = cv2.resize(hole.astype(np.uint8), (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    ys, xs = np.nonzero(hs)
    if not len(ys):
        return False
    pad = max(6, int(BACKDROP_BAND * max(np.ptp(ys), np.ptp(xs))))
    near = cv2.dilate(hs, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * pad + 1,) * 2)) > 0
    ring = near & ~(cv2.dilate(hs, np.ones((9, 9), np.uint8)) > 0)
    if ring.sum() < 40:
        return False
    L = _lab100(small)[..., 0]
    grad = np.hypot(cv2.Sobel(L, cv2.CV_32F, 1, 0), cv2.Sobel(L, cv2.CV_32F, 0, 1))
    return float(np.percentile(grad[ring], 75)) <= SMOOTH_BACKDROP


#: How many removals one photograph may carry.
MAX_REMOVALS = 24


def apply(rgb: np.ndarray, params: dict):
    """Every removal on this photograph, one after another.

    A photograph can need several: the man, the pipe on the post, the tail's
    remnant. Choosing a second one used to replace the first, and the man came
    back. The earlier ones ride inside the selection as `removals` — the field
    already travels everywhere a selection does (recipe, render cache, export).
    Each is filled on the result of the ones before it.
    """
    selection = params.get("objectSelection")
    if not isinstance(selection, dict):
        raise ValueError("Object removal requires a saved selection")
    if not lama_fill.available():
        raise RuntimeError("LaMa model is unavailable for object removal")
    earlier = [r for r in (selection.get("removals") or []) if isinstance(r, dict)]
    steps = (earlier + ([selection] if selection.get("maskPng") else []))[-MAX_REMOVALS:]
    out, report = rgb, []
    drawn_steps = _drawn_group(rgb, steps) if gen_fill.available() else []
    if drawn_steps:
        # The removals the model draws are drawn TOGETHER, in one pass over
        # the untouched photograph: drawing the guide first and then the tail
        # left under the horse redrew the hoof twice and left it hazy; one
        # pass over both came back clean (321A5078).
        hole = np.zeros(rgb.shape[:2], bool)
        behind = np.zeros(rgb.shape[:2], bool)
        front = np.zeros(rgb.shape[:2], bool)     # the removals that stood before an object
        for i in drawn_steps:
            m, b = _step_masks(rgb, steps[i])
            hole |= m
            if b is not None:
                behind |= b
                front |= m
        try:
            out = gen_fill.fill(rgb, hole, behind & ~hole, band_from=front)
            for i in drawn_steps:
                report.append({"removedPx": int(_step_masks(rgb, steps[i])[0].sum()), "filler": "generative"})
        except gen_fill.GenFillError as exc:
            drawn_steps, out, gen_error = [], rgb, str(exc)
        else:
            gen_error = None
    else:
        gen_error = None
    # The plain removals are filled TOGETHER, in one pass: filled one after
    # another, the first hole took its texture from the next object still
    # standing beside it. 321A1843 (2026-10-05): the jar filled first copied
    # the teddy's fur into the jar's place; the teddy removed next left that
    # fur behind as a bear-shaped ghost. One pass never offers what is still
    # to be removed as source (object_fill.fill). A single removal is
    # unchanged by this.
    plain, layered_steps = [], []
    for i, step in enumerate(steps):
        if i in drawn_steps:
            continue
        hole, b = _step_masks(rgb, step)
        (layered_steps if b is not None else plain).append((i, hole))
    if plain:
        union = np.zeros(rgb.shape[:2], np.uint8)
        for _, hole in plain:
            union |= hole.astype(np.uint8)
        filler = "photo"
        if union.any():
            if gen_fill.available() and not _on_backdrop(out, union > 0):
                # Anything not on a studio backdrop is DRAWN when the model is
                # installed. Measured 2026-10-13 on 17 removals from the farm
                # and horse shoots (the photographer's verdicts on the copied
                # fill: "smeared, you can see the removal"): drawn, the guides at
                # the frame's edge leave tree and leaves instead of a dark
                # trunk or a pale strip, the racket in the girl's hand leaves
                # road instead of a dark smudge, the rump in 321A5078 closes;
                # balls and rackets on the road equal. The hat on the
                # soil/sand edge stays bad either way. A studio backdrop keeps
                # the copied fill: 21 of 22 clamps there were judged right.
                try:
                    out = gen_fill.fill(out, union > 0)
                    filler = "generative"
                except gen_fill.GenFillError as exc:
                    out = object_fill.fill(out, union)
                    gen_error = str(exc)
            else:
                out = object_fill.fill(out, union)
        for _, hole in plain:
            meta = {"removedPx": int(hole.sum()), "filler": filler if hole.any() else "none"}
            if filler == "photo" and gen_error:
                meta["genError"] = gen_error
            report.append(meta)
    for i, _ in layered_steps:
        step = steps[i]
        out, meta = _remove_one(out, step, allow_gen=False)
        if gen_error and meta.get("filler") == "layered":
            meta["genError"] = gen_error
        report.append(meta)
    removed = sum(m["removedPx"] for m in report)
    return out, {"removedPx": removed, "removals": report,
                 "coverage": round(removed / (rgb.shape[0] * rgb.shape[1]), 5)}
