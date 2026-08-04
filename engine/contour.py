"""Dodge & burn — AI tool.

mask      = anatomical bands from face landmarks, plus the light already there
operation = an L* push in Lab, relative to the local skin

This is the tool that makes a face look three-dimensional, and it is a different
job from clarity or texture. Those amplify contrast that already exists at some
frequency. Dodge and burn CREATES light and shadow that the exposure did not: it
puts a highlight down the centre of the forehead and along the top of the
cheekbone, and darkness in the hollow beneath it. That is what a retoucher does
on a 50% grey layer, and it is why a retouched portrait has a shape a sharpened
one does not.

Two families of control, deliberately separate:

  * The anatomical bands (`cheekbones`, `forehead`, `jaw`, `undereye`) place
    light where the bone is, whatever the light in the frame did. They need
    landmarks. `undereye` is the single most-used move in portrait retouch —
    the concealer lift of the tear trough; the features mask keeps it off the
    eye itself.
  * `sculpt` needs none. It reads the modelling the photograph already has — the
    low-frequency light across the face — and amplifies it. It works at any head
    angle and in any light, and it never invents a highlight where the scene put
    none, which is the failure mode of contouring by anatomy alone.

That failure mode was measured, not guessed (jm/321A5601, cheek in shadow at
L* 34 against 65 on the lit side — the bands pushed both by the same +3.6):
so the bands pass through a scene-light gate, `fidelity`. The push keeps full
strength wherever the scene lights the skin at or above the face's own average
and tapers toward (1 - fidelity) in deep shadow. A retoucher's contour follows
the light; it never fills a shadow the scene put there. 0 = the ungated tool.

Only L* is written. a* and b* are untouched, so skin keeps its own colour and
pores keep their texture; the low-frequency nature of the bands is what stops
this from becoming a sharpening filter.

Deliberately NOT built: a nose axis (bridge dodge + side burn). It is shading
rather than geometry, so it is not the liquify family, but its purpose is to
make a nose read narrower — which is the same intent the geometry tools were
ruled out for. It needs an explicit decision, not a default.
"""

import cv2
import numpy as np

import common
import local_color
import masks

MIN_FACE_PX = 120

# L push at full strength, on OpenCV's byte Lab scale (255/100). ~6 L* points —
# retouching practice keeps facial dodge and burn under roughly 8, past which it
# reads as makeup rather than light.
MAX_DL = 16.0
# how much of the modelling already in the frame `sculpt` adds back on top
SCULPT_GAIN = 0.55
# the scale on which "how lit is this part of the face" is read — wider than a
# band, narrower than the face, so a shadowed cheek reads dark even when the
# other half of the face is bright
ILLUM_KSIZE = 0.25
# scene-light taper: full anatomical push at the face's average light, floor
# reached TAPER_L L* points below it — about half the lit/shadow spread of a
# hard side-lit face (30 L* measured on jm/321A5601)
TAPER_L = 14.0
# a dodge must never drive a channel into the 255 ceiling: the clip rotates
# hue (measured on 321A5117 — every a*/b* outlier in the band sat at max-RGB
# ≥ 249 before the push and at 255 after) and the specular flattens to
# plastic. Full push below HEADROOM_LO, nothing at HEADROOM_HI. Burn needs no
# twin: −MAX_DL cannot reach the black floor from anywhere a band lives.
HEADROOM_LO, HEADROOM_HI = 235.0, 252.0


def process(image_b64: str, params: dict):
    """HTTP wrapper. Internal chaining must use apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def _p(params, key, default=0.0):
    try:
        return float(params.get(key, default)) / 100.0
    except (TypeError, ValueError):
        return default / 100.0


def _ellipse(shape, centre, major, minor, angle) -> np.ndarray:
    layer = np.zeros(shape[:2], np.uint8)
    cv2.ellipse(
        layer, (int(centre[0]), int(centre[1])),
        (max(2, int(major)), max(2, int(minor))), angle, 0, 360, 255, -1,
    )
    return layer.astype(np.float32) / 255.0


def _bands(rgb, faces, notes: dict):
    """The anatomical maps, each 0..1:
    (cheek_up, cheek_low, forehead, jaw, undereye).

    `notes` collects per-face size refusals — see the gate below for why a
    silent `continue` here was worse than no gate at all."""
    h, w = rgb.shape[:2]
    out = [np.zeros((h, w), np.float32) for _ in range(5)]

    for lm in faces:
        def pt(i):
            return np.array([lm[i].x * w, lm[i].y * h], np.float32)

        fw = float(np.linalg.norm(pt(masks.FACE_RIGHT) - pt(masks.FACE_LEFT)))
        # Per-face, and it must REPORT. The gate in `apply` reads sqrt of the
        # whole frame's skin, so in a group photo it is the sum of every face
        # and always passes; this one then drops each face in turn without a
        # word, and the tool returns the frame looking merely ineffective.
        if common.source_px(fw) < MIN_FACE_PX:
            notes['faceTooSmall'] = notes.get('faceTooSmall', 0) + 1
            continue
        if fw < MIN_FACE_PX:
            notes['previewTooSmall'] = notes.get('previewTooSmall', 0) + 1
            continue

        mouth_c = (pt(masks.MOUTH_CORNERS[0]) + pt(masks.MOUTH_CORNERS[1])) / 2

        # --- cheekbones: the plane on top of the bone, the hollow under it ---
        for temple_i, cheek_i, mouth_i, eye_idx in (
            (masks.FACE_LEFT, masks.LEFT_CHEEK_CENTER, masks.MOUTH_CORNERS[0], masks.LEFT_EYE),
            (masks.FACE_RIGHT, masks.RIGHT_CHEEK_CENTER, masks.MOUTH_CORNERS[1], masks.RIGHT_EYE),
        ):
            temple, cheek, mouth = pt(temple_i), pt(cheek_i), pt(mouth_i)
            axis = mouth - temple
            length = float(np.linalg.norm(axis))
            if length < 8:
                continue
            angle = float(np.degrees(np.arctan2(axis[1], axis[0])))
            # perpendicular, anchored to the face and not the frame: "up" is
            # toward this side's eye, so the bone plane and the hollow keep
            # their places at any head angle, lying down or upside-down
            eye_c = np.mean([pt(i) for i in eye_idx], axis=0)
            perp = np.array([-axis[1], axis[0]], np.float32) / length
            if float(np.dot(perp, eye_c - cheek)) < 0:
                perp = -perp
            # same anchor the blush uses: a third back toward the temple is
            # where the zygomatic arch actually runs
            centre = cheek + (temple - cheek) * 0.28
            major, minor = length * 0.34, length * 0.12
            out[0] = np.maximum(out[0], _ellipse(rgb.shape, centre + perp * minor * 0.9,
                                                 major, minor, angle))
            out[1] = np.maximum(out[1], _ellipse(rgb.shape, centre - perp * minor * 1.5,
                                                 major * 0.9, minor, angle))

        # --- forehead: the centre panel, brow line to hairline ---
        brow = np.mean([pt(i) for i in masks.LEFT_EYEBROW + masks.RIGHT_EYEBROW], axis=0)
        top = pt(masks.FACE_OVAL[0])
        out[2] = np.maximum(
            out[2], _ellipse(rgb.shape, brow + (top - brow) * 0.55, fw * 0.20, fw * 0.13, 0)
        )

        # --- jaw: a band just under the jawline, which is what defines it ---
        oval = np.array([pt(i) for i in masks.FACE_OVAL], np.float32)
        lower = oval[oval[:, 1] > float(np.mean(oval[:, 1]))]
        if len(lower) >= 3:
            order = np.argsort(lower[:, 0])
            poly = (lower[order] + np.array([0.0, fw * 0.035], np.float32)).astype(np.int32)
            layer = np.zeros((h, w), np.uint8)
            cv2.polylines(layer, [poly], False, 255, max(2, int(fw * 0.07)))
            out[3] = np.maximum(out[3], layer.astype(np.float32) / 255.0)

        # --- under-eye: the tear-trough strip below each lower lid. Sized by
        # the eye itself, "down" is toward the mouth — pose-independent. It may
        # brush the eye; the features mask trims that part off. ---
        for c1_i, c2_i in ((33, 133), (362, 263)):
            c1, c2 = pt(c1_i), pt(c2_i)
            ew = float(np.linalg.norm(c2 - c1))
            if ew < 6:
                continue
            eye_c = (c1 + c2) / 2
            angle = float(np.degrees(np.arctan2((c2 - c1)[1], (c2 - c1)[0])))
            down = np.array([-(c2 - c1)[1], (c2 - c1)[0]], np.float32) / ew
            if float(np.dot(down, mouth_c - eye_c)) < 0:
                down = -down
            centre = eye_c + down * ew * 0.55
            out[4] = np.maximum(out[4], _ellipse(rgb.shape, centre, ew * 0.62, ew * 0.26, angle))

    return out


def _structure(rgb, face_d):
    """The modelling the photograph already has: low-frequency light on the
    face, measured against the face's own average brightness."""
    lab_l = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32)
    near = max(3, int(face_d * 0.12)) | 1
    wide = max(3, int(face_d * 0.55)) | 1
    return cv2.GaussianBlur(lab_l, (near, near), 0) - cv2.GaussianBlur(lab_l, (wide, wide), 0)


def _light_weight(rgb, skin, face_d, fidelity):
    """Per-pixel share of the anatomical push the scene's light allows: 1 at
    or above the face's average illumination, smoothstepping down to
    (1 - fidelity) at TAPER_L L* points below it."""
    lab_l = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32)
    k = max(3, int(face_d * ILLUM_KSIZE)) | 1
    illum = cv2.GaussianBlur(lab_l, (k, k), 0)
    on_skin = skin > 0.5
    face_mean = float(lab_l[on_skin].mean()) if on_skin.any() else float(lab_l.mean())
    shade = (illum - face_mean) / 2.55  # byte Lab -> L* points
    t = np.clip((shade + TAPER_L) / TAPER_L, 0.0, 1.0)
    t = t * t * (3.0 - 2.0 * t)
    return 1.0 - fidelity * (1.0 - t)


def apply(rgb, params: dict):
    """params: { cheekbones, forehead, jaw, undereye, sculpt, softness, fidelity } — all 0..100"""
    cheek = _p(params, "cheekbones")
    forehead = _p(params, "forehead")
    jaw = _p(params, "jaw")
    undereye = _p(params, "undereye")
    sculpt = _p(params, "sculpt")
    anatomical = cheek or forehead or jaw or undereye
    if not (anatomical or sculpt):
        return rgb, {"applied": 0}

    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(float(skin.sum())))
    verdict = common.face_verdict(face_d, MIN_FACE_PX)
    if verdict:
        return rgb, {"applied": 0, verdict: 1}

    faces = masks._face_landmarks(rgb)
    if not faces and anatomical:
        return rgb, {"applied": 0, "noFace": 1}

    soft = _p(params, "softness", 50)
    radius = face_d * (0.03 + 0.09 * soft)
    notes: dict = {}   # per-face size refusals, collected by _bands

    dl = np.zeros(rgb.shape[:2], np.float32)
    reach = skin
    light_follow = None
    if faces and anatomical:
        cheek_up, cheek_low, fore, jawband, under = (
            local_color.feather(b, radius) for b in _bands(rgb, faces, notes)
        )
        if jaw:
            # The shadow that defines a jawline falls UNDER it, which is neck,
            # not face. Gated to face-skin alone the band lost more than half
            # of itself (measured 44% surviving) and the slider under-delivered.
            reach = np.clip(skin + masks.get_mask(rgb, "body-skin") * jawband, 0.0, 1.0)
        # one slider drives the pair: lifting the bone without deepening the
        # hollow under it is not a cheekbone, it is a bright patch
        anat = (cheek_up - cheek_low) * (cheek * MAX_DL)
        anat += fore * (forehead * MAX_DL)
        anat -= jawband * (jaw * MAX_DL)
        anat += under * (undereye * MAX_DL)
        fidelity = _p(params, "fidelity", 70)
        if fidelity:
            weight = _light_weight(rgb, skin, face_d, fidelity)
            active = np.abs(anat) > 0.5
            if active.any():
                light_follow = float(weight[active].mean())
            anat *= weight
        dl += anat
    if sculpt:
        dl += _structure(rgb, face_d) * (sculpt * SCULPT_GAIN)

    # never on eyes, brows, lips or nostrils, and never off skin
    features = masks.get_mask(rgb, "face-features")
    region = np.clip(reach * (1.0 - features), 0.0, 1.0)
    if float(region.sum()) < 64:
        return rgb, {"applied": 0}

    box = common.region_box(region, int(face_d * 0.2), rgb.shape)
    if box is None:
        return rgb, {"applied": 0}
    x0, y0, x1, y1 = box
    crop, reg, d = rgb[y0:y1, x0:x1], region[y0:y1, x0:x1], dl[y0:y1, x0:x1]

    # the rolloff reads the highlight ZONE, not the pixel: gating per pixel
    # modulates the push at pore frequency — a specular gets 0 while the skin
    # beside it gets everything — and eats micro-contrast (measured 0.855 of
    # the band's high-freq std). Blurred, the hot zone is still never driven
    # into the ceiling and texture inside it is left alone; a lone specular
    # may kiss 255, but it is already white and has no hue to rotate.
    maxc = cv2.GaussianBlur(crop.max(axis=2).astype(np.float32), (0, 0),
                            max(2.0, face_d * 0.01))
    headroom = np.clip((HEADROOM_HI - maxc) / (HEADROOM_HI - HEADROOM_LO), 0.0, 1.0)
    d = np.where(d > 0, d * headroom, d)

    pushed = local_color.push_lab(crop, reg, d_l=d)
    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(pushed, 0, 255).astype(np.uint8)

    sel = reg > 0.5
    # `applied: 1` with an all-zero push is the same silent lie the gates above
    # were making, one stage later: every face was dropped, dl never moved, and
    # the frame comes back byte-identical while the report says the tool ran.
    moved = int(((np.abs(d) > 1.0) & sel).sum())
    if not moved and notes:
        return rgb, {"applied": 0, "faces": len(faces), **notes}
    info = {
        "applied": 1,
        **notes,
        "faces": len(faces),
        "faceDiameter": round(face_d, 1),
        "meanAbsL": round(float(np.abs(d[sel]).mean()), 2) if sel.any() else 0.0,
        "dodgedPx": int(((d > 1.0) & sel).sum()),
        "burnedPx": int(((d < -1.0) & sel).sum()),
    }
    if light_follow is not None:
        info["lightFollow"] = round(light_follow, 2)
    return out, info
