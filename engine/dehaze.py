"""Haze removal driven by DEPTH, not by the dark-channel prior.

The textbook method (He et al.) reads haze density off the dark channel: in a
haze-free patch at least one colour channel is nearly black, so wherever none
is, airlight filled it in. It was built and measured here first, and it fails
on exactly this niche. Measured against synthetic haze with known ground truth:
the far half recovered 90%, but the NEAR half got 138-273% worse, because a
large bright surface — a white dress, a grey horse — has no dark channel and is
read as dense haze. Every frame in this catalogue has one.

Depth settles it. Haze is a function of distance and nothing else, so the
transmission comes from the depth map that already ships for background blur:

    t = exp(-beta * distance)

Distance is measured from the SUBJECT'S PLANE, not from the camera. MiDaS
normalises each frame to its own nearest point, so anchoring to the frame would
leave a subject who is not the closest object sitting at mid-distance and being
corrected: measured at 69.5 levels of change on one of the two test frames.
Anchored to the subject's own median depth, everything at or in front of that
plane has t = 1 and is untouched, whatever colour it happens to be, and only
what is genuinely behind the subject is un-veiled. Airlight is read from the far
field, where it actually is.

The cost of this choice is that it cannot run in the browser — it is a
`kind: 'ai'` tool, like background blur, and there is no JS mirror.
"""

import cv2
import numpy as np

import common
import depth as depth_mod
import masks

# beta: how fast haze accumulates with distance. At 0.3 only the far horizon is
# touched; at 2.5 the whole far field is cleared.
BETA_MIN, BETA_MAX = 0.3, 2.5
# how far the densest haze may be pushed before it turns to noise
TMIN_MAX, TMIN_MIN = 0.30, 0.06
# the far field, for reading the airlight off
FAR_DIST = 0.65
PROC_MAX = 1024  # depth carries no fine detail; estimate small and scale up


def _p(params, key, default=0.0):
    try:
        return float(params.get(key, default)) / 100.0
    except (TypeError, ValueError):
        return default / 100.0


def _airlight(img, dist):
    """The colour of the haze, read off the brightest pixels of the far field."""
    far = dist > FAR_DIST
    if far.sum() < 64:
        far = dist > np.percentile(dist, 90)
    lum = img[..., 0] * 0.2126 + img[..., 1] * 0.7152 + img[..., 2] * 0.0722
    vals = lum[far]
    if vals.size < 8:
        return np.array([0.85, 0.87, 0.9], np.float32), 0
    cut = float(np.percentile(vals, 99.0))
    sel = far & (lum >= cut)
    if sel.sum() < 8:
        sel = far
    a = img[sel].reshape(-1, 3).mean(axis=0)
    return np.clip(a, 0.35, 1.0).astype(np.float32), int(sel.sum())


def apply(rgb, params: dict):
    amount = _p(params, "amount")
    if amount == 0:
        return rgb, {"applied": 0}

    img = rgb.astype(np.float32) / 255.0
    small = common.downscale(rgb, PROC_MAX) if max(rgb.shape[:2]) > PROC_MAX else rgb
    inv = common.upscale_to(depth_mod.get_depth(small), rgb.shape)

    # anchor: the subject's own plane is distance zero, so it is never touched
    subject = masks.get_mask(rgb, "subject") > 0.5
    if subject.sum() > inv.size * 0.01:
        ref = float(np.median(inv[subject]))
        anchored = 1
    else:
        ref, anchored = 1.0, 0
    dist = np.clip((ref - inv) / max(ref, 0.15), 0.0, 1.0).astype(np.float32)

    A, n_air = _airlight(img, dist)

    beta = BETA_MIN + (BETA_MAX - BETA_MIN) * _p(params, "depth", 50)
    t = np.exp(-beta * dist).astype(np.float32)
    t = np.maximum(t, TMIN_MAX - (TMIN_MAX - TMIN_MIN) * _p(params, "floor", 50))
    tt = t[..., None]

    if amount > 0:
        target = (img - A) / tt + A          # divide the veil out
    else:
        # the same model run forwards puts it back — atmosphere is a look
        target = img * tt + A * (1.0 - tt)

    out = np.clip(img + (target - img) * abs(amount), 0.0, 1.0) * 255.0
    return out.astype(np.uint8), {
        "airlight": [round(float(v), 3) for v in A],
        "airlightPx": n_air,
        "subjectAnchored": anchored,
        "meanTransmission": round(float(t.mean()), 3),
        "nearUntouched": round(float((t > 0.97).mean()), 4),
    }


def process(image_b64: str, params: dict):
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta
