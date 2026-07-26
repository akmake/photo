"""Read an edit: given before/after, work out what the retoucher actually did.

The naive version of this — subtract the two frames and look at what lights up —
does not work, and it fails in a specific way worth naming. A global grade
(exposure, white balance, saturation) moves EVERY pixel, so the difference map
comes back solid and the one thing you wanted to find, the object that was
removed from the grass, is buried under it.

So the work is done in three passes, in this order:

  1. GEOMETRY   did the frame move? crop, straighten, resize. Everything after
                this assumes the two frames describe the same pixels, and that
                assumption has to be earned, not asserted.

  2. GLOBAL     fit the tone/colour transform that best explains the whole
                frame, report it in the photographer's units (stops, warmth,
                saturation), and then DIVIDE IT OUT.

  3. LOCAL      whatever survives step 2 is a local edit: a spot healed, an
                object cloned out, a face retouched. Those get found, measured,
                classified and located.

What this does NOT do is name the object. "A tree" and "a fish" require a
recognition model; there is none in engine/models. What it reports instead is
where the change sits (face skin, hair, clothes, background) using the
segmenter that is already here, plus whether the region gained structure, lost
it, or merely changed — which is what distinguishes something added from
something removed.
"""

import cv2
import numpy as np

import masks

# Analysis resolution. Full 20MP costs minutes and buys nothing: a change too
# small to survive a 2400px downscale is a change no one is looking for.
WORK_MAX = 2400

# CIE ΔE76. ~1 is the just-noticeable difference for adjacent patches; 3 is
# comfortably visible. Below this is JPEG noise, not editing.
DELTA_E_FLOOR = 3.0

# A region smaller than this (at working resolution) is sensor noise or a
# compression artefact, not an edit worth reporting.
MIN_REGION_PX = 40
MAX_REGIONS = 40

ZONE_NAMES = {
    0: "רקע",
    1: "שיער",
    2: "עור הגוף",
    3: "עור הפנים",
    4: "בגדים",
}


# --------------------------------------------------------------- geometry


def _fit_work(rgb):
    h, w = rgb.shape[:2]
    s = WORK_MAX / max(h, w)
    if s >= 1.0:
        return rgb, 1.0
    out = cv2.resize(rgb, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return out, s


def align(before, after):
    """Bring `after` into `before`'s frame. -> (after_aligned, info)."""
    hb, wb = before.shape[:2]
    ha, wa = after.shape[:2]
    info = {
        "beforeSize": [wb, hb],
        "afterSize": [wa, ha],
        "sameSize": bool(wb == wa and hb == ha),
    }

    if not info["sameSize"]:
        after = cv2.resize(after, (wb, hb), interpolation=cv2.INTER_AREA)
        info["resized"] = True

    # Even at equal size the frame may have been cropped or straightened.
    # ORB + RANSAC tells us whether the two really describe the same pixels.
    g1 = cv2.cvtColor(before, cv2.COLOR_RGB2GRAY)
    g2 = cv2.cvtColor(after, cv2.COLOR_RGB2GRAY)
    orb = cv2.ORB_create(4000)
    k1, d1 = orb.detectAndCompute(g1, None)
    k2, d2 = orb.detectAndCompute(g2, None)

    info["method"] = "direct"
    info["shift"] = [0.0, 0.0]
    info["rotationDeg"] = 0.0
    info["scale"] = 1.0

    if d1 is None or d2 is None or len(k1) < 20 or len(k2) < 20:
        info["note"] = "too few features to verify alignment"
        return after, info

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = sorted(bf.match(d2, d1), key=lambda m: m.distance)[:800]
    if len(matches) < 12:
        info["note"] = "too few matches to verify alignment"
        return after, info

    src = np.float32([k2[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
    dst = np.float32([k1[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
    M, mask_in = cv2.estimateAffinePartial2D(
        src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0
    )
    if M is None:
        info["note"] = "alignment failed"
        return after, info

    inliers = float(mask_in.mean()) if mask_in is not None else 0.0
    scale = float(np.hypot(M[0, 0], M[0, 1]))
    rot = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
    shift = [float(M[0, 2]), float(M[1, 2])]
    info["inlierRatio"] = round(inliers, 3)

    moved = (
        abs(scale - 1.0) > 0.004
        or abs(rot) > 0.15
        or abs(shift[0]) > 2.0
        or abs(shift[1]) > 2.0
    )
    if moved and inliers > 0.3:
        after = cv2.warpAffine(
            after, M, (wb, hb), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
        )
        info["method"] = "affine"
        info["shift"] = [round(shift[0], 1), round(shift[1], 1)]
        info["rotationDeg"] = round(rot, 3)
        info["scale"] = round(scale, 4)

    return after, info


# ----------------------------------------------------------------- global


def _to_lab(rgb):
    return cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)


def _srgb_to_linear(v):
    v = np.asarray(v, dtype=np.float64) / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def fit_curves(before, after):
    """A per-channel tone curve mapping before -> after, one LUT per channel.

    A straight line cannot describe a real grade. Exposure is applied in linear
    light but stored gamma-encoded; contrast is an S-curve; split-toning bends
    the channels differently at each end. Fitting a LINE to that leaves a large
    residual spread over the whole frame, and every bit of it then reads as a
    "local change" — the first version of this reported 40 regions on an image
    whose only local edits were three.

    So: for every input level, take the MEDIAN output level. Locally edited
    pixels are a minority inside any one level bin, so the median steps over
    them and the curve describes the global grade alone.
    """
    luts = np.zeros((3, 256), np.float64)
    for c in range(3):
        b = before[..., c].reshape(-1)
        a = after[..., c].reshape(-1)
        step = max(1, b.size // 400_000)
        b, a = b[::step], a[::step]

        order = np.argsort(b, kind="stable")
        bs, as_ = b[order], a[order]
        edges = np.searchsorted(bs, np.arange(257))

        lut = np.full(256, np.nan)
        for i in range(256):
            seg = as_[edges[i] : edges[i + 1]]
            if seg.size:
                lut[i] = np.median(seg)

        idx = np.arange(256)
        known = ~np.isnan(lut)
        if known.sum() < 2:
            lut = idx.astype(np.float64)
        else:
            lut = np.interp(idx, idx[known], lut[known])
        lut = cv2.GaussianBlur(lut.reshape(-1, 1).astype(np.float32), (0, 0), 2.0).reshape(-1)
        # a tone curve never folds back on itself
        lut = np.maximum.accumulate(lut)
        luts[c] = np.clip(lut, 0, 255)
    return luts


def apply_curves(rgb, luts):
    out = np.empty_like(rgb, dtype=np.uint8)
    src = rgb.astype(np.uint8)
    for c in range(3):
        out[..., c] = cv2.LUT(src[..., c], luts[c].astype(np.uint8))
    return out


def fit_colour_matrix(pred_lab, after_lab):
    """A robust 3x4 affine in Lab, fitted on top of the curves.

    Per-channel curves are a function of ONE channel's value, so they cannot
    express saturation: a blue shirt and a green leaf that share a red value
    must move differently under +18% saturation, and a curve moves them the
    same. That leaves a residual on every coloured surface, which then reads as
    dozens of local edits — 26 of them, on the clothes, in the run that made me
    write this.

    A matrix mixes channels, so it covers saturation, white balance and channel
    cross-talk in one fit. Trimmed the same way the curves are, so real local
    edits stay out of it.
    """
    n = pred_lab.shape[0] * pred_lab.shape[1]
    step = max(1, n // 200_000)
    X = pred_lab.reshape(-1, 3)[::step].astype(np.float64)
    Y = after_lab.reshape(-1, 3)[::step].astype(np.float64)

    A, t = np.eye(3), np.zeros(3)
    keep = np.ones(len(X), bool)
    for _ in range(4):
        if keep.sum() < 128:
            break
        Xa = np.hstack([X[keep], np.ones((int(keep.sum()), 1))])
        sol, *_ = np.linalg.lstsq(Xa, Y[keep], rcond=None)
        A, t = sol[:3].T, sol[3]
        resid = np.linalg.norm(Y - (X @ A.T + t), axis=1)
        keep = resid <= (np.median(resid) * 2.5 + 1e-6)
    return A, t


def apply_matrix(lab, A, t):
    flat = lab.reshape(-1, 3) @ A.T + t
    return flat.reshape(lab.shape).astype(np.float32)


def describe_global(before, after, before_lab, after_lab, luts):
    """Turn the edit into things a photographer says out loud.

    MEASURED from the two frames, not read out of the fitted model. The model
    is built in stages, and each stage absorbs part of what the previous one
    left; asking the last stage "how much warmer did this get" returns the
    correction it applied, not the edit. That is how warmth came back as -6.7
    on an image that had been deliberately warmed by +6.

    Local edits are a small minority of pixels, so medians step over them.
    """
    lum = np.array([0.2126, 0.7152, 0.0722])
    yb = float(np.median(_srgb_to_linear(before.reshape(-1, 3)[::37]) @ lum))
    ya = float(np.median(_srgb_to_linear(after.reshape(-1, 3)[::37]) @ lum))
    stops = float(np.log2(max(ya, 1e-9) / max(yb, 1e-9)))

    slope = float((luts[:, 160].mean() - luts[:, 96].mean()) / 64.0)
    shadows = float(luts[:, 48].mean() - 48.0)
    highlights = float(luts[:, 208].mean() - 208.0)

    tint = float(np.median(after_lab[..., 1]) - np.median(before_lab[..., 1]))
    warmth = float(np.median(after_lab[..., 2]) - np.median(before_lab[..., 2]))

    cb = np.hypot(before_lab[..., 1] - 128.0, before_lab[..., 2] - 128.0)
    ca = np.hypot(after_lab[..., 1] - 128.0, after_lab[..., 2] - 128.0)
    sat = float(np.median(ca) / max(np.median(cb), 1e-6))

    return {
        "exposureStops": round(stops, 3),
        "contrastSlope": round(slope, 4),
        "shadowsShift": round(shadows, 2),
        "highlightsShift": round(highlights, 2),
        "warmthShift": round(warmth, 2),
        "tintShift": round(tint, 2),
        "saturationRatio": round(sat, 4),
        "significant": bool(
            abs(stops) > 0.04
            or abs(slope - 1.0) > 0.03
            or abs(warmth) > 1.0
            or abs(tint) > 1.0
            or abs(sat - 1.0) > 0.03
            or abs(shadows) > 2.0
            or abs(highlights) > 2.0
        ),
    }


# ------------------------------------------------------------------ local


def _detail(gray, region_mask):
    """Mean gradient magnitude inside a mask — how much structure lives here."""
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.hypot(gx, gy)
    sel = region_mask > 0
    return float(mag[sel].mean()) if sel.any() else 0.0


def _ring_distance(lab, region_mask, bbox):
    """How much this region stands out from what surrounds it.

    This is the signal that actually separates added from removed. When an
    object is cloned out, the patch that replaces it MATCHES its surroundings —
    that is what makes the removal convincing. When one is pasted in, the patch
    CLASHES with them. Detail energy alone gets this wrong whenever the added
    object happens to be about as textured as what it covered.
    """
    x, y, w, h = bbox
    pad = max(6, int(max(w, h) * 0.6))
    H, W = region_mask.shape
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(W, x + w + pad), min(H, y + h + pad)

    sub = lab[y0:y1, x0:x1]
    m = region_mask[y0:y1, x0:x1] > 0
    ring = ~m
    if m.sum() < 8 or ring.sum() < 8:
        return 0.0
    return float(np.linalg.norm(sub[m].mean(axis=0) - sub[ring].mean(axis=0)))


def find_regions(before, after_norm, before_lab, after_norm_lab):
    d = np.sqrt(((before_lab - after_norm_lab) ** 2).sum(axis=2))
    d = cv2.GaussianBlur(d, (0, 0), 1.6)

    # Noise floor from the frame itself: JPEG and sensor noise set a baseline
    # that a fixed threshold would either drown in or ignore.
    med = float(np.median(d))
    mad = float(np.median(np.abs(d - med))) + 1e-6
    thr = max(DELTA_E_FLOOR, med + 6.0 * mad)

    binary = (d > thr).astype(np.uint8)
    k = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, k, iterations=1)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k, iterations=2)

    n, labels, stats, cents = cv2.connectedComponentsWithStats(binary, 8)

    gb = cv2.cvtColor(before, cv2.COLOR_RGB2GRAY).astype(np.float32)
    ga = cv2.cvtColor(after_norm, cv2.COLOR_RGB2GRAY).astype(np.float32)

    try:
        zones = masks._category_map(before)
    except Exception:
        zones = None

    H, W = binary.shape
    frame_px = float(H * W)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < MIN_REGION_PX:
            continue
        m = (labels == i).astype(np.uint8)
        db = _detail(gb, m)
        da = _detail(ga, m)
        ratio = (da + 0.5) / (db + 0.5)

        # Two independent votes, combined in log space so neither can dominate:
        # did the area gain or lose structure, and did it start or stop
        # standing out from its surroundings.
        ring_b = _ring_distance(before_lab, m, (x, y, w, h))
        ring_a = _ring_distance(after_norm_lab, m, (x, y, w, h))
        ring_ratio = (ring_a + 1.5) / (ring_b + 1.5)
        score = float(np.log(ratio) + np.log(ring_ratio))

        # Does the same CONTENT still live here? Correlating the two gradient
        # fields answers that independently of how bright or colourful the area
        # became. Brightening a patch raises its contrast and makes it stand
        # out more, which fools both votes above into calling it an addition —
        # but its edges are still exactly where they were.
        sub = (slice(y, y + h), slice(x, x + w))
        eb = np.abs(cv2.Laplacian(gb[sub], cv2.CV_32F))
        ea = np.abs(cv2.Laplacian(ga[sub], cv2.CV_32F))
        mm = m[sub] > 0
        corr = 0.0
        if mm.sum() > 24:
            vb, va = eb[mm], ea[mm]
            sb, sa = vb.std(), va.std()
            if sb > 1e-4 and sa > 1e-4:
                corr = float(((vb - vb.mean()) * (va - va.mean())).mean() / (sb * sa))

        if corr > 0.72:
            kind = "changed"  # same structure, different tone
        elif score < -0.30:
            kind = "removed"
        elif score > 0.30:
            kind = "added"
        else:
            kind = "changed"

        zone = None
        if zones is not None:
            vals, counts = np.unique(zones[m > 0], return_counts=True)
            zone = ZONE_NAMES.get(int(vals[counts.argmax()]), None)

        out.append(
            {
                "bbox": [int(x), int(y), int(w), int(h)],
                "centroid": [round(float(cents[i][0]), 1), round(float(cents[i][1]), 1)],
                "areaPx": int(area),
                "areaPct": round(area / frame_px * 100, 4),
                "meanDeltaE": round(float(d[m > 0].mean()), 2),
                "maxDeltaE": round(float(d[m > 0].max()), 2),
                "detailBefore": round(db, 2),
                "detailAfter": round(da, 2),
                "structureRatio": round(float(ratio), 3),
                "standoutRatio": round(float(ring_ratio), 3),
                "contentCorr": round(corr, 3),
                "score": round(score, 3),
                # No global colour model describes a real grade exactly, and
                # what it fails to explain piles up on saturated, detailed
                # surfaces. Those leftovers sit just above the threshold; a
                # genuine edit sits far above it. Rank on that rather than
                # pretending the model is perfect.
                "confidence": round(float(np.clip((d[m > 0].mean() / thr - 1.0) / 2.5, 0, 1)), 3),
                "strong": bool(d[m > 0].mean() > thr * 2.5),
                "kind": kind,
                "zone": zone,
            }
        )

    out.sort(key=lambda r: r["meanDeltaE"] * r["areaPx"], reverse=True)
    return out[:MAX_REGIONS], thr, d


# ---------------------------------------------------------------- overlay

KIND_BGR = {
    "removed": (60, 60, 235),
    "added": (90, 200, 90),
    "changed": (40, 150, 245),
}


def overlay(after_rgb, regions):
    img = cv2.cvtColor(after_rgb, cv2.COLOR_RGB2BGR).copy()
    thick = max(2, int(max(img.shape[:2]) / 700))
    for idx, r in enumerate(regions, 1):
        x, y, w, h = r["bbox"]
        pad = max(4, int(max(w, h) * 0.12))
        p1 = (max(0, x - pad), max(0, y - pad))
        p2 = (min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad))
        col = KIND_BGR.get(r["kind"], (200, 200, 200))
        cv2.rectangle(img, p1, p2, col, thick)
        cv2.putText(
            img, str(idx), (p1[0], max(14, p1[1] - 5)),
            cv2.FONT_HERSHEY_SIMPLEX, thick * 0.28, col, max(1, thick - 1), cv2.LINE_AA,
        )
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


# ------------------------------------------------------------------- api


def analyze(before_rgb, after_rgb):
    before, scale = _fit_work(before_rgb)
    after, _ = _fit_work(after_rgb)

    after, geom = align(before, after)
    geom["workScale"] = round(scale, 4)
    geom["workSize"] = [int(before.shape[1]), int(before.shape[0])]

    after_lab = _to_lab(after)

    # Predict `after` from `before` using the global grade alone. Whatever the
    # prediction fails to explain is, by construction, a LOCAL edit — so the
    # comparison below is prediction-vs-actual, not before-vs-after.
    # Curves and matrix each absorb what the other cannot, and neither is a
    # complete description on its own, so alternate until the prediction stops
    # improving. One pass left a systematic residual on every saturated
    # surface; the clothes in the test frame came back as 26 phantom edits.
    luts = fit_curves(before, after)
    predicted = apply_curves(before, luts)
    for _ in range(3):
        pl = _to_lab(predicted)
        A, t = fit_colour_matrix(pl, after_lab)
        pl = np.clip(apply_matrix(pl, A, t), 0, 255)
        predicted = cv2.cvtColor(pl.astype(np.uint8), cv2.COLOR_LAB2RGB)
        step_luts = fit_curves(predicted, after)
        predicted = apply_curves(predicted, step_luts)
        # keep one composed curve so the reported tone response describes the
        # whole chain, not just the last pass
        for c in range(3):
            luts[c] = step_luts[c][np.clip(luts[c], 0, 255).astype(np.uint8)]

    pred_lab = _to_lab(predicted)
    before_lab = _to_lab(before)
    glob = describe_global(before, after, before_lab, after_lab, luts)

    regions, thr, dmap = find_regions(predicted, after, pred_lab, after_lab)

    changed_px = float((dmap > thr).sum())
    strong = [r for r in regions if r["strong"]]
    summary = {
        "regions": len(regions),
        "strongRegions": len(strong),
        "added": sum(1 for r in strong if r["kind"] == "added"),
        "removed": sum(1 for r in strong if r["kind"] == "removed"),
        "changed": sum(1 for r in strong if r["kind"] == "changed"),
        "localAreaPct": round(changed_px / dmap.size * 100, 4),
        "deltaEThreshold": round(float(thr), 2),
    }

    return {
        "geometry": geom,
        "global": glob,
        "summary": summary,
        "regions": regions,
        # Boxes are drawn for the confident findings only. Regions sort by
        # significance, so these are the leading entries and the numbers on the
        # picture line up with the top of the list.
    }, overlay(after, strong)
