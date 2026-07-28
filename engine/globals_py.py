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
        mx = x.max(axis=2)
        mn = x.min(axis=2)
        c = mx - mn
        vib_px = vib
        if vib:
            # Vibrance protects skin, as Adobe's does: a boost that is strongest
            # on muted pixels lands hardest on faces — the one thing a portrait
            # must not over-saturate. Skin is identified by two general
            # properties, not one: hue in the skin band (plateau 14..42 deg —
            # warm grades pull skin down toward 13, so the ramp starts at 8)
            # AND moderate chroma — skin never saturates past ~0.35, so the
            # protection fades back out above it and a red/orange flower keeps
            # its full boost. A low chroma gate keeps the noise-hue of greys
            # from speckling. Mirrored byte-for-byte in imageEngine.ts.
            r, g, b = x[..., 0], x[..., 1], x[..., 2]
            safe_c = np.maximum(c, 1e-6)
            h = np.where(
                mx == r,
                np.mod((g - b) / safe_c, 6.0),
                np.where(mx == g, (b - r) / safe_c + 2.0, (r - g) / safe_c + 4.0),
            ) * 60.0
            # the low gate hugs true neutrals (c<0.015): muted skin at c~0.06
            # is exactly what vibrance boosts hardest, so it must be protected
            # warm-graded skin genuinely reaches c~0.35-0.4, so the band's
            # ceiling sits above it; hue<10 excludes red flowers regardless
            w_band = _smoothstep(8.0, 14.0, h) * (1.0 - _smoothstep(42.0, 50.0, h))
            w_band = w_band * (1.0 - _smoothstep(0.38, 0.55, c))
            # blush, ruddy cheeks and lips are MUTED reds; red flowers and
            # fabric are saturated ones — chroma is what separates them
            hd = np.minimum(h, 360.0 - h)
            w_red = (1.0 - _smoothstep(6.0, 14.0, hd)) * (
                1.0 - _smoothstep(0.18, 0.30, c)
            )
            w = np.maximum(w_band, w_red)
            w = w * np.clip((c - 0.015) / 0.035, 0.0, 1.0)
            vib_px = vib * (1.0 - 0.8 * w)
        k = 1 + sat + vib_px * (1 - np.clip(c, 0, 1))
        x = L2 + (x - L2) * k[..., None]

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
        # a smooth radial falloff carries no detail — build it small, scale up.
        # 256 goes on the SHORT side; written as a statement because as a
        # conditional expression the `else` branch binds to sw alone and
        # silently makes it a tuple on landscape frames.
        if h >= w:
            sh, sw = 256, max(1, int(256 * w / h))
        else:
            sh, sw = max(1, int(256 * h / w)), 256
        yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
        cx, cy = sw / 2.0, sh / 2.0
        t = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / np.sqrt(cx * cx + cy * cy)
        # midpoint slides where the falloff begins (ACR-style); 50 reproduces
        # the historical 0.35 exactly, so old recipes render unchanged
        midpoint = _p(params, "midpoint", 50)
        start = 0.35 + (midpoint - 0.5) * 0.5
        # floor at 0.25: two stops down. A vignette is a look; a black corner
        # is a hole in the print. Only binds above vignette 75.
        fall = np.maximum(1 - vignette * _smoothstep(start, 1.0, t), 0.25)
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


# A radius in absolute pixels means something different on a 640px preview than
# on a 4160px master, so a recipe learned at one size does not transfer to the
# other — measured, after a fitted glow/oil-paint pair behaved nothing like the
# fit predicted at full resolution. Radii are therefore fractions of the frame,
# anchored so that at 1600px they equal the old pixel values exactly and every
# recipe written before this change still means what it meant.
REF_DIM = 1600.0


def _radius_px(rgb, frac_at_ref, minimum=1):
    return max(minimum, int(round(max(rgb.shape[:2]) * frac_at_ref / REF_DIM)))


def _glow(rgb, params):
    amount = _p(params, "amount")
    if not amount:
        return rgb
    r = _radius_px(rgb, 4 + _p(params, "radius", 40) * 50, 2) | 1
    L = (_luma(rgb) / 255.0)[..., None]
    bright = rgb * _smoothstep(0.55, 1.0, L)
    blur = cv2.GaussianBlur(bright, (r, r), 0)
    screen = 255 - (255 - rgb) * (255 - blur) / 255.0
    return np.clip(rgb + (screen - rgb) * amount, 0, 255)


def _oil_paint(rgb, params):
    amount = _p(params, "amount")
    if not amount:
        return rgb
    # capped: oilPainting is roughly O(r^2) per pixel, and an uncapped
    # frame-relative radius on a 26MP master runs for minutes
    r = min(10, _radius_px(rgb, 1 + _p(params, "radius", 30) * 9))
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
    r = _radius_px(rgb, 1 + _p(params, "radius", 20) * 4) | 1
    blur = cv2.GaussianBlur(rgb, (r, r), 0)
    hp = _luma(rgb) - _luma(blur)
    delta = np.clip(hp * amount * 1.5, -40, 40)

    # ACR-style masking: restrict sharpening to real edges. The edge measure is
    # the local energy of the SAME high-pass the sharpen uses, so "edge" and
    # "what would be sharpened" agree by construction. At 0 this is bypassed
    # and the output is byte-identical to the unmasked tool. Quadratic response
    # like Adobe's: the first half of the slider is gentle. Mirrored in
    # imageEngine.ts.
    masking = _p(params, "masking")
    if masking > 0:
        er = (r * 2 + 1) | 1
        energy = cv2.GaussianBlur(np.abs(hp), (er, er), 0)
        # normalised to the frame's own strong edges (P99) — an absolute
        # threshold means something different on every image and resolution,
        # which is exactly what breaks recipe transfer. P99 and not P95: on a
        # bokeh-heavy portrait most of the frame is smooth, so P95 lands at
        # subject-texture level and skin ranks as "strong edge" (measured).
        scale = float(np.percentile(energy, 99))
        if scale > 1e-3:
            t = masking * masking
            delta = delta * _smoothstep(t * 0.6, t * 1.4 + 1e-6, energy / scale)

    return np.clip(rgb + delta[..., None], 0, 255)


# ---------------------------------------------------------------- curves ----
# Parametric curves, the Lightroom form: five fixed-x control points per
# channel whose OUTPUTS are the sliders. A free point-curve would need
# non-numeric params, which the recipe format (and the fitter) cannot carry;
# five offsets per channel express the same tonal moves and stay flat numbers.

_CURVE_XS = np.array([0.0, 64.0, 128.0, 192.0, 255.0], dtype=np.float32)
_CURVE_POINTS = ("Blacks", "Shadows", "Mids", "Highlights", "Whites")


def _curve_lut(offsets):
    """offsets: five -1..1 values -> a 256-entry LUT (float32, 0..255).

    Monotone cubic (Fritsch-Carlson) through the five points. The ys are
    clamped non-decreasing first: a tone curve that folds back solarizes the
    image, which is never what a slider user meant. Mirrored in imageEngine.ts.
    """
    ys = _CURVE_XS + np.asarray(offsets, np.float32) * 64.0
    ys = np.maximum.accumulate(np.clip(ys, 0.0, 255.0))

    h = np.diff(_CURVE_XS)
    d = np.diff(ys) / h
    m = np.empty(5, np.float32)
    m[0], m[4] = d[0], d[3]
    for i in range(1, 4):
        m[i] = 0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2.0
    for i in range(4):
        if d[i] == 0:
            m[i] = m[i + 1] = 0.0
        else:
            a, b = m[i] / d[i], m[i + 1] / d[i]
            s = a * a + b * b
            if s > 9.0:
                t = 3.0 / float(np.sqrt(s))
                m[i], m[i + 1] = t * a * d[i], t * b * d[i]

    xs_all = np.arange(256, dtype=np.float32)
    seg = np.clip(np.searchsorted(_CURVE_XS, xs_all, side="right") - 1, 0, 3)
    lut = np.empty(256, np.float32)
    for i in range(4):
        sel = seg == i
        t = (xs_all[sel] - _CURVE_XS[i]) / h[i]
        t2, t3 = t * t, t * t * t
        lut[sel] = (
            ys[i] * (2 * t3 - 3 * t2 + 1)
            + h[i] * m[i] * (t3 - 2 * t2 + t)
            + ys[i + 1] * (-2 * t3 + 3 * t2)
            + h[i] * m[i + 1] * (t3 - t2)
        )
    return np.clip(lut, 0.0, 255.0)


def _curves(rgb, params):
    def offs(ch):
        return [_p(params, f"{ch}{pt}") for pt in _CURVE_POINTS]

    chans = {ch: offs(ch) for ch in ("luma", "red", "green", "blue")}
    if not any(any(o) for o in chans.values()):
        return rgb

    out = rgb.copy()
    # channel curves first — they are colour moves; the luma curve then shapes
    # tone on the result without shifting the colour the channels just set
    for c, ch in enumerate(("red", "green", "blue")):
        if any(chans[ch]):
            lut = _curve_lut(chans[ch])
            idx = np.clip(np.round(out[..., c]), 0, 255).astype(np.int32)
            out[..., c] = lut[idx]

    if any(chans["luma"]):
        lut = _curve_lut(chans["luma"])
        idx = np.clip(np.round(_luma(out)), 0, 255).astype(np.int32)
        # applied as a per-pixel luminance delta on all channels equally:
        # tone moves, colour stays (the channel curves own colour)
        out = out + (lut[idx] - idx.astype(np.float32))[..., None]

    return np.clip(out, 0, 255)


tone_color = _wrap(_tone_color)
curves = _wrap(_curves)
dimension = _wrap(_dimension)
color_grade = _wrap(_color_grade)
light_point = _wrap(_light_point)
glow = _wrap(_glow)
oil_paint = _wrap(_oil_paint)
sharpen = _wrap(_sharpen)
