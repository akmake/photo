"""Per-photo object removal: click selection and reproducible local fill.

The selected mask is stored in the recipe as PNG bytes. It is deliberately
independent of a fresh segmentation run: preview and export use the same
selection, scaled to their respective frame sizes.
"""

import base64
import threading

import cv2
import numpy as np

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


def _choose_candidate(candidates: np.ndarray, scores: np.ndarray) -> int:
    """Prefer the enclosing object when the predictor also offers a part.

    A shirt can score a little higher than the whole person. Keep the broader
    candidate only when it contains the precise one, is similarly confident,
    and is not the scene itself: past half the frame, or more than SWALLOW
    times the area it was supposed to extend, it is no longer that object.
    A subject can legitimately fill a third of a portrait, so the guard is a
    ratio to what was clicked, not a small fixed share of the frame. The caller
    still receives every candidate for visual review.
    """
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
    return candidates, scores, _choose_candidate(candidates, scores)


def hover(rgb: np.ndarray, x: float, y: float, key=None) -> dict:
    """What a click here would select — shown before the click."""
    small = _small(rgb)
    with _predict_lock:
        candidates, _, index = _pick(small, [(x, y, True)], key)
    return {"maskPng": _mask_data(candidates[index])}


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
        behind = _find_behind(small, mask.astype(bool))
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
        snap = _snap_under(small, painted)
    # The strokes travel with the selection and are drawn again at every
    # render size: the PNG is 1024 wide, and stretched to 5472 its edge was a
    # 5px staircase that left the rim of a pipe outside the removal.
    paint = [{"id": str(s.get("id", i)), "points": [[float(x), float(y)] for x, y in s.get("points") or []],
              "r": float(s.get("r", 0.0))} for i, s in enumerate(strokes or [])]
    out = {"maskPng": _mask_data(painted), "coverage": round(float(painted.mean()), 5),
           "width": sw, "height": sh, "margin": 0.0, "paint": paint}
    if behind is not None:
        out["behind"] = {"maskPng": _mask_data(behind)}
    if snap is not None:
        out["snap"] = {"maskPng": _mask_data(snap)}
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
        mask = manual_clean.strokes_mask(shape, paint)
        snap = selection.get("snap")
        if isinstance(snap, dict) and snap.get("maskPng"):
            # the segmenter's edge, read at 1024 and brought up smoothly, kept
            # to the band around what was actually painted
            soft = _read_mask(snap["maskPng"], shape, smooth=True) > 0
            r = max(2, round(SNAP_BAND * w))
            band = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1,) * 2)) > 0
            mask = np.maximum(mask, (soft & band).astype(np.uint8))
        if rgb is not None:
            mask = catch_remnants(rgb, mask)
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
    # The background is rebuilt by the same fill as a plain removal: the old
    # one (network at 512 + borrowed detail) left a soft rectangle with hard
    # sides in the ground under the man in 321A4983. The object is kept out
    # of the fill's sources — soil must not be patched with horse.
    background = object_fill.fill(win, bg_unknown, avoid=near_obj[sl])

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
INSIDE_SHARE = 0.6


def _straddles(hole: np.ndarray, behind: np.ndarray) -> bool:
    """Does the hole sit on the object's edge (object on one side, backdrop on
    the other) — the only case the layered fill is for?

    Layered filling separates two materials. A hole the object surrounds has
    one material around it, and the plain fill continues it from every side:
    the black pipe on the fence post in 321A5078, filled in layers, left a dark
    slot through the post; filled plainly, the wood closes over it.
    """
    w = hole.shape[1]
    r = max(3, round(0.004 * w))
    rim = (cv2.dilate(hole.astype(np.uint8), cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0) & ~hole
    if not rim.any():
        return False
    return float((behind & rim).sum()) / float(rim.sum()) < INSIDE_SHARE


def _remove_one(rgb: np.ndarray, selection: dict):
    mask = repair_mask(rgb.shape, selection, rgb)
    count = int(mask.sum())
    if not count:
        return rgb, {"removedPx": 0, "filler": "none"}
    behind = selection.get("behind")
    if isinstance(behind, dict) and behind.get("maskPng") and _straddles(
            mask > 0, _read_mask(behind["maskPng"], rgb.shape) > 0):
        front = _read_mask(selection["maskPng"], rgb.shape)
        radius = round(float(selection.get("margin", DEFAULT_MARGIN)) * rgb.shape[1])
        if radius:
            front = cv2.dilate(front, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)))
        out, hidden = _layered(rgb, mask > 0, _read_mask(behind["maskPng"], rgb.shape) > 0, front > 0)
        return out, {"removedPx": count, "filler": "layered", "hiddenPx": hidden}
    return object_fill.fill(rgb, mask), {"removedPx": count, "filler": "photo"}


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
    for step in steps:
        out, meta = _remove_one(out, step)
        report.append(meta)
    removed = sum(m["removedPx"] for m in report)
    return out, {"removedPx": removed, "removals": report,
                 "coverage": round(removed / (rgb.shape[0] * rgb.shape[1]), 5)}
