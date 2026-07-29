"""Skin smoothing — AI tool.

mask      = face-skin (MediaPipe semantic segmentation) minus eyes
operation = FREQUENCY SEPARATION, the technique retouchers actually use.

The image is split into a low-frequency layer (skin *tone* — blotchiness,
uneven colour, shadow mottling) and a high-frequency layer (skin *texture* —
pores, fine hairs). Only the LOW layer is smoothed; the high layer is put back
untouched. The result is even skin that still has real texture.

This replaced two earlier, worse versions:
  1. a YCbCr colour-threshold mask that caught any skin-coloured pixel in the
     frame (walls, hair, autumn leaves) and smeared the whole image;
  2. a plain bilateral filter, which evens the tone but also erases pores and
     leaves the plastic "beauty app" look.

The separation has two settings that were hardcoded for a long time, and they
are the two questions a retoucher actually asks. `scale` is where the line
between tone and texture is drawn — small, and only fine mottling counts as
tone; large, and whole shadow blotches do. `evenness` is how hard the tone side
is then flattened. They are independent: evening a small scale hard is a
different edit from evening a large scale gently, and neither is "strength".

`body` applies the same operation to the neck, arms and hands, which used to
receive nothing at all — an evened face above untouched blotchy skin is the
tell of a cheap retouch.
"""

import cv2
import numpy as np

import common
import masks

# Below this face width (px) there is no skin texture to separate — only
# features, which smoothing would destroy.
MIN_FACE_PX = 120

# The frequency split: what counts as texture rather than tone. Fixed, because
# it is a property of skin at a given face size, not a taste.
SPLIT_BASE = 0.045

# Both ranges were measured on a 480px face, not chosen:
#
#   sigmaColor is the knob that matters. At the shipping window it takes the
#   blotch band from 87% to 72% as it doubles, and keeps paying up to 180
#   (36%) while the lighting shape only falls to 95.8%. Past 180 it buys 5
#   points and starts flattening the shape. So 100 maps to 180 — and the curve
#   is squared so that 50 lands exactly on the historical 45.
SIGMA_COLOR_MAX = 180.0
#   The window saturates at twice the historical face_d/10: d=96 reaches 57.9%,
#   d=192 reaches 55.0% for twelve times the time (6s vs 0.5s on a 20MP frame).
#   So `scale` spans 0..2x and stops there.
WINDOW_BASE = 0.1
SIGMA_SPACE_BASE = 45.0


def _p(params, key, default):
    """0..100 slider -> 0..1, with the tool's own default on a bad value."""
    return common.clamp01(params.get(key, default), default / 100.0)


def process(image_b64: str, params: dict):
    """HTTP wrapper. Internal chaining must use apply() — serialising a 20MP
    frame to PNG between every tool costs more than the tools themselves."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def _smooth_region(rgb, region, face_d, strength, evenness, scale, texture):
    """Frequency-separate and re-blend inside `region`. Returns a new frame."""
    # Work on the region only, at FULL resolution. A bilateral filter over a
    # 20MP frame to retouch a 350px face is almost entirely wasted work.
    box = common.region_box(region, int(face_d * 0.3), rgb.shape)
    if box is None:
        return rgb
    x0, y0, x1, y1 = box

    src = rgb[y0:y1, x0:x1].astype(np.float32)
    reg = region[y0:y1, x0:x1]

    # --- frequency separation ------------------------------------------------
    # the split radius scales with the face, so the tool behaves the same at any
    # resolution
    split = max(3, int(face_d * SPLIT_BASE)) | 1
    low = cv2.GaussianBlur(src, (split, split), 0)
    high = src - low  # pores and fine detail live here

    # Smooth ONLY the tone layer. Bilateral keeps the big transitions
    # (nose shadow, jawline) while flattening blotchiness. `scale` sets how
    # wide an area of uneven tone gets pulled together; `evenness` sets how
    # different two tones may be and still count as the same skin.
    sigma_color = SIGMA_COLOR_MAX * evenness * evenness
    if sigma_color > 0:
        reach = scale / 0.5
        d = max(5, int(face_d * WINDOW_BASE * reach))
        low = cv2.bilateralFilter(low, d, sigma_color, SIGMA_SPACE_BASE * reach)

    # texture goes back on top. At 100 it returns whole, which is what keeps
    # skin real; lowering it is how you ask for less pore, deliberately.
    retouched = low + high * texture

    a = (strength * reg)[..., None]
    blended = src * (1.0 - a) + retouched * a

    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(blended, 0, 255).astype(np.uint8)
    return out


def apply(rgb, params: dict):
    """params: { strength, evenness, scale, texture, body } — all 0..100"""
    strength = _p(params, "strength", 60)
    body = _p(params, "body", 0)
    if strength <= 0 and body <= 0:
        return rgb, {"skinCoverage": 0.0}

    # A group is N faces, not one big one: sqrt(total skin) put the bilateral
    # window ~2.4x too wide on a five-child frame and ate texture past the 95%
    # budget (measured 89-93% on 321A5078). Faces smooth per crop at their own
    # scale; body skin (neck, hands — outside the crops) keeps the global pass.
    boxes = masks.face_boxes(rgb)
    if len(boxes) >= 2:
        h, w = rgb.shape[:2]
        out = rgb.copy()
        cov = 0.0
        for x0, y0, x1, y1 in boxes:
            sub, m = _apply_one(out[y0:y1, x0:x1], {**params, "body": 0})
            out[y0:y1, x0:x1] = sub
            cov += float(m.get("skinCoverage", 0.0)) * (x1 - x0) * (y1 - y0)
        meta = {"skinCoverage": round(cov / (h * w), 4), "faces": len(boxes)}
        if body > 0:
            out, mb = _apply_one(out, {**params, "strength": 0})
            meta["bodyCoverage"] = mb.get("bodyCoverage", 0.0)
        return out, meta

    return _apply_one(rgb, params)


def _apply_one(rgb, params: dict):
    """The single-face pipeline: split radius and window read off THIS face."""
    strength = _p(params, "strength", 60)
    body = _p(params, "body", 0)
    if strength <= 0 and body <= 0:
        return rgb, {"skinCoverage": 0.0}

    skin_mask = masks.get_mask(rgb, "face-skin")
    skin_px = float(skin_mask.sum())
    face_d = float(np.sqrt(skin_px))  # ~face diameter in px
    if face_d < MIN_FACE_PX:
        # No face means no scale reference — the split radius and the bilateral
        # window are both read off the face. Body skin is not smoothed alone.
        return rgb, {"skinCoverage": 0.0, "faceTooSmall": 1}

    evenness = _p(params, "evenness", 50)
    scale = _p(params, "scale", 50)
    texture = _p(params, "texture", 100)
    # feather so smoothing fades out instead of ending on a hard edge
    fr = max(3, int(face_d * 0.05)) | 1

    out = rgb
    meta = {"skinCoverage": round(float((skin_mask > 0.5).mean()), 4)}

    if strength > 0:
        # keep every real feature perfectly sharp — eyes, brows, lips, nostrils
        features = masks.get_mask(rgb, "face-features")
        region = np.clip(skin_mask - features, 0.0, 1.0)
        region = cv2.GaussianBlur(region, (fr, fr), 0)
        out = _smooth_region(out, region, face_d, strength, evenness, scale, texture)

    if body > 0:
        # the segmenter's face/body line wanders along the jaw; subtracting the
        # face keeps a band there from being smoothed twice at double strength
        body_mask = np.clip(
            masks.get_mask(rgb, "body-skin") - skin_mask, 0.0, 1.0
        )
        meta["bodyCoverage"] = round(float((body_mask > 0.5).mean()), 4)
        if body_mask.max() > 0.5:
            body_mask = cv2.GaussianBlur(body_mask, (fr, fr), 0)
            out = _smooth_region(out, body_mask, face_d, body, evenness, scale, texture)

    return out, meta
