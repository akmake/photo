"""Eye sparkle — AI tool.

mask      = iris / pupil / limbus / sclera, split from real iris landmarks
operation = CONTRAST, not brightness

The instinct is to brighten the iris and whiten the sclera. Both are wrong on
their own, and the research is unusually specific about why:

  * "The light source always enters one side of the iris and is refracted from
    the opposite side" — so the bright part of an iris is OPPOSITE the
    catchlight, never centred and never uniform.
  * "The eyelid naturally casts a shadow on the upper portion of the iris" — so
    a flat lift erases the very gradient that makes an eye look spherical.
  * What reads as sparkle is the contrast between a dark pupil, a dark limbal
    ring and a lit iris edge. Darkening does as much work as brightening.

The named failure modes, all avoided here: uniform single-stroke brightening,
an over-sharpened limbus, an over-bright sclera that glows, and a sclera scrubbed
free of blood vessels (which is uncanny — vessels are only DESATURATED here,
never removed, because L* is untouched in the sclera's chroma pass).

This is only possible because the project's face_landmarker returns 478 points:
468-472 is the left iris, 473-477 the right, giving an exact centre and radius
per eye. Without them the tool would be guessing at circles.

See docs/RESEARCH-blush-eyes-hair.md.
"""

import cv2
import numpy as np

import common
import local_color
import masks

LEFT_IRIS = (468, 469, 470, 471, 472)
RIGHT_IRIS = (473, 474, 475, 476, 477)

# An iris smaller than this is a few pixels across; a limbal ring cannot be
# drawn inside it without turning the whole eye into a dark blob.
MIN_IRIS_PX = 6.0


def process(image_b64: str, params: dict):
    """HTTP wrapper. Internal chaining must use apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def _radial(shape, cx, cy):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    return np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2), xx, yy


def _one_eye(rgb, lm, iris_idx, eye_idx, strength, whites, sparkle, meta):
    """Retouch a single eye in place on a crop. Returns the modified frame."""
    h, w = rgb.shape[:2]
    ctr = np.array([lm[iris_idx[0]].x * w, lm[iris_idx[0]].y * h], np.float32)
    rim = np.array([[lm[i].x * w, lm[i].y * h] for i in iris_idx[1:]], np.float32)
    radius = float(np.mean(np.linalg.norm(rim - ctr, axis=1)))
    if radius < MIN_IRIS_PX:
        meta["irisTooSmall"] = meta.get("irisTooSmall", 0) + 1
        return rgb

    # work on a tight box around the eye — the whole point of landmarks
    eye_pts = np.array([[lm[i].x * w, lm[i].y * h] for i in eye_idx], np.float32)
    pad = int(radius * 2.5)
    x0 = max(0, int(eye_pts[:, 0].min()) - pad)
    y0 = max(0, int(eye_pts[:, 1].min()) - pad)
    x1 = min(w, int(eye_pts[:, 0].max()) + pad)
    y1 = min(h, int(eye_pts[:, 1].max()) + pad)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return rgb

    crop = rgb[y0:y1, x0:x1].astype(np.float32)
    ch, cw = crop.shape[:2]
    cx, cy = ctr[0] - x0, ctr[1] - y0

    # --- regions -----------------------------------------------------------
    opening = np.zeros((ch, cw), np.uint8)
    cv2.fillPoly(opening, [(eye_pts - [x0, y0]).astype(np.int32)], 255)
    # 1px feather only: the lid edge is a real edge and must stay one
    opening = cv2.GaussianBlur(opening, (3, 3), 0).astype(np.float32) / 255.0

    dist, xx, yy = _radial((ch, cw), cx, cy)
    iris = np.clip((radius - dist) / max(1.0, radius * 0.12), 0.0, 1.0) * opening
    pupil = np.clip((radius * 0.42 - dist) / max(1.0, radius * 0.18), 0.0, 1.0) * opening
    # the limbal ring: a band just inside the iris edge
    limbus = np.clip(
        1.0 - np.abs(dist - radius * 0.93) / max(1.0, radius * 0.16), 0.0, 1.0
    ) * opening
    sclera = np.clip(opening - iris, 0.0, 1.0)

    lab = local_color.to_lab(crop)
    L = lab[..., 0]

    # --- where is the catchlight? -----------------------------------------
    # brightest point inside the iris. The lit side of the iris is OPPOSITE it.
    inside = iris > 0.5
    if inside.sum() < 8:
        return rgb
    lit = L.copy()
    lit[~inside] = -1.0
    py, px = np.unravel_index(int(np.argmax(lit)), lit.shape)
    cl_vec = np.array([px - cx, py - cy], np.float32)
    n = float(np.linalg.norm(cl_vec))
    cl_dir = cl_vec / n if n > 1e-3 else np.array([0.0, -1.0], np.float32)

    # gradient running AWAY from the catchlight, 0..1 across the iris
    proj = ((xx - cx) * -cl_dir[0] + (yy - cy) * -cl_dir[1]) / max(1.0, radius)
    lit_side = np.clip(proj * 0.5 + 0.5, 0.0, 1.0)

    # the eyelid shadows the top of the iris — keep it shadowed
    lid = np.clip((yy - (cy - radius)) / max(1.0, radius * 1.1), 0.0, 1.0)
    lid = 0.35 + 0.65 * lid

    # --- the pushes --------------------------------------------------------
    s = strength
    d_l = np.zeros((ch, cw), np.float32)
    d_l += iris * lit_side * lid * (26.0 * s)     # brighten the lit side only
    d_l -= limbus * (30.0 * s)                    # dark limbal ring = definition
    d_l -= pupil * (24.0 * s)                     # a pupil should read as black
    d_l += sclera * (10.0 * whites)               # whites: SLIGHT, or it glows

    out = local_color.push_lab(crop, np.ones((ch, cw), np.float32), d_l=d_l)

    # sclera: reduce yellow/red rather than paint it white. L* is untouched by
    # this pass, so the blood vessels stay exactly where they are.
    out = local_color.desaturate(out, sclera, 0.55 * whites)

    # iris micro-contrast. Radius is tied to the iris, not the frame, so it
    # cannot bite into the limbus and produce the over-sharpened ring.
    if sparkle > 0:
        lab2 = local_color.to_lab(out)
        r = max(3, int(radius * 0.35)) | 1
        blur = cv2.GaussianBlur(lab2[..., 0], (r, r), 0)
        detail = np.clip((lab2[..., 0] - blur) * (1.6 * sparkle), -30, 30)
        lab2[..., 0] += detail * iris * lid
        out = local_color.to_rgb(lab2)

    rgb = rgb.copy()
    rgb[y0:y1, x0:x1] = np.clip(out, 0, 255).astype(np.uint8)
    meta["eyes"] = meta.get("eyes", 0) + 1
    meta.setdefault("irisRadiusPx", []).append(round(radius, 1))
    return rgb


def apply(rgb, params: dict):
    """params: { strength: 0..100, whites: 0..100, sparkle: 0..100 }"""
    strength = common.clamp01(params.get("strength", 50))
    whites = common.clamp01(params.get("whites", 40))
    sparkle = common.clamp01(params.get("sparkle", 45))
    if strength <= 0 and whites <= 0 and sparkle <= 0:
        return rgb, {"eyes": 0}

    faces = masks._face_landmarks(rgb)
    if not faces:
        return rgb, {"eyes": 0, "noFace": 1}

    meta = {"eyes": 0}
    out = rgb
    for lm in faces:
        if len(lm) < 478:
            meta["noIrisLandmarks"] = 1
            continue
        for iris_idx, eye_idx in (
            (LEFT_IRIS, masks.LEFT_EYE),
            (RIGHT_IRIS, masks.RIGHT_EYE),
        ):
            out = _one_eye(out, lm, iris_idx, eye_idx, strength, whites, sparkle, meta)
    return out, meta
