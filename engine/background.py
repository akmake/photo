"""Background blur / bokeh — AI tool.

mask = subject (MediaPipe multiclass segmenter), operation = blur the inverse.

Two things separate this from a naive "cut out and gaussian blur":
  1. edge refinement — the binary mask is refined against the image with a
     guided filter, so hair stops looking pasted.
  2. bokeh character — highlights are boosted before a DISC-shaped convolution,
     so bright points bloom into round bokeh discs like a real lens, instead of
     being smeared by a gaussian.

Still missing (see docs/ARCHITECTURE.md): a depth map, so blur can grow with
distance instead of being uniform behind the subject.
"""

import cv2
import numpy as np

import common
import depth as depth_mod
import masks

# how many discrete blur levels the depth gradient is composited from
BLUR_LEVELS = 4


def _disc_kernel(radius: int) -> np.ndarray:
    y, x = np.ogrid[-radius : radius + 1, -radius : radius + 1]
    k = ((x * x + y * y) <= radius * radius).astype(np.float32)
    return k / k.sum()


def _bokeh(rgb_f: np.ndarray, radius: int, bloom: float) -> np.ndarray:
    """Disc-kernel blur with highlight bloom — lens-like, not gaussian mush."""
    # a true disc kernel is expensive; run it at reduced scale for big radii
    scale = 0.4 if radius > 14 else 1.0
    src = (
        cv2.resize(rgb_f, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        if scale != 1.0
        else rgb_f
    )
    r = max(1, int(radius * scale))

    # push bright pixels up so they bloom into discs when convolved
    lum = src @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    thresh = 170.0
    w = np.clip((lum - thresh) / (255.0 - thresh), 0.0, 1.0)[..., None]
    boosted = src * (1.0 + bloom * w * 2.5)

    out = cv2.filter2D(boosted, -1, _disc_kernel(r))

    if scale != 1.0:
        out = cv2.resize(
            out, (rgb_f.shape[1], rgb_f.shape[0]), interpolation=cv2.INTER_LINEAR
        )
    return np.clip(out, 0, 255)


def _feather(mask: np.ndarray, amount: float, max_dim: int) -> np.ndarray:
    """Light optional softening. The alpha already comes edge-refined from the
    matting tool, so this is a taste control, not a fix."""
    if amount <= 0:
        return mask
    fr = max(1, int(amount * 0.004 * max_dim)) | 1
    return np.clip(cv2.GaussianBlur(mask, (fr, fr), 0), 0.0, 1.0)


def process(image_b64: str, params: dict):
    """HTTP wrapper — internal chaining uses apply()."""
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def apply(rgb, params: dict):
    """params: { amount: 0..100, feather: 0..100, bokeh: 0..100 }"""
    amount = common.clamp01(params.get("amount", 60))
    feather = common.clamp01(params.get("feather", 40))
    bloom = common.clamp01(params.get("bokeh", 50))

    if amount <= 0:
        return rgb, {"subjectCoverage": 0.0}

    h, w = rgb.shape[:2]
    mask = masks.get_mask(rgb, "subject")  # soft alpha from the matting tool
    soft = _feather(mask, feather, max(h, w))

    # The blurred layers are low-frequency by definition, so they are built at
    # the working resolution and scaled back up. Only the final composite runs
    # at full resolution, which is what keeps the SUBJECT perfectly sharp.
    small = common.downscale(rgb)
    sc = small.shape[1] / w
    rgb_f = small.astype(np.float32)

    # --- depth-of-field: blur grows with distance from the subject's plane ---
    d = depth_mod.get_depth(small)  # 1 = closest
    mask_s = common.downscale(mask)
    soft_s = common.downscale(soft)
    inside = d[mask_s > 0.5]
    subject_plane = float(np.median(inside)) if inside.size else float(np.median(d))

    # distance from the subject's plane, in BOTH directions (a real lens also
    # blurs what is closer than the subject — e.g. the rocks in the foreground)
    dist = np.abs(d - subject_plane)
    hi = float(np.percentile(dist, 98)) or 1.0
    dof = np.clip(dist / max(hi, 1e-6), 0.0, 1.0)

    # the subject itself always stays perfectly sharp
    dof = dof * (1.0 - soft_s)

    radius = max(2, int(amount * 0.035 * max(small.shape[:2])))
    t = dof * BLUR_LEVELS

    blurred = rgb_f.copy()
    for i in range(1, BLUR_LEVELS + 1):
        layer = _bokeh(rgb_f, max(1, int(radius * i / BLUR_LEVELS)), bloom)
        wgt = np.clip(t - (i - 1), 0.0, 1.0)[..., None]
        blurred = blurred * (1.0 - wgt) + layer * wgt

    # composite at FULL resolution: sharp original where the subject is,
    # upscaled blur elsewhere
    blurred_full = common.upscale_to(blurred, rgb.shape)
    m3 = soft[..., None]
    out = rgb.astype(np.float32) * m3 + blurred_full * (1.0 - m3)

    return np.clip(out, 0, 255).astype(np.uint8), {
        "subjectCoverage": round(float(mask.mean()), 4),
        "subjectPlane": round(subject_plane, 3),
    }
