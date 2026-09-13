"""החלקת עור — skin retouching in the order a retoucher works.

One tool, one slider per stage, per face, at the photograph's own resolution.
A slider at 0 switches its stage off, so a photographer climbs from cleaning
to a soft glowing finish one stage at a time:

  1. BLEMISHES — a trained detector finds what a retoucher would remove
     (pimples, spots, milia) and a trained inpainting network rebuilds skin
     there. Removal, not blur: a pimple that is only faded reads as a stain.
  2. EVENNESS — a trained network predicts a soft-light blend layer that evens
     tone across the face (redness, blotches) while the pores stay where they
     are.
  3. TEXTURE SOFTENING — the pore band is attenuated in lightness only. The
     finest grain above it is kept whole, which is what separates soft skin
     from the plastic look of removing all fine detail.
  4. GLOW — a lightness lift on the skin's own lit side, shrinking toward
     white so it never clips.

Stages 3 and 4 are off by default. The micro dodge-and-burn stage a retoucher
does between 2 and 3 is not here: no free model does it (RESEARCH-skin-smoothing).

Removal runs FIRST, and that order is the point. The evening layer on its own
(`abpn.py`, the retired `face-retouch`) was measured turning 26 of 54 pimples
into pale spots (docs/TOOLS-STATUS.md): asked to even a mark that was still
there, it overshot it. Here the evening layer is predicted from the frame the
marks have already been taken out of.

Models — DAMO `cv_unet_skin_retouching_torch` (ModelScope, Apache 2.0):
  · detection + inpainting: `abpn_local.py` (parity with upstream,
    test_abpn_local_reference.py)
  · evening: `abpn_unet.onnx` (parity with the torch net, test_onnx_parity.py)

The glue between them reproduces ModelScope's own pipeline — `retouch_local`,
`predict_roi` and utils.py — and test_skin_retouch.py checks it against the
installed original rather than against a copy of it.

Deliberately NOT taken from that pipeline:
  · WHITENING. It is on by default there and lightens every skin pixel. A
    photographer asked for even skin, not for a paler client.
  · RetinaFace. Faces come from `masks._face_landmarks`, which every other face
    tool here already uses, framed to match what the networks were fed: the
    upstream square crop measured 1.72x the landmark outline (1.66-1.80 on
    nine faces over six photographs), centred 0.08 face-widths higher.
  · the evening layer over the WHOLE crop. Measured, it is nearly silent off
    skin (mean |mg-0.5| 0.0003-0.003) but not on eyes, brows and lips (up to
    0.026 on a closed-eye face), so it is confined to skin and features are
    left exactly as they were.
"""

from __future__ import annotations

import hashlib
import os
import threading
from collections import OrderedDict

import cv2
import numpy as np
import torch
import torch.nn.functional as F

import abpn
import abpn_local
import common
import masks

# The networks' documented lower bound, the same one `face-retouch` used.
MIN_FACE_PX = abpn.MIN_FACE_PX

JOINT_WEIGHTS = os.path.join(os.path.dirname(__file__), "models", "joint_20210926.pth")

# Framing — measured against upstream RetinaFace crops, see module docstring.
CROP_SIDE_PER_OVAL = 1.72
CROP_LIFT_PER_FW = 0.08

# Upstream constants (skin_retouching_pipeline.py / utils.py). Not tuning.
DETECT_SIZE = 768
EVEN_SIZE = 512
PATCH = 512
PATCH_PAD = 32
HARD_LOW = 0.35
HARD_HIGH = 0.5
DIFFUSE_SIZE = 500
DIFFUSE_WIDTH = 20

# Slider defaults. Upstream does not agree with itself here: the model card's
# wrapper (models/damo_skin_official/ms_wrapper.py) runs `degree = 0.7` with
# blemish removal OFF, the library pipeline (modelscope/pipelines/cv/
# skin_retouching_pipeline.py) runs `degree = 1.0` with it ON. 70 is the
# gentler of the two until a result says otherwise.
DEFAULT_BLEMISHES = 100
DEFAULT_EVENNESS = 70

_lock = threading.Lock()
_nets = None


def available() -> bool:
    return os.path.exists(JOINT_WEIGHTS) and abpn.available()


def _local_nets():
    global _nets
    with _lock:
        if _nets is None:
            _nets = abpn_local.load(JOINT_WEIGHTS, "cpu")
    return _nets


def diffuse_mask(size: int = DIFFUSE_SIZE, width: int = DIFFUSE_WIDTH) -> np.ndarray:
    """Upstream `gen_diffuse_mask`, vectorised: 1 inside, a linear ramp to 0 over
    the outer `width` of each edge. It fades the evening layer out toward the
    crop border so a face crop never ends on a visible line."""
    i = np.arange(size, dtype=np.float32)
    ramp = np.where(i <= width, i / width,
                    np.where(i > size - width, (size - i) / width, 1.0))
    return np.minimum(ramp[:, None], ramp[None, :]).astype(np.float32)


_DIFFUSE = torch.from_numpy(diffuse_mask())[None, None]


def to_tensor(crop_rgb: np.ndarray) -> torch.Tensor:
    """uint8 HxWx3 -> (1,3,H,W) in [-1,1], upstream `preprocess_roi`."""
    x = torch.from_numpy(np.ascontiguousarray(crop_rgb.transpose(2, 0, 1)))[None]
    return (x.float() / 255.0 - 0.5) * 2.0


def removal_weights(prob: np.ndarray) -> np.ndarray:
    """Detector probability -> removal weight, exactly as upstream: nothing below
    0.35, the probability itself between 0.35 and 0.5, full removal above."""
    high = prob >= HARD_HIGH
    low = prob >= HARD_LOW
    return np.where(high, 1.0, prob * low).astype(np.float32)


@torch.inference_mode()
def detect(x: torch.Tensor) -> np.ndarray:
    """Blemish probability at the crop's own size."""
    det, _ = _local_nets()
    h, w = x.shape[2:]
    small = F.interpolate(x, size=(DETECT_SIZE, DETECT_SIZE), mode="bilinear",
                          align_corners=True)
    p = torch.sigmoid(det(small))
    return F.interpolate(p, size=(h, w), mode="nearest")[0, 0].numpy()


@torch.inference_mode()
def inpaint(x: torch.Tensor, removal: np.ndarray) -> torch.Tensor:
    """Rebuild skin where `removal` > 0, upstream `retouch_local` minus its own
    detection. Works in 512 tiles with a 32px overlap, at full resolution.

    A tile whose core has nothing to remove is skipped: there the upstream
    composite is `image * 1 + 0 * output`, i.e. the input exactly, so skipping
    it changes no value and saves most of the work on a clean face.
    """
    _, net = _local_nets()
    h, w = removal.shape
    H = -(-h // PATCH) * PATCH
    W = -(-w // PATCH) * PATCH
    # Upstream pads image AND mask with zeros, first to a multiple of the tile
    # and then by the overlap. A zero in the mask means "rebuild", so the pad is
    # context the network sees; it is reproduced rather than "fixed".
    pad = (PATCH_PAD, W - w + PATCH_PAD, PATCH_PAD, H - h + PATCH_PAD)
    img = F.pad(x, pad)
    keep = F.pad(torch.from_numpy(1.0 - removal)[None, None], pad)

    out = x.clone()
    for ty in range(H // PATCH):
        for tx in range(W // PATCH):
            y0, x0 = ty * PATCH, tx * PATCH
            if not (removal[y0:y0 + PATCH, x0:x0 + PATCH] > 0).any():
                continue
            win = (slice(None), slice(None),
                   slice(y0, y0 + PATCH + 2 * PATCH_PAD),
                   slice(x0, x0 + PATCH + 2 * PATCH_PAD))
            k = keep[win]
            masked = img[win] * k
            comp = masked + (1.0 - k) * net(masked, k)
            core = comp[:, :, PATCH_PAD:-PATCH_PAD, PATCH_PAD:-PATCH_PAD]
            yh, xw = min(PATCH, h - y0), min(PATCH, w - x0)
            out[:, :, y0:y0 + yh, x0:x0 + xw] = core[:, :, :yh, :xw]
    return out


def evening_layer(x: torch.Tensor) -> np.ndarray:
    """The raw blend layer at the network's 512 — (3,512,512), 0.5 = neutral.

    The SIGMOID is applied here because the exported graph does not contain it.
    Upstream's `UNet.forward` ends in `self.sigmoid(x0)`; `abpn_net.UNet` was
    rebuilt from the checkpoint's weight shapes, and a sigmoid has no weights,
    so `load_state_dict(strict=True)` passed and the export inherited the gap.
    test_onnx_parity.py compared the export against that same rebuilt net, so it
    could not see it either. Measured on the acne face: the graph's output runs
    -0.84..3.04 around 0, sigmoid of it matches upstream to 1e-6. Fed raw, as
    abpn.py does, the layer at degree 0.7 sits 0.353 from neutral on average
    against 0.006 — see docs/BUGS.md.
    """
    small = F.interpolate(x, (EVEN_SIZE, EVEN_SIZE), mode="bilinear")
    sess = abpn._session_instance()
    logits = sess.run(None, {sess.get_inputs()[0].name: small.numpy().astype(np.float32)})[0]
    return (1.0 / (1.0 + np.exp(-logits[0].astype(np.float64)))).astype(np.float32)


def apply_layer(img01: np.ndarray, mg512: np.ndarray, degree: float,
                allow: np.ndarray | None = None) -> np.ndarray:
    """Upstream `predict_roi` after the network: degree, upsample, border fade,
    soft-light blend. `allow` (HxW, 0..1) confines the layer — ours, not upstream."""
    h, w = img01.shape[:2]
    mg = ((torch.from_numpy(mg512)[None] - 0.5) * degree + 0.5).clamp(0.0, 1.0)
    mg = F.interpolate(mg, (h, w), mode="bilinear")
    fade = F.interpolate(_DIFFUSE, (h, w), mode="bilinear")
    mg = ((mg - 0.5) * fade + 0.5)[0].permute(1, 2, 0).numpy()
    if allow is not None:
        mg = 0.5 + (mg - 0.5) * allow[..., None]
    return (1.0 - 2.0 * mg) * img01 * img01 + 2.0 * mg * img01


# --- faces -------------------------------------------------------------------


def face_crops(rgb: np.ndarray):
    """[(box, face_width)] — the square crop upstream would have fed, per face."""
    h, w = rgb.shape[:2]
    out = []
    for lm in masks._face_landmarks(rgb):
        oval = np.array([[lm[i].x * w, lm[i].y * h] for i in masks.FACE_OVAL])
        fw = float(np.hypot((lm[masks.FACE_RIGHT].x - lm[masks.FACE_LEFT].x) * w,
                            (lm[masks.FACE_RIGHT].y - lm[masks.FACE_LEFT].y) * h))
        cx = (oval[:, 0].min() + oval[:, 0].max()) / 2.0
        cy = (oval[:, 1].min() + oval[:, 1].max()) / 2.0 - CROP_LIFT_PER_FW * fw
        side = CROP_SIDE_PER_OVAL * max(np.ptp(oval[:, 0]), np.ptp(oval[:, 1]))
        x0, y0 = max(0, int(cx - side / 2)), max(0, int(cy - side / 2))
        x1, y1 = min(w, int(cx + side / 2)), min(h, int(cy + side / 2))
        if x1 - x0 >= 16 and y1 - y0 >= 16:
            out.append(((x0, y0, x1, y1), fw))
    return out


# Network outputs per face crop. Sliders only re-blend, so moving one must not
# run three networks again. Keyed on the pixels, never on the sliders.
_CACHE: "OrderedDict[bytes, dict]" = OrderedDict()
_CACHE_MAX = 8


def _cached(key: bytes, make):
    hit = _CACHE.get(key)
    if hit is not None:
        _CACHE.move_to_end(key)
        return hit
    value = make()
    _CACHE[key] = value
    if len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return value


# --- moles and freckles --------------------------------------------------------
#
# The detector was trained to remove what a retoucher removes, and upstream's
# own model card lists moles among it. Whether a person's mole goes is the
# photographer's call, so it is a switch, on by default.
#
# The discriminator is the COLOUR of the mark against the skin around it, read
# on its darkest 30% (the removal outline is far larger than the dot, and the
# whole outline measured diluted). Melanin darkens and yellows skin; blood
# reddens it. Measured on everything with a known answer:
#
#     mark                                    hue of (da, db)     darkness dL
#     the 2727 cheek mole, 4 frames           47, 48, 54, 55      -6.9 .. -8.4
#     10 red papules (acne face, 5015 chin)    9 .. 35            -4.4 .. -13.0
#
# A 12-degree gap, and redness-per-darkness (the obvious alternative) does not
# separate them at all (0.55 on the mole against 0.52 on a papule). The bar
# sits in the gap. Known and accepted: brown post-acne marks read as melanin,
# because they are, so with the switch on they stay too (3 of 46 on the acne
# face). That is the side to be wrong on. The evidence is one person's mole —
# a narrow base, recorded as such in docs/TOOLS-STATUS.md.
DEFAULT_KEEP_MOLES = 1
MOLE_MIN_HUE_DEG = 41.0
MOLE_MAX_HUE_DEG = 120.0
MOLE_MAX_DL = -2.0
MOLE_MIN_CHROMA = 1.5
MOLE_CORE_PCT = 30
MOLE_RING = 0.03  # of face width


def pigmented_marks(crop: np.ndarray, removal: np.ndarray, skin: np.ndarray,
                    face_w: float):
    """-> (bool mask of removal components that read as melanin, how many)."""
    keep = np.zeros(removal.shape, bool)
    n, ids, stats, _ = cv2.connectedComponentsWithStats((removal > 0).astype(np.uint8), 8)
    if n <= 1:
        return keep, 0
    lab = cv2.cvtColor(crop.astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)
    k = max(5, int(face_w * MOLE_RING)) | 1
    kernel = np.ones((k, k), np.uint8)
    kept = 0
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 6:
            continue
        ys = slice(max(0, y - k), y + h + k)
        xs = slice(max(0, x - k), x + w + k)
        comp = ids[ys, xs] == i
        ring = ((cv2.dilate(comp.astype(np.uint8), kernel) > 0) & ~comp
                & (skin[ys, xs] > 0.5) & (removal[ys, xs] == 0))
        if ring.sum() < 10:
            continue
        vals = lab[ys, xs][comp]
        core = vals[vals[:, 0] <= np.percentile(vals[:, 0], MOLE_CORE_PCT)]
        dL, da, db = core.mean(axis=0) - np.median(lab[ys, xs][ring], axis=0)
        hue = float(np.degrees(np.arctan2(db, da)))
        if (dL <= MOLE_MAX_DL and np.hypot(da, db) >= MOLE_MIN_CHROMA
                and MOLE_MIN_HUE_DEG <= hue <= MOLE_MAX_HUE_DEG):
            keep[ys, xs] |= comp
            kept += 1
    return keep, kept


def _analyse(crop: np.ndarray, allowed_blem: np.ndarray, skin: np.ndarray,
             face_w: float, keep_moles: bool) -> dict:
    base = hashlib.blake2b(crop.tobytes() + allowed_blem.tobytes() + bytes(str(crop.shape), "ascii"),
                           digest_size=20).digest()
    x = to_tensor(crop)
    # detection is shared by both positions of the switch
    removal = _cached(base + b"det", lambda: removal_weights(detect(x)) * allowed_blem)

    def make():
        moles, kept = (pigmented_marks(crop, removal, skin, face_w) if keep_moles
                       else (np.zeros(removal.shape, bool), 0))
        todo = np.where(moles, 0.0, removal).astype(np.float32)
        comp = inpaint(x, todo) if (todo > 0).any() else x
        return {
            "removal": todo,
            "moles": moles,
            "molesKept": kept,
            "comp01": ((comp[0].permute(1, 2, 0).numpy() + 1.0) / 2.0).astype(np.float32),
            # predicted from the frame the marks are already out of — see docstring
            "mg": evening_layer(comp),
        }

    return _cached(base + (b"keep" if keep_moles else b"all"), make)


# The broad light field the evening layer must hand back unchanged, as a
# fraction of face width (Gaussian sigma).
#
# Measured, clean cheek pixels, evening at 70 (the test_blush.py assertion,
# 0.6 bar). Without it the layer darkened a child's natural cheek highlight —
# lightness only, redness moved 0.2:
#
#     face            no guard   0.04    0.08    0.15    a* blotch evened (any)
#     toddler 2729      1.40     0.31    0.44    0.58    4.2%
#     girl 2727         0.80     0.31    0.35    0.39    3.2%
#     mother 5015       0.06     0.07    0.07    0.05    2.9%
#
# a* evening is identical at every scale, and L mottling kept its evening at
# 0.08 (1.8% as without the guard) but lost some at 0.04 (1.5%). So 0.08.
# On the acne face the same number rises to 1.66 — pimples removed from the
# cheek legitimately move its mean, the case test_blush.clean_cheeks names.
KEEP_LIGHT_SIGMA = 0.08


def _keep_light(before01: np.ndarray, evened01: np.ndarray, face_w: float,
                allow: np.ndarray) -> np.ndarray:
    """Evened colour and fine tone, with the BROAD lightness of `before01`.

    Weighted by `allow`, so wherever the evening layer could not act (features,
    off skin) the pixel is exactly `evened01` — and there that is `before01`.
    """
    sigma = max(1.0, face_w * KEEP_LIGHT_SIGMA)
    lb = cv2.cvtColor(before01.astype(np.float32), cv2.COLOR_RGB2Lab)
    le = cv2.cvtColor(evened01.astype(np.float32), cv2.COLOR_RGB2Lab)
    lift = cv2.GaussianBlur(lb[..., 0], (0, 0), sigma) - cv2.GaussianBlur(le[..., 0], (0, 0), sigma)
    le[..., 0] += lift * allow
    out = cv2.cvtColor(le, cv2.COLOR_Lab2RGB)
    return np.where(allow[..., None] > 0, out, evened01)


# --- texture softening and glow ------------------------------------------------
#
# Scales are fractions of face width, so the same slider means the same thing
# on a 180px face in a group and on a 900px portrait.
#   TEX_GRAIN  below it: sensor grain and the finest skin detail — always kept
#   TEX_PORE   the pore band, between GRAIN and PORE — attenuated by the slider
#   TEX_MICRO  fine mottling just above pores — attenuated at MICRO_SHARE of it
#
# First calibration (grain 0.0012, full pore removal, half the mottling band)
# read as a BLUR at 100 on a 515px face: a 0.7px grain band is almost nothing,
# so nothing held the skin up. The grain band is wider and neither band is ever
# taken out completely.
TEX_GRAIN = 0.0025
TEX_GRAIN_MIN_PX = 0.8
TEX_PORE = 0.0068
TEX_PORE_MIN_PX = 1.6
TEX_MICRO = 0.018
TEX_MAX_ATTEN = 0.75
MICRO_SHARE = 0.3

# Glow is a LIGHTNESS lift on the skin's lit side, not glow.py's screen bloom.
# The bloom was tried first and failed on a bright studio face: screen pushed
# the forehead to white, and glow.py's near-clipping protection (232..252)
# switched off pixel by pixel on JPEG blocks, printing an 8x8 pattern.
#   lit      where the skin's own broad light sits in its brighter part
#   headroom the lift shrinks toward white, so nothing clips
GLOW_MAX_L = 9.0          # Lab L units at 100
GLOW_FIELD = 0.06         # face widths: the light field the lift follows
GLOW_LIT_LO, GLOW_LIT_HI = 25.0, 90.0   # skin percentiles
# The texture and glow stages have no network border fade of their own, and a
# face crop cuts across the neck; this ramps them out toward the crop edge.
STAGE_FADE = 0.12

DEFAULT_TEXTURE = 0
DEFAULT_GLOW = 0


def border_fade(h: int, w: int, frac: float = STAGE_FADE) -> np.ndarray:
    """1 in the middle, a smooth ramp to 0 over the outer `frac` of each side."""
    def ramp(n):
        width = max(1.0, n * frac)
        i = np.arange(n, dtype=np.float32) + 0.5
        t = np.clip(np.minimum(i, n - i) / width, 0.0, 1.0)
        return t * t * (3.0 - 2.0 * t)
    return np.minimum(ramp(h)[:, None], ramp(w)[None, :])


def _masked_blur(x: np.ndarray, support: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian that only listens to `support`: hair, brows and background never
    bleed into skin statistics."""
    num = cv2.GaussianBlur(x * support, (0, 0), sigma)
    den = cv2.GaussianBlur(support, (0, 0), sigma)
    return np.where(den > 1e-3, num / np.maximum(den, 1e-3), x)


def soften_texture(img01: np.ndarray, support: np.ndarray, face_w: float,
                   amount: float, weight: np.ndarray) -> np.ndarray:
    """Attenuate the pore band (and half the mottling band) in L*, grain kept."""
    s1 = max(TEX_GRAIN_MIN_PX, face_w * TEX_GRAIN)
    s2 = max(TEX_PORE_MIN_PX, face_w * TEX_PORE)
    s3 = max(s2 * 1.5, face_w * TEX_MICRO)
    lab = cv2.cvtColor(img01.astype(np.float32), cv2.COLOR_RGB2Lab)
    L = lab[..., 0]
    l1 = _masked_blur(L, support, s1)
    l2 = _masked_blur(L, support, s2)
    l3 = _masked_blur(L, support, s3)
    a = amount * TEX_MAX_ATTEN
    lab[..., 0] = L - (a * (l1 - l2) + a * MICRO_SHARE * (l2 - l3)) * weight
    out = cv2.cvtColor(lab, cv2.COLOR_Lab2RGB)
    return np.where(weight[..., None] > 0, out, img01)


def skin_glow(img01: np.ndarray, support: np.ndarray, face_w: float,
              amount: float, weight: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img01.astype(np.float32), cv2.COLOR_RGB2Lab)
    L = lab[..., 0]
    field = _masked_blur(L, support, max(2.0, face_w * GLOW_FIELD))
    on = support > 0.5
    if on.sum() < 64:
        return img01
    lo, hi = np.percentile(field[on], [GLOW_LIT_LO, GLOW_LIT_HI])
    t = np.clip((field - lo) / max(1e-3, hi - lo), 0.0, 1.0)
    lit = t * t * (3.0 - 2.0 * t)
    headroom = np.clip((100.0 - L) / 50.0, 0.0, 1.0)
    lab[..., 0] = L + amount * GLOW_MAX_L * lit * headroom * weight
    out = cv2.cvtColor(lab, cv2.COLOR_Lab2RGB)
    return np.where(weight[..., None] > 0, out, img01)


def _retouch_face(mask_src: np.ndarray, crop: np.ndarray, face_w: float,
                  blemishes: float, evenness: float, keep_moles: bool,
                  texture: float = 0.0, glow: float = 0.0):
    skin = np.maximum(masks.get_mask(mask_src, "face-skin"),
                      masks.get_mask(mask_src, "body-skin"))
    features = masks.get_mask(mask_src, "face-features")

    # Removal may only land on skin that is not a feature. Binary on purpose:
    # the inpainting network was trained on a hard mask.
    allowed_blem = ((skin > 0.5) & (features < 0.05)).astype(np.float32)

    # The evening layer fades out past the skin edge instead of stopping on it —
    # stopping on the segmenter's jaw line is what drew a colour seam between
    # face and neck in the retired tool.
    g = max(3, int(face_w * 0.02)) | 1
    allow_even = cv2.GaussianBlur(cv2.dilate((skin > 0.5).astype(np.uint8), np.ones((g, g), np.uint8))
                                  .astype(np.float32), (g * 2 + 1, g * 2 + 1), 0)
    allow_even = np.clip(allow_even, 0.0, 1.0) * (1.0 - features)

    a = _analyse(np.ascontiguousarray(crop), allowed_blem, skin, face_w, keep_moles)
    shield = np.zeros(crop.shape[:2], np.float32)
    if a["molesKept"]:
        # A kept mole keeps its colour as well. The evening layer lightens dark
        # marks, which is half of erasing one. Its core is shielded exactly (1),
        # its rim softly, so the evening does not stop on a visible ring.
        core = a["moles"].astype(np.float32)
        grown = cv2.dilate(core, np.ones((g, g), np.uint8))
        shield = np.clip(np.maximum(cv2.GaussianBlur(grown, (g * 2 + 1, g * 2 + 1), 0), core), 0.0, 1.0)
        allow_even = allow_even * (1.0 - shield)

    src01 = crop.astype(np.float32) / 255.0
    work = src01 + blemishes * (a["comp01"] - src01)
    if evenness > 0:
        evened = apply_layer(work, a["mg"], evenness, allow_even)
        work = _keep_light(work, evened, face_w, allow_even)
    if texture > 0 or glow > 0:
        support = allowed_blem  # hard skin, features out
        # One soft weight for both stages. Kept moles are NOT shielded here:
        # shielding them from a lift or a softening that the skin around them
        # receives turned them into dark stains. They take the same light and
        # keep their contrast. A mole's core is left exact by the contract test
        # only for the removal and evening it is protected from.
        feather = cv2.GaussianBlur(support, (g * 2 + 1, g * 2 + 1), 0)
        weight = feather * (1.0 - features) * border_fade(*support.shape)
        if texture > 0:
            work = soften_texture(work, support, face_w, texture, weight)
        if glow > 0:
            work = skin_glow(work, support, face_w, glow, weight)
    out = np.clip(np.rint(work * 255.0), 0, 255).astype(np.uint8)
    return out, {
        "blemishPx": int((a["removal"] > 0).sum()) if blemishes > 0 else 0,
        "molesKept": a["molesKept"],
    }


def _switch(value, default) -> bool:
    try:
        return float(value) >= 0.5
    except (TypeError, ValueError):
        return bool(default)


def apply(rgb: np.ndarray, params: dict):
    """params: { blemishes, evenness, texture, glow } 0..100, { keepMoles } 0/1."""
    blemishes = common.clamp01(params.get("blemishes", DEFAULT_BLEMISHES), DEFAULT_BLEMISHES / 100)
    evenness = common.clamp01(params.get("evenness", DEFAULT_EVENNESS), DEFAULT_EVENNESS / 100)
    texture = common.clamp01(params.get("texture", DEFAULT_TEXTURE), DEFAULT_TEXTURE / 100)
    glow = common.clamp01(params.get("glow", DEFAULT_GLOW), DEFAULT_GLOW / 100)
    keep_moles = _switch(params.get("keepMoles", DEFAULT_KEEP_MOLES), DEFAULT_KEEP_MOLES)
    if blemishes <= 0 and evenness <= 0 and texture <= 0 and glow <= 0:
        return rgb, {"applied": 0}
    if not available():
        return rgb, {"applied": 0, "error": "weights missing"}

    crops = face_crops(rgb)
    out = rgb.copy()
    fh, fw = rgb.shape[:2]
    meta: dict = {"faces": len(crops), "applied": 0, "blemishPx": 0, "molesKept": 0}
    for (x0, y0, x1, y1), face_w in crops:
        verdict = common.face_verdict(face_w, MIN_FACE_PX)
        if verdict:
            meta[verdict] = meta.get(verdict, 0) + 1
            continue
        box_id = "skin-retouch-%.4f,%.4f,%.4f,%.4f" % (x0 / fw, y0 / fh, x1 / fw, y1 / fh)
        with masks.scope(box_id):
            # masks read the photograph as it came in; the pixels worked on are
            # the current ones, so an overlapping neighbour's retouch survives
            sub, m = _retouch_face(rgb[y0:y1, x0:x1], out[y0:y1, x0:x1],
                                   face_w, blemishes, evenness, keep_moles,
                                   texture, glow)
        out[y0:y1, x0:x1] = sub
        meta["applied"] += 1
        meta["blemishPx"] += m["blemishPx"]
        meta["molesKept"] += m["molesKept"]
        meta["faceDiameter"] = max(meta.get("faceDiameter", 0), int(face_w))
    return out, meta


def process(image_b64: str, params: dict):
    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta
