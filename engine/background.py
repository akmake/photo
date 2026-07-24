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


def _refine_edges(rgb: np.ndarray, mask: np.ndarray, feather: float) -> np.ndarray:
    """Snap the mask to real image edges so hair doesn't look cut out."""
    h, w = rgb.shape[:2]
    guide_r = max(4, int(0.012 * max(h, w)))
    m8 = (np.clip(mask, 0, 1) * 255).astype(np.uint8)
    if hasattr(cv2, "ximgproc"):
        try:
            refined = cv2.ximgproc.guidedFilter(rgb, m8, guide_r, 500.0)
            m = refined.astype(np.float32) / 255.0
        except cv2.error:
            m = mask
    else:
        m = mask
    fr = max(1, int(feather * 0.010 * max(h, w))) | 1
    return np.clip(cv2.GaussianBlur(m, (fr, fr), 0), 0.0, 1.0)


def process(image_b64: str, params: dict):
    """params: { amount: 0..100, feather: 0..100, bokeh: 0..100 }"""
    img = common.b64_to_image(image_b64)
    rgb = common.to_np(img)
    amount = common.clamp01(params.get("amount", 60))
    feather = common.clamp01(params.get("feather", 40))
    bloom = common.clamp01(params.get("bokeh", 50))

    if amount <= 0:
        return common.image_to_b64(img), {"subjectCoverage": 0.0}

    h, w = rgb.shape[:2]
    mask = masks.get_mask(rgb, "subject")
    soft = _refine_edges(rgb, mask, feather)
    rgb_f = rgb.astype(np.float32)

    # --- depth-of-field: blur grows with distance from the subject's plane ---
    d = depth_mod.get_depth(rgb)  # 1 = closest
    inside = d[mask > 0.5]
    subject_plane = float(np.median(inside)) if inside.size else float(np.median(d))

    # distance from the subject's plane, in BOTH directions (a real lens also
    # blurs what is closer than the subject — e.g. the rocks in the foreground)
    dist = np.abs(d - subject_plane)
    hi = float(np.percentile(dist, 98)) or 1.0
    dof = np.clip(dist / max(hi, 1e-6), 0.0, 1.0)

    # the subject itself always stays perfectly sharp
    dof = dof * (1.0 - soft)

    radius = max(2, int(amount * 0.035 * max(h, w)))
    t = dof * BLUR_LEVELS

    out = rgb_f.copy()
    for i in range(1, BLUR_LEVELS + 1):
        layer = _bokeh(rgb_f, max(1, int(radius * i / BLUR_LEVELS)), bloom)
        wgt = np.clip(t - (i - 1), 0.0, 1.0)[..., None]
        out = out * (1.0 - wgt) + layer * wgt

    return common.image_to_b64(common.to_pil(out)), {
        "subjectCoverage": round(float(mask.mean()), 4),
        "subjectPlane": round(subject_plane, 3),
    }
