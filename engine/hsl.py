"""Per-hue colour control — eight bands, three independent knobs each.

One global saturation slider can only travel one road. The edit that prompted
this needed the grass desaturated to grey while blonde hair and skin stayed
warm, and a single dial physically cannot express that: the fitter pinned
temperature at +100 and tint at -100 trying, and still stalled at 47.6% of the
target.

So colour is decomposed the way a professional panel decomposes it: every hue
band carries its own hue rotation, saturation and luminance. Killing green
while lifting red is then one obvious move instead of an impossible one.

Bands overlap and their weights are normalised, so a colour sitting between two
bands is shared between them and no edit can produce a visible seam where one
band ends.
"""

import cv2
import numpy as np

# Centres in degrees. Spacing is uneven on purpose — it follows where colours
# actually sit, not where arithmetic would put them. Reds/oranges/yellows are
# crowded because skin lives there and needs the resolution.
BANDS = [
    ("red", 0.0),
    ("orange", 30.0),
    ("yellow", 60.0),
    ("green", 120.0),
    ("aqua", 180.0),
    ("blue", 225.0),
    ("purple", 280.0),
    ("magenta", 320.0),
]

# How far a band reaches. Wide enough to overlap its neighbours everywhere.
REACH = 70.0

MAX_HUE_ROT = 30.0  # degrees at param 100
MAX_LUM = 0.35      # V shift at param 100


def _p(params, key):
    try:
        return float(params.get(key, 0.0)) / 100.0
    except (TypeError, ValueError):
        return 0.0


def _weights(hue):
    """(bands, H, W) normalised band membership for every pixel."""
    ws = []
    for _, centre in BANDS:
        d = np.abs(hue - centre)
        d = np.minimum(d, 360.0 - d)  # hue is circular
        t = np.clip(d / REACH, 0.0, 1.0)
        ws.append(0.5 * (1.0 + np.cos(np.pi * t)))
    w = np.stack(ws, 0)
    return w / np.maximum(w.sum(0, keepdims=True), 1e-6)


def apply(rgb, params: dict):
    keys = [
        (name, _p(params, f"{name}Hue"), _p(params, f"{name}Sat"), _p(params, f"{name}Lum"))
        for name, _ in BANDS
    ]
    if not any(abs(h) > 1e-4 or abs(s) > 1e-4 or abs(l) > 1e-4 for _, h, s, l in keys):
        return rgb, {"bandsUsed": 0}

    hsv = cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2HSV)
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]

    w = _weights(hue)
    # A grey pixel has no meaningful hue, so it must not be recoloured by
    # whichever band its noise happens to land in.
    chroma_gate = np.clip((sat - 0.04) / 0.12, 0.0, 1.0)

    hue_rot = np.zeros_like(hue)
    sat_mul = np.zeros_like(hue)
    lum_add = np.zeros_like(hue)
    used = 0
    for i, (_, h, s, l) in enumerate(keys):
        if abs(h) < 1e-4 and abs(s) < 1e-4 and abs(l) < 1e-4:
            continue
        used += 1
        wi = w[i] * chroma_gate
        hue_rot += wi * h * MAX_HUE_ROT
        sat_mul += wi * s
        lum_add += wi * l * MAX_LUM

    hsv[..., 0] = np.mod(hue + hue_rot, 360.0)
    hsv[..., 1] = np.clip(sat * (1.0 + sat_mul), 0.0, 1.0)
    hsv[..., 2] = np.clip(val + lum_add, 0.0, 1.0)

    out = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB) * 255.0
    return np.clip(out, 0, 255).astype(np.uint8), {"bandsUsed": used}


def process(image_b64: str, params: dict):
    import common

    img = common.b64_to_image(image_b64)
    out, meta = apply(common.to_np(img), params)
    return common.image_to_b64(common.to_pil(out)), meta
