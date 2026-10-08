"""Draw a Vault page with real photos — a preview for the experiment.

Not the product's renderer (that is TemplateLayers.tsx in the browser). This
draws the same layers closely enough for the model to judge and for the
photographer to look at: photos cropped around the faces, colour fields,
frames, feathered photos and the designed words. Drawn ornaments (path,
polyline) are left out, exactly as the product's library leaves them out.
"""
import json
import os
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
FONTS = "C:/Windows/Fonts"


def load_library():
    src = open(os.path.join(ROOT, "src", "album", "templates", "vaultLibrary.ts"), encoding="utf-8").read()
    raw = re.search(r'JSON\.parse\((".*?")\);', src, re.S).group(1)
    return json.loads(json.loads(raw))


def photo_layers(t):
    return [l for l in t["layers"] if l["type"] == "photo"]


def _hex(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def cover_crop(img, tw, th, focal, faces=()):
    """Fill tw×th, keeping the focal point (and every face, when it fits)."""
    w, h = img.size
    scale = max(tw / w, th / h)
    cw, ch = tw / scale, th / scale  # crop size in source px
    fx, fy = focal["x"] * w, focal["y"] * h
    x0 = min(max(fx - cw / 2, 0), w - cw)
    y0 = min(max(fy - ch / 2, 0), h - ch)
    # pull faces fully inside when the crop is big enough to hold them
    for f in faces:
        l, t, r, b = f["x"] * w, f["y"] * h, (f["x"] + f["width"]) * w, (f["y"] + f["height"]) * h
        if r - l <= cw:
            x0 = min(max(x0, r - cw), l)
        if b - t <= ch:
            y0 = min(max(y0, b - ch), t)
    x0 = min(max(x0, 0), w - cw)
    y0 = min(max(y0, 0), h - ch)
    return img.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((tw, th), Image.LANCZOS)


def _feather_mask(size, fe):
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    px, py = xx / max(1, w - 1), yy / max(1, h - 1)
    dx, dy = fe["x2"] - fe["x1"], fe["y2"] - fe["y1"]
    d2 = dx * dx + dy * dy or 1e-6
    t = ((px - fe["x1"]) * dx + (py - fe["y1"]) * dy) / d2
    stops = sorted(fe["stops"], key=lambda s: s["offset"])
    a = np.interp(np.clip(t, 0, 1), [s["offset"] for s in stops], [s["opacity"] for s in stops])
    return Image.fromarray((a * 255).astype(np.uint8))


def render(template, photos, colors=None, height=600):
    """template: Vault page. photos: list (in photo-layer order) of
    {path|image, focal, faces}. colors: token -> hex overrides."""
    pal = {c["id"]: c["value"] for c in template["colors"]}
    pal.update(colors or {})
    W, H = int(round(height * template["nativeAspect"])), height
    canvas = Image.new("RGB", (W, H), _hex(pal[template["backgroundToken"]]))
    slots = iter(photos)
    for layer in sorted(template["layers"], key=lambda l: l["zIndex"]):
        b = layer["box"]
        x, y, w, h = int(b["x"] * W), int(b["y"] * H), max(1, int(b["width"] * W)), max(1, int(b["height"] * H))
        op = layer.get("opacity", 1)
        if layer["type"] == "photo":
            p = next(slots, None)
            if p is None:
                continue
            img = p.get("image") or Image.open(p["path"]).convert("RGB")
            tile = cover_crop(img, w, h, p.get("focal") or {"x": .5, "y": .4}, p.get("faces") or ())
            mask = _feather_mask((w, h), layer["feather"]) if layer.get("feather") else None
            if op < 1:
                m = Image.new("L", (w, h), int(255 * op))
                mask = m if mask is None else Image.fromarray((np.asarray(mask) * op).astype(np.uint8))
            canvas.paste(tile, (x, y), mask)
        elif layer["type"] == "shape" and layer["shape"] in ("rect", "ellipse"):
            over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            d = ImageDraw.Draw(over)
            fill = _hex(pal[layer["fillToken"]]) + (int(255 * op),) if layer.get("fillToken") in pal else None
            stroke = _hex(pal[layer["strokeToken"]]) + (int(255 * op),) if layer.get("strokeToken") in pal else None
            sw = max(1, int(round(layer.get("strokeWidth", 0) * H))) if stroke else 0
            shape = d.rectangle if layer["shape"] == "rect" else d.ellipse
            shape((x, y, x + w - 1, y + h - 1), fill=fill, outline=stroke, width=sw)
            canvas.paste(over, (0, 0), over)
        elif layer["type"] == "text":
            fam = layer.get("fontFamily", "")
            font_file = "segoesc.ttf" if ("cursive" in fam or "Script" in fam) else "georgia.ttf"
            size = max(8, int(layer["fontSize"] * H * 0.8))
            font = ImageFont.truetype(os.path.join(FONTS, font_file), size)
            d = ImageDraw.Draw(canvas)
            text = layer["defaultText"]
            tw = d.textlength(text, font=font)
            tx = x + (w - tw) / 2 if layer["align"] == "center" else (x + w - tw if layer["align"] == "end" else x)
            d.text((tx, y), text, font=font, fill=_hex(pal.get(layer["colorToken"], "#ffffff")))
    return canvas


def sheet(images, labels, cols=2, pad=16, bg=(128, 128, 128)):
    """Candidates side by side, numbered, for the model to compare."""
    w, h = images[0].size
    rows = (len(images) + cols - 1) // cols
    out = Image.new("RGB", (cols * w + (cols + 1) * pad, rows * (h + 40) + pad), bg)
    d = ImageDraw.Draw(out)
    font = ImageFont.truetype(os.path.join(FONTS, "georgiab.ttf"), 28)
    for i, (im, lab) in enumerate(zip(images, labels)):
        cx, cy = pad + (i % cols) * (w + pad), pad + (i // cols) * (h + 40)
        d.text((cx, cy), str(lab), font=font, fill=(255, 255, 0))
        out.paste(im, (cx, cy + 36))
    return out


def strip(images, pad=16, bg=(128, 128, 128)):
    """Photos of different widths in one numbered row."""
    h = images[0].height
    out = Image.new("RGB", (sum(i.width for i in images) + pad * (len(images) + 1), h + 52), bg)
    d = ImageDraw.Draw(out)
    font = ImageFont.truetype(os.path.join(FONTS, "georgiab.ttf"), 28)
    x = pad
    for n, im in enumerate(images, 1):
        d.text((x, pad - 6), str(n), font=font, fill=(255, 255, 0))
        out.paste(im, (x, 40))
        x += im.width + pad
    return out
