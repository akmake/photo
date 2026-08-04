"""Blush — AI tool.

mask      = a band along the CHEEKBONE, built from face landmarks
operation = an a* (erythema) push in Lab, relative to the local skin colour

Two things separate this from "put a pink disc on the cheek":

  1. Placement. The professional stroke runs temple -> across the cheekbone ->
     toward the corner of the mouth. It follows the zygomatic bone, not the soft
     apple of the cheek. A disc on the apple is the look of a cartoon toddler.
     `masks.get_mask(..., "cheeks")` IS that disc, which is why this tool builds
     its own band instead of reusing it.

  2. Colour. Blush is increased vascularisation, and vascularisation is what the
     a* axis of CIELAB measures. Pushing a* looks like blood under the skin;
     mixing in a fixed pink looks like paint on top of it. L* is never written,
     so pores and fine hair survive untouched.

See docs/RESEARCH-blush-eyes-hair.md.
"""

import cv2
import numpy as np

import common
import local_color
import masks

# Below this face size the cheekbone is a handful of pixels and the band cannot
# be placed meaningfully — matches the gate the other facial tools use.
MIN_FACE_PX = 120

# Retouching practice puts the ceiling at 10-15 points of Red-channel deviation
# from surrounding skin; past that it reads as makeup applied in post. This is
# the a* push at strength 100, chosen to land inside that bound (the verifier
# in _verify_new_tools.py measures the actual R delta).
MAX_DA = 9.0


def process(image_b64: str, params: dict):
    """HTTP wrapper. Internal chaining must use apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def _cheek_band(rgb, faces, size: float, notes: dict) -> np.ndarray:
    """Soft band over each cheekbone, oriented temple -> mouth corner.

    `notes` collects the per-face size refusals. It is an out-parameter
    because a face dropped in here used to vanish entirely: the caller
    reported `blushApplied: 0` and no reason, which reads as "this face
    needed no blush" rather than "this face was never looked at."
    """
    h, w = rgb.shape[:2]
    m = np.zeros((h, w), np.float32)

    for lm in faces:
        def pt(i):
            return np.array([lm[i].x * w, lm[i].y * h], np.float32)

        fw = float(np.linalg.norm(pt(masks.FACE_RIGHT) - pt(masks.FACE_LEFT)))
        # The SECOND size gate in this file, per face, and it used to drop a
        # face without a word. The outer one in `apply` reads sqrt(total skin),
        # which in a group frame is every face added together and therefore
        # always passes — so a four-face frame sailed through the gate that
        # reports and then died in the one that does not. Silent, and measured:
        # blush applied on the file and nothing at all in the panel.
        if common.source_px(fw) < MIN_FACE_PX:
            notes["faceTooSmall"] = notes.get("faceTooSmall", 0) + 1
            continue
        if fw < MIN_FACE_PX:
            notes["previewTooSmall"] = notes.get("previewTooSmall", 0) + 1
            continue

        for temple_i, cheek_i, mouth_i in (
            (masks.FACE_LEFT, masks.LEFT_CHEEK_CENTER, masks.MOUTH_CORNERS[0]),
            (masks.FACE_RIGHT, masks.RIGHT_CHEEK_CENTER, masks.MOUTH_CORNERS[1]),
        ):
            temple, cheek, mouth = pt(temple_i), pt(cheek_i), pt(mouth_i)
            axis = mouth - temple
            length = float(np.linalg.norm(axis))
            if length < 4:
                continue
            angle = float(np.degrees(np.arctan2(axis[1], axis[0])))

            # sit the band ON the bone: a third of the way from the cheek
            # landmark back toward the temple, which is where the zygomatic
            # arch actually is
            centre = cheek + (temple - cheek) * 0.28
            major = max(3, int(length * 0.34 * size))
            minor = max(2, int(length * 0.16 * size))
            layer = np.zeros((h, w), np.uint8)
            cv2.ellipse(
                layer, (int(centre[0]), int(centre[1])), (major, minor),
                angle, 0, 360, 255, -1,
            )
            m = np.maximum(m, layer.astype(np.float32) / 255.0)

    # heavy feather — a blush with a detectable edge is not a blush
    return local_color.feather(m, max(3, int(min(h, w) * 0.012)))


def apply(rgb, params: dict):
    """params: { strength: 0..100, size: 0..100, warmth: 0..100 }"""
    strength = common.clamp01(params.get("strength", 45))
    if strength <= 0:
        return rgb, {"blushApplied": 0}

    size = 0.6 + common.clamp01(params.get("size", 50)) * 0.8   # 0.6 .. 1.4
    warmth = common.clamp01(params.get("warmth", 35))

    faces = masks._face_landmarks(rgb)
    if not faces:
        return rgb, {"blushApplied": 0, "noFace": 1}

    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(float(skin.sum())))
    verdict = common.face_verdict(face_d, MIN_FACE_PX)
    if verdict:
        return rgb, {"blushApplied": 0, verdict: 1}

    notes: dict = {}
    band = _cheek_band(rgb, faces, size, notes)
    if not band.any():
        return rgb, {"blushApplied": 0, **notes}

    # never on eyes, brows, lips or nostrils, and never off the face
    features = masks.get_mask(rgb, "face-features")
    region = np.clip(band * skin * (1.0 - features), 0.0, 1.0)
    if float(region.sum()) < 16:
        return rgb, {"blushApplied": 0}

    box = common.region_box(region, int(face_d * 0.15), rgb.shape)
    if box is None:
        return rgb, {"blushApplied": 0}
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1]
    reg = region[y0:y1, x0:x1]

    # Push RELATIVE to the skin this photo actually has. A warm backlit frame
    # and a cool studio frame need different absolute targets to read the same.
    lab = local_color.to_lab(crop)
    base_a, base_b = local_color.local_median_ab(lab, reg)

    d_a = MAX_DA * strength
    # a little b* keeps the flush from going magenta on warm skin; blush that
    # moves a* alone drifts toward pink as it gets stronger
    d_b = MAX_DA * strength * warmth * 0.45

    healed = local_color.push_lab(crop, reg, d_l=0.0, d_a=d_a, d_b=d_b)

    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(healed, 0, 255).astype(np.uint8)

    return out, {
        "blushApplied": 1,
        "faces": len(faces),
        "regionPx": int((reg > 0.35).sum()),
        "deltaA": round(float(d_a), 2),
        "skinA": round(base_a - 128.0, 1),
    }
