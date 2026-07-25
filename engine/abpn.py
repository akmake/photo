"""Learned skin retouching (DAMO ABPN U-Net, Apache 2.0).

Why a trained model instead of the hand-written detector: every hand-coded rule
we added closed one failure and opened another — reject elongated shapes and
red streaks are missed; add a red detector and the smile line gets flagged;
weight lightness down to spare creases and white marks become invisible. What
we were really trying to encode is a retoucher's JUDGEMENT about what to remove
and what to keep, and that is learned from examples, not written as rules.

This model was trained on retoucher before/after pairs for exactly this task:
evening skin tone, removing blemishes, brightening.

It is wrapped, not trusted blindly:
  * it only ever runs on the face region;
  * its output is blended by `strength`, never accepted wholesale;
  * the low-frequency colour field is taken from the ORIGINAL, so the model
    cannot shift the subject's natural colouring (same structural guarantee as
    our own tool — see test_blush.py);
  * eyes, brows, lips and nostrils are restored from the original.
"""

import os
import threading

import cv2
import numpy as np

import common
import masks

WEIGHTS = os.path.join(os.path.dirname(__file__), "models", "pytorch_model.pt")
TILE = 512  # the resolution the network was trained at
MIN_FACE_PX = 100  # the model's documented lower bound

_lock = threading.Lock()
_net = None


def available() -> bool:
    return os.path.exists(WEIGHTS)


def _net_instance():
    global _net
    with _lock:
        if _net is None:
            import torch  # imported lazily: the engine still runs without it

            import abpn_net

            torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))
            _net = abpn_net.load(WEIGHTS, "cpu")
    return _net


def _infer(crop_rgb: np.ndarray, degree: float) -> np.ndarray:
    """Run the network on one face crop. Returns a float32 RGB image 0..255.

    The network does NOT output an image — it outputs a BLEND LAYER (`mg`),
    where 0.5 is neutral. The published pipeline then combines it with the
    source using a soft-light style curve. Treating the raw output as an image
    produces a blurred, artefacted mess (which is exactly what happened before
    reading Alibaba's own wrapper).
    """
    import torch
    import torch.nn.functional as F

    h, w = crop_rgb.shape[:2]
    # the model expects input normalised to [-1, 1]
    x01 = crop_rgb.astype(np.float32) / 255.0
    x = torch.from_numpy(x01 * 2.0 - 1.0).permute(2, 0, 1)[None]

    with torch.no_grad():
        small = F.interpolate(x, (TILE, TILE), mode="bilinear", align_corners=False)
        mg = _net_instance()(small)
        mg = ((mg - 0.5) * degree + 0.5).clamp(0.0, 1.0)
        mg = F.interpolate(mg, (h, w), mode="bilinear", align_corners=False)

    m = mg[0].permute(1, 2, 0).numpy()
    # published blend: mg == 0.5 is identity, >0.5 lifts, <0.5 deepens
    pred = (1.0 - 2.0 * m) * x01 * x01 + 2.0 * m * x01
    return np.clip(pred, 0.0, 1.0) * 255.0


def process(image_b64: str, params: dict):
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta


def apply(rgb, params: dict):
    """params: { strength: 0..100 }"""
    strength = common.clamp01(params.get("strength", 70))
    if strength <= 0:
        return rgb, {"model": "abpn", "applied": 0}
    if not available():
        return rgb, {"model": "abpn", "error": "weights missing"}

    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    if face_d < MIN_FACE_PX:
        return rgb, {"model": "abpn", "faceTooSmall": 1}

    box = common.region_box(skin, int(face_d * 0.45), rgb.shape)
    if box is None:
        return rgb, {"model": "abpn", "applied": 0}
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1]

    # `degree` is the model's own intensity control (its default is 0.7)
    retouched = _infer(crop, degree=0.4 + strength * 0.6)
    orig = crop.astype(np.float32)

    # --- guardrails ---------------------------------------------------------
    # 1) keep the ORIGINAL low-frequency colour field. The model may retouch
    #    texture and blemishes; it may not restate the subject's colouring.
    r_low = max(5, int(face_d * 0.12)) | 1
    orig_low = cv2.GaussianBlur(orig, (r_low, r_low), 0)
    ret_low = cv2.GaussianBlur(retouched, (r_low, r_low), 0)
    retouched = retouched - ret_low + orig_low

    # 2) restrict to skin, and restore real features from the original
    region = np.clip(
        skin[y0:y1, x0:x1] - masks.get_mask(rgb, "face-features")[y0:y1, x0:x1],
        0.0,
        1.0,
    )
    fr = max(3, int(face_d * 0.04)) | 1
    region = cv2.GaussianBlur(region, (fr, fr), 0)

    a = (strength * region)[..., None]
    blended = orig * (1 - a) + retouched * a

    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(blended, 0, 255).astype(np.uint8)
    return out, {
        "model": "abpn",
        "faceDiameter": int(face_d),
        "strength": round(strength, 2),
    }
