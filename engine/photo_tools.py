"""The Photos-style editor's own tools (src/v2/screens/PhotoEditor.tsx).

Each is an ordinary recipe step — (rgb, params) -> (rgb, meta) — so an edit
made in the work stage's editor is the same edit the editing stage renders and
the export delivers. Nothing here is a preview-only effect.

  geometry            rotate by quarters, flip, straighten, crop. Runs LAST
                      (render.py order 90): every face and colour tool works on
                      the whole frame, then the frame is cut.
  look                the filter gallery (סנן): fifteen named looks and an
                      intensity. After the colour tools, before light/glow.
  background-replace  רקע · הסר / החלף: the background (masks.py 'subject',
                      inverted) filled with white or with a chosen colour.
  markup              סימון: pen and highlighter strokes, drawn after geometry,
                      in fractions of the FINISHED frame.

plus `auto_enhance`, which reads a frame and answers tone-color params — the
"שיפור אוטומטי" button. It measures; it never writes a step itself.
"""

import math

import numpy as np
from PIL import Image, ImageDraw

import masks


def _p(params, key, default=0.0):
    v = params.get(key, default)
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(default)


# ------------------------------------------------------------------ geometry

def straighten_scale(w, h, degrees):
    """How much a frame must grow so a straightened picture still fills it —
    the rule the editor's live preview uses too, so screen and file agree."""
    t = math.radians(abs(degrees))
    return math.cos(t) + math.sin(t) * max(w / h, h / w)


def geometry(rgb, params):
    quarter = int(round(_p(params, "quarter"))) % 4
    flip_h = _p(params, "flipH") >= 0.5
    flip_v = _p(params, "flipV") >= 0.5
    angle = max(-45.0, min(45.0, _p(params, "angle")))
    cx, cy = _p(params, "cropX", 0), _p(params, "cropY", 0)
    cw, ch = _p(params, "cropW", 1), _p(params, "cropH", 1)

    out = rgb
    if quarter:
        out = np.rot90(out, k=-quarter)  # clockwise, as the button turns it
    if flip_h:
        out = out[:, ::-1]
    if flip_v:
        out = out[::-1]
    out = np.ascontiguousarray(out)

    if abs(angle) > 0.01:
        h, w = out.shape[:2]
        k = straighten_scale(w, h, angle)
        big = Image.fromarray(out).rotate(-angle, resample=Image.BICUBIC, expand=True)
        bw, bh = big.size
        tw, th = w / k, h / k
        left, top = (bw - tw) / 2, (bh - th) / 2
        big = big.crop((round(left), round(top), round(left + tw), round(top + th)))
        out = np.asarray(big)

    cw = max(0.02, min(1.0, cw))
    ch = max(0.02, min(1.0, ch))
    cx = max(0.0, min(1.0 - cw, cx))
    cy = max(0.0, min(1.0 - ch, cy))
    if cw < 0.999 or ch < 0.999 or cx > 0.001 or cy > 0.001:
        h, w = out.shape[:2]
        x0, y0 = int(round(cx * w)), int(round(cy * h))
        x1, y1 = max(x0 + 1, int(round((cx + cw) * w))), max(y0 + 1, int(round((cy + ch) * h)))
        out = out[y0:y1, x0:x1]
    return np.ascontiguousarray(out), {"size": [int(out.shape[1]), int(out.shape[0])]}


# ---------------------------------------------------------------------- look

def _lum(f):
    return f[..., 0] * 0.2126 + f[..., 1] * 0.7152 + f[..., 2] * 0.0722


def _curve(f, contrast=0.0, lift=0.0, gamma=1.0):
    """S-curve around the middle, a raised black point (fade), a gamma."""
    if gamma != 1.0:
        f = np.power(np.clip(f, 0, 1), gamma)
    if contrast:
        # a smooth S: blend toward smoothstep, or away from it for negative
        s = f * f * (3 - 2 * f)
        f = f + (s - f) * contrast
    if lift:
        f = lift + f * (1 - lift)
    return f


def _sat(f, amount):
    y = _lum(f)[..., None]
    return y + (f - y) * (1 + amount)


def _tone(f, shadows=(0, 0, 0), highs=(0, 0, 0)):
    """Split toning: tint the dark end one way, the light end another."""
    y = _lum(f)[..., None]
    sh = np.clip(1 - y * 2, 0, 1)
    hi = np.clip(y * 2 - 1, 0, 1)
    return f + sh * np.array(shadows, np.float32) + hi * np.array(highs, np.float32)


def _warm(f, t):
    return f * np.array([1 + t, 1 + t * 0.35, 1 - t], np.float32)


def _bw(f, mix=(0.30, 0.59, 0.11)):
    y = f[..., 0] * mix[0] + f[..., 1] * mix[1] + f[..., 2] * mix[2]
    return np.repeat(y[..., None], 3, axis=2)


def _look_fn(i):
    return [
        lambda f: f,                                                                     # 0 מקורי
        lambda f: _sat(_curve(f, 0.45), 0.35),                                           # 1 ניקוב
        lambda f: _tone(_warm(_curve(f, 0.15), 0.08), (0.02, 0.01, -0.02), (0.05, 0.03, -0.03)),  # 2 מוזהב
        lambda f: _sat(_curve(f, 0.1, gamma=0.88), 0.2),                                 # 3 קרינה
        lambda f: _warm(_sat(_curve(f, 0.5), 0.1), 0.06),                                # 4 ניגודיות חמה
        lambda f: _sat(_curve(f, -0.25, lift=0.06), -0.25),                              # 5 רגוע
        lambda f: _warm(_curve(f, 0.05, gamma=0.9), -0.07),                              # 6 מואר קריר
        lambda f: _warm(_sat(_curve(f, 0.3), 0.45), -0.08),                              # 7 קריר בוהק
        lambda f: _tone(_warm(_sat(_curve(f, 0.65), -0.15), -0.06), (-0.03, 0.0, 0.04), (0, 0, 0)),  # 8 דרמטי קריר
        lambda f: _bw(_curve(f, 0.15)),                                                  # 9 שחור-לבן
        lambda f: _bw(_curve(f, 0.15)) * np.array([0.95, 0.99, 1.06], np.float32),       # 10 שחור-לבן קריר
        lambda f: _bw(_curve(f, 0.15)) * np.array([1.06, 1.0, 0.9], np.float32),         # 11 שחור-לבן חם
        lambda f: _bw(_curve(f, 0.9), (0.4, 0.5, 0.1)),                                  # 12 שחור-לבן בחדות גבוהה
        lambda f: _tone(_sat(_curve(f, 0.55, gamma=1.12), 0.15), (0.05, 0.0, -0.04), (0.02, 0.0, -0.03)),  # 13 צריבה
        lambda f: _tone(_sat(_curve(f, 0.2, lift=0.07), -0.2), (0.0, 0.02, 0.03), (0.04, 0.02, -0.02)),  # 14 סרט
        lambda f: _bw(_curve(f, 0.1)) * np.array([1.12, 0.98, 0.78], np.float32),        # 15 ספיה
    ][i]


LOOK_COUNT = 16


def look(rgb, params):
    i = int(round(_p(params, "preset")))
    amount = max(0.0, min(1.0, _p(params, "amount", 100) / 100))
    if i <= 0 or i >= LOOK_COUNT or amount <= 0:
        return rgb, {}
    f = rgb.astype(np.float32) / 255
    g = np.clip(_look_fn(i)(f), 0, 1)
    out = f + (g - f) * amount
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), {"preset": i}


# ---------------------------------------------------------------- background

def _paint_onto(mask, strokes):
    """The background brush: 'keep' strokes add to the subject, 'remove'
    strokes give an area to the background. Points in 0..1, radius as a
    fraction of the width; soft-edged, like the brush that drew them."""
    if not strokes:
        return mask
    h, w = mask.shape
    keep = Image.new("L", (w, h), 0)
    drop = Image.new("L", (w, h), 0)
    dk, dd = ImageDraw.Draw(keep), ImageDraw.Draw(drop)
    for s in strokes:
        pts = [(float(x) * w, float(y) * h) for x, y in (s.get("points") or [])]
        if not pts:
            continue
        rad = max(1.0, float(s.get("r", 0.02)) * w)
        d = dk if s.get("kind", "keep") == "keep" else dd
        if len(pts) > 1:
            d.line(pts, fill=255, width=int(rad * 2), joint="curve")
        for x, y in pts:
            d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=255)
    from PIL import ImageFilter
    soft = max(1, int(w * 0.002))
    k = np.asarray(keep.filter(ImageFilter.GaussianBlur(soft)), np.float32) / 255
    r = np.asarray(drop.filter(ImageFilter.GaussianBlur(soft)), np.float32) / 255
    return np.clip(np.maximum(mask, k) * (1 - r), 0, 1)


def background_replace(rgb, params):
    """mode 1 = remove (white — delivered files are JPEG, which has no
    transparency), 2 = replace with the colour r,g,b, 3 = blur by `amount`.
    `strokes` refine what counts as the subject."""
    mode = int(round(_p(params, "mode")))
    if mode not in (1, 2, 3):
        return rgb, {}
    subject = masks.get_mask(rgb, "subject").astype(np.float32)
    if subject.max() > 1.5:
        subject = subject / 255
    if subject.shape != rgb.shape[:2]:
        subject = np.asarray(Image.fromarray((np.clip(subject, 0, 1) * 255).astype(np.uint8)).resize(
            (rgb.shape[1], rgb.shape[0]), Image.BILINEAR)).astype(np.float32) / 255
    subject = _paint_onto(np.clip(subject, 0, 1), params.get("strokes"))
    if mode == 3:
        from PIL import ImageFilter
        amount = max(0.0, min(1.0, _p(params, "amount", 60) / 100))
        if amount <= 0:
            return rgb, {}
        radius = max(1.0, amount * rgb.shape[1] * 0.012)
        fill = np.asarray(Image.fromarray(rgb).filter(ImageFilter.GaussianBlur(radius)), np.float32)
    else:
        colour = (255, 255, 255) if mode == 1 else (_p(params, "r", 255), _p(params, "g", 255), _p(params, "b", 255))
        fill = np.empty(rgb.shape, dtype=np.float32)
        fill[...] = np.array(colour, np.float32)
    a = subject[..., None]
    out = rgb.astype(np.float32) * a + fill * (1 - a)
    return (np.clip(out, 0, 255) + 0.5).astype(np.uint8), {"subjectCoverage": float(a.mean())}


# -------------------------------------------------------------------- markup

def markup(rgb, params):
    """strokes: [{points:[[x,y]...] in 0..1, r: fraction of width,
    color:'#rrggbb', kind:'pen'|'highlighter'}]"""
    strokes = params.get("strokes") or []
    if not strokes:
        return rgb, {}
    h, w = rgb.shape[:2]
    base = Image.fromarray(rgb).convert("RGBA")
    for s in strokes:
        pts = [(float(x) * w, float(y) * h) for x, y in (s.get("points") or [])]
        if not pts:
            continue
        col = str(s.get("color", "#ff3b30")).lstrip("#")
        try:
            rgb_c = tuple(int(col[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            rgb_c = (255, 59, 48)
        high = s.get("kind") == "highlighter"
        alpha = 110 if high else 255
        width = max(1, int(round(float(s.get("r", 0.004)) * w * 2)))
        layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        if len(pts) > 1:
            d.line(pts, fill=rgb_c + (alpha,), width=width, joint="curve")
        rad = width / 2
        for x, y in (pts if not high else [pts[0], pts[-1]]):
            d.ellipse((x - rad, y - rad, x + rad, y + rad), fill=rgb_c + (alpha,))
        base = Image.alpha_composite(base, layer)
    return np.asarray(base.convert("RGB")), {"strokes": len(strokes)}


# -------------------------------------------------------------- auto enhance

def auto_enhance(rgb):
    """-> tone-color params that bring a frame to a sound starting point.

    Measured, bounded, and deliberately mild: it sets the middle grey, pulls
    clipped highlights back, opens blocked shadows, and neutralises a cast by
    grey-world — each capped so a frame that was shot that way on purpose is
    nudged, not rewritten."""
    small = np.asarray(Image.fromarray(rgb).resize(
        (max(1, rgb.shape[1] // 8), max(1, rgb.shape[0] // 8)), Image.BILINEAR)).astype(np.float32) / 255
    y = _lum(small)
    med = float(np.median(y))
    p02, p98 = float(np.percentile(y, 2)), float(np.percentile(y, 98))
    clip_hi = float((y > 0.97).mean())
    clip_lo = float((y < 0.03).mean())

    exposure = 0.0
    if med > 0.01:
        stops = math.log2(0.42 / med)
        exposure = max(-60.0, min(60.0, stops * 50))
    span = p98 - p02
    contrast = max(-20.0, min(25.0, (0.8 - span) * 60))
    highlights = -min(50.0, clip_hi * 900)
    shadows = min(45.0, clip_lo * 700 + max(0.0, 0.12 - p02) * 150)

    mean = small.reshape(-1, 3).mean(axis=0)
    g = float(mean.mean()) or 1e-6
    warm = (float(mean[2]) - float(mean[0])) / g        # blue over red: too cool
    green = (float(mean[1]) - (float(mean[0]) + float(mean[2])) / 2) / g
    temperature = max(-30.0, min(30.0, warm * 120))
    tint = max(-25.0, min(25.0, green * 120))
    return {
        "exposure": round(exposure),
        "contrast": round(contrast),
        "highlights": round(highlights),
        "shadows": round(shadows),
        "temperature": round(temperature),
        "tint": round(tint),
        "vibrance": 12,
    }
