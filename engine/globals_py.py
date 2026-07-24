"""Python mirror of the global (non-AI) tools from src/imageEngine.ts.

The JS versions drive the live preview (instant slider feedback); these drive
batch export, where hundreds of full-resolution files are rendered headlessly.
The maths is deliberately identical — see the parity test in _parity.py.

Professional-correctness rules mirrored from the JS side:
  * exposure and white balance in LINEAR light, with a soft highlight shoulder
  * sharpening and local contrast on LUMINANCE only, with halo limits
  * oil paint is a real Kuwahara, not a blur
"""

import cv2
import numpy as np

import common

LUM = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
SHOULDER = 0.72


def _p(params, key, default=0.0):
    try:
        return float(params.get(key, default)) / 100.0
    except (TypeError, ValueError):
        return default / 100.0


# Lookup tables. np.power over 60M values is the single most expensive thing in
# the whole pipeline; a table lookup is a memory read. Mirrors the JS engine.
_S2L = np.array(
    [
        (c / 255.0) / 12.92
        if (c / 255.0) <= 0.04045
        else (((c / 255.0) + 0.055) / 1.055) ** 2.4
        for c in range(256)
    ],
    dtype=np.float32,
)

_L2S_N = 4096
_l2s_x = np.linspace(0.0, 1.0, _L2S_N, dtype=np.float32)
_L2S = np.where(
    _l2s_x <= 0.0031308, _l2s_x * 12.92, 1.055 * np.power(_l2s_x, 1 / 2.4) - 0.055
).astype(np.float32)


def _srgb_to_linear_u8(rgb_u8):
    """rgb as 0..255 values -> linear 0..1, via a 256-entry table."""
    return _S2L[rgb_u8]


def _linear_to_srgb(x):
    idx = np.clip(x * (_L2S_N - 1), 0, _L2S_N - 1).astype(np.int32)
    return _L2S[idx]


def _shoulder(x):
    t = (x - SHOULDER) / (1 - SHOULDER)
    return np.where(x <= SHOULDER, x, SHOULDER + (1 - SHOULDER) * (1 - np.exp(-t)))


def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _luma(rgb):
    return rgb @ LUM


def _wrap(fn):
    """Expose each tool with the same (rgb, params) -> (rgb, meta) contract as
    the AI tools, so render.py can chain them all without serialising."""

    def inner(rgb, params: dict):
        out = fn(rgb.astype(np.float32), params)
        return np.clip(out, 0, 255).astype(np.uint8), {}

    return inner


def _tone_color(rgb, params):
    exposure = _p(params, "exposure")
    contrast = _p(params, "contrast")
    highlights = _p(params, "highlights")
    shadows = _p(params, "shadows")
    whites = _p(params, "whites")
    blacks = _p(params, "blacks")
    temp = _p(params, "temperature")
    tint = _p(params, "tint")
    sat = _p(params, "saturation")
    vib = _p(params, "vibrance")

    # ---- stage 1: everything that is a per-channel scalar function ----
    # exposure, white balance, highlight shoulder and contrast all map one
    # input value to one output value, independently per channel. So they are
    # evaluated over 256 values and applied as a lookup — not over 60M values.
    idx = np.arange(256, dtype=np.float32)
    base_gain = 2.0 ** (exposure * 2)
    gains = (
        base_gain * (1 + temp * 0.28 + tint * 0.05),
        base_gain * (1 - tint * 0.1),
        base_gain * (1 - temp * 0.28 + tint * 0.05),
    )

    u8 = rgb.astype(np.uint8)
    x = np.empty(rgb.shape, dtype=np.float32)
    for c in range(3):
        if exposure or temp or tint:
            lut = _linear_to_srgb(_shoulder(_S2L * gains[c]))
        else:
            lut = idx / 255.0
        if contrast:
            if contrast > 0:
                s = lut * lut * (3 - 2 * lut)
                lut = lut + (s - lut) * contrast
            else:
                lut = lut + (0.5 - lut) * (-contrast) * 0.5
        x[..., c] = lut.astype(np.float32)[u8[..., c]]

    # ---- stage 2: tonal zones, a scalar function of luminance ----
    if highlights or shadows or whites or blacks:
        n = 1024
        lv = np.linspace(0.0, 1.0, n, dtype=np.float32)
        off = np.zeros(n, dtype=np.float32)
        if highlights:
            off += _smoothstep(0.4, 0.95, lv) * highlights * 0.35
        if shadows:
            off += (1 - _smoothstep(0.05, 0.6, lv)) * shadows * 0.35
        if whites:
            off += _smoothstep(0.7, 1.0, lv) * whites * 0.3
        if blacks:
            off += (1 - _smoothstep(0.0, 0.3, lv)) * blacks * 0.3
        li = np.clip(_luma(x) * (n - 1), 0, n - 1).astype(np.int32)
        x += off[li][..., None]

    if sat or vib:
        L2 = _luma(x)[..., None]
        pix_sat = (x.max(axis=2) - x.min(axis=2))[..., None]
        k = 1 + sat + vib * (1 - np.clip(pix_sat, 0, 1))
        x = L2 + (x - L2) * k

    return np.clip(x, 0, 1) * 255.0


def _dimension(rgb, params):
    clarity = _p(params, "clarity")
    vignette = _p(params, "vignette")
    out = rgb.copy()
    h, w = rgb.shape[:2]

    if clarity:
        r = max(2, int(max(h, w) * 0.015)) | 1
        blur = cv2.GaussianBlur(rgb, (r, r), 0)
        l0 = _luma(rgb)
        l1 = _luma(blur)
        mid = 1 - np.abs(l0 / 255.0 - 0.5) * 2
        delta = np.clip((l0 - l1) * clarity * 1.1 * mid, -26, 26)
        out = out + delta[..., None]

    if vignette:
        # a smooth radial falloff carries no detail — build it small, scale up
        sh, sw = 256, max(1, int(256 * w / h)) if h >= w else (max(1, int(256 * h / w)), 256)
        yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
        cx, cy = sw / 2.0, sh / 2.0
        t = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / np.sqrt(cx * cx + cy * cy)
        fall = 1 - vignette * _smoothstep(0.35, 1.0, t)
        out = out * common.upscale_to(fall.astype(np.float32), rgb.shape)[..., None]

    return np.clip(out, 0, 255)


def _color_grade(rgb, params):
    sw = _p(params, "shadowsWarm")
    hw = _p(params, "highlightsWarm")
    fade = _p(params, "fade")
    out = rgb.copy()
    L = (_luma(rgb) / 255.0)[..., None]

    if sw:
        m = 1 - _smoothstep(0.0, 0.7, L)
        out[..., 0:1] += sw * m * 24
        out[..., 2:3] -= sw * m * 24
    if hw:
        m = _smoothstep(0.3, 1.0, L)
        out[..., 0:1] += hw * m * 24
        out[..., 2:3] -= hw * m * 24
    if fade:
        base = np.array([62.0, 60.0, 66.0], dtype=np.float32)
        out = out * (1 - fade * 0.22) + fade * 0.22 * base

    return np.clip(out, 0, 255)


def _light_point(rgb, params):
    strength = _p(params, "strength")
    if not strength:
        return rgb
    h, w = rgb.shape[:2]
    cx = float(params.get("x", 50)) / 100.0 * w
    cy = float(params.get("y", 30)) / 100.0 * h
    radius = max(h, w) * float(params.get("size", 50)) / 100.0
    warmth = float(params.get("warmth", 60)) / 100.0

    # the light falloff is smooth — build it small and scale it up
    s = min(1.0, 512.0 / max(h, w))
    sh, sw = max(2, int(h * s)), max(2, int(w * s))
    yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
    t = np.sqrt((xx - cx * s) ** 2 + (yy - cy * s) ** 2) / max(radius * s, 1e-6)
    fall_s = np.where(t < 1, (1 - _smoothstep(0, 1, t)) * strength, 0.0)
    fall = common.upscale_to(fall_s.astype(np.float32), rgb.shape)[..., None]
    tint = np.array(
        [1.0, 0.93 - warmth * 0.05, 0.82 - warmth * 0.22], dtype=np.float32
    )
    light = 255.0 * fall * tint
    return np.clip(255 - (255 - rgb) * (255 - light) / 255.0, 0, 255)


def _glow(rgb, params):
    amount = _p(params, "amount")
    if not amount:
        return rgb
    r = max(2, int(4 + _p(params, "radius", 40) * 50)) | 1
    L = (_luma(rgb) / 255.0)[..., None]
    bright = rgb * _smoothstep(0.55, 1.0, L)
    blur = cv2.GaussianBlur(bright, (r, r), 0)
    screen = 255 - (255 - rgb) * (255 - blur) / 255.0
    return np.clip(rgb + (screen - rgb) * amount, 0, 255)


def _oil_paint(rgb, params):
    amount = _p(params, "amount")
    if not amount:
        return rgb
    r = max(1, int(1 + _p(params, "radius", 30) * 9))
    src = np.clip(rgb, 0, 255).astype(np.uint8)
    if hasattr(cv2, "xphoto") and hasattr(cv2.xphoto, "oilPainting"):
        painted = cv2.xphoto.oilPainting(src, r, 1, cv2.COLOR_BGR2Lab).astype(np.float32)
    else:  # fallback: edge-preserving smoothing
        painted = cv2.edgePreservingFilter(src, flags=1, sigma_s=r * 6, sigma_r=0.4)
        painted = painted.astype(np.float32)
    return np.clip(rgb + (painted - rgb) * amount, 0, 255)


def _sharpen(rgb, params):
    amount = _p(params, "amount")
    if not amount:
        return rgb
    r = max(1, int(1 + _p(params, "radius", 20) * 4)) | 1
    blur = cv2.GaussianBlur(rgb, (r, r), 0)
    delta = np.clip((_luma(rgb) - _luma(blur)) * amount * 1.5, -40, 40)
    return np.clip(rgb + delta[..., None], 0, 255)


tone_color = _wrap(_tone_color)
dimension = _wrap(_dimension)
color_grade = _wrap(_color_grade)
light_point = _wrap(_light_point)
glow = _wrap(_glow)
oil_paint = _wrap(_oil_paint)
sharpen = _wrap(_sharpen)
