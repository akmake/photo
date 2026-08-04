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

WEIGHTS = os.path.join(os.path.dirname(__file__), "models", "abpn_unet.onnx")
# The PyTorch checkpoint this was exported from. Kept only so the parity
# harness and a re-export can find it; the engine never loads it.
TORCH_WEIGHTS = os.path.join(os.path.dirname(__file__), "models", "pytorch_model.pt")
TILE = 512  # the resolution the network was trained at
MIN_FACE_PX = 100  # the model's documented lower bound

_lock = threading.Lock()
_session = None


def available() -> bool:
    return os.path.exists(WEIGHTS)


def _session_instance():
    """The exported UNet, on onnxruntime.

    This used to be a torch module. torch cost ~2-3GB installed on Windows to
    press play on a 51MB graph, and onnxruntime was already in the process for
    BiRefNet and MiDaS. The export is gated by test_onnx_parity.py, which
    replays the exact tensors the torch net saw: measured worst deltas were
    4.1e-06 at the network and 1/255 on the finished image, with no pixel
    moving more than one level. See export_onnx.py.
    """
    global _session
    with _lock:
        if _session is None:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            # Same budget the torch path used. The engine already serialises
            # image work onto one worker thread (server.py), so taking every
            # core here would only fight the rest of the pipeline.
            opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) // 2)
            _session = ort.InferenceSession(
                WEIGHTS, opts, providers=["CPUExecutionProvider"]
            )
    return _session


def _infer(crop_rgb: np.ndarray, degree: float) -> np.ndarray:
    """Run the network on one face crop. Returns a float32 RGB image 0..255.

    The network does NOT output an image — it outputs a BLEND LAYER (`mg`),
    where 0.5 is neutral. The published pipeline then combines it with the
    source using a soft-light style curve. Treating the raw output as an image
    produces a blurred, artefacted mess (which is exactly what happened before
    reading Alibaba's own wrapper).

    The two resizes were `F.interpolate(..., align_corners=False)` and are now
    `cv2.INTER_LINEAR`, which is the same half-pixel-centre convention — near
    equal, not bit-equal. That substitution is inside what the tool-level gate
    in test_onnx_parity.py measures, which is the reason the gate re-runs
    apply() end to end instead of stopping at the network.
    """
    h, w = crop_rgb.shape[:2]
    # the model expects input normalised to [-1, 1]
    x01 = crop_rgb.astype(np.float32) / 255.0
    x = x01 * 2.0 - 1.0

    small = cv2.resize(x, (TILE, TILE), interpolation=cv2.INTER_LINEAR)
    small = np.ascontiguousarray(small.transpose(2, 0, 1)[None])

    sess = _session_instance()
    mg = sess.run(None, {sess.get_inputs()[0].name: small})[0]
    mg = np.clip((mg - 0.5) * degree + 0.5, 0.0, 1.0)

    m = cv2.resize(mg[0].transpose(1, 2, 0), (w, h), interpolation=cv2.INTER_LINEAR)
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

    # sqrt(total skin) reads a group as one giant face, and the low-frequency
    # colour guard (0.12·face_d) then spans a third of each small face —
    # the same scale bug cleanup had. Each face runs at its own scale.
    boxes = masks.face_boxes(rgb)
    if len(boxes) >= 2:
        out = rgb.copy()
        applied = 0
        for x0, y0, x1, y1 in boxes:
            sub, m = _apply_one(out[y0:y1, x0:x1], strength)
            out[y0:y1, x0:x1] = sub
            applied += int("faceDiameter" in m)
        return out, {"model": "abpn", "faces": len(boxes), "applied": applied}

    return _apply_one(rgb, strength)


def _apply_one(rgb, strength: float):
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

    # 2) NO OVERSHOOT. The model may move a blemish TOWARD the surrounding
    #    skin; it may not sail past it and come out the other side.
    #
    #    Measured on real acne (a teen, 54 located pimples): the model turned
    #    26 of them into pale yellow-green spots — a dark red mark became a
    #    light one, and the absolute contrast against neighbouring skin went
    #    UP, 22.1 -> 24.1. The flaw was more visible after retouching than
    #    before, which is worse than doing nothing. The photographer had been
    #    seeing exactly these spots in her own work.
    #
    #    Written as a monotone constraint on the deviation from local skin:
    #    the retouched deviation must keep the ORIGINAL's sign and must not
    #    exceed its magnitude. Healing is allowed all the way to zero (a mark
    #    fully gone); inversion and amplification are not expressible.
    dev_o = orig - orig_low
    dev_r = retouched - orig_low
    same_side = np.sign(dev_r) == np.sign(dev_o)
    dev_r = np.where(same_side, dev_r, 0.0)
    dev_r = np.clip(np.abs(dev_r), 0.0, np.abs(dev_o)) * np.sign(dev_o)
    retouched = orig_low + dev_r

    # 3) restrict to skin, and restore real features from the original
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
