"""RAW decoding via rawpy (LibRaw) — the ONE place a sensor file becomes pixels.

The browser cannot display a RAW file, and neither can Pillow: not one raw
extension is registered with it. So every path in the product that opens a
file from disk asks here first, and a frame shot in CR2 behaves exactly like
one shot in JPEG from that point on.

TWO WAYS TO READ THE SAME FILE, AND WHEN EACH IS RIGHT.

`decode` rebuilds the picture from sensor data. It is the truth and it is
slow — seconds per frame, on the CPU, because this product does not lean on
a graphics card.

`embedded` lifts out the ready-made JPEG the camera buried in the file: the
picture it shows on its own screen. Milliseconds. It carries the camera's own
interpretation baked in, so it is NOT the same picture the recipe will
produce — which is exactly why it is used for browsing and never for a
delivery. A grid of 600 frames that takes four minutes to appear is a broken
product; a grid that appears instantly and settles when a frame is opened is
how every professional tool behaves.

    browsing, the gallery sent to a client   ->  embedded
    the frame being edited, apply, export    ->  decode

WHITE BALANCE.

A sensor does not know what colour the light was; someone has to say what
counts as white. The camera already decided, and that decision is the default
here — nothing looks wrong on import and the frame matches what was on the
camera's screen. But it is only a default: the `raw-develop` step in a recipe
moves it, and because it moves the numbers the DECODER is given, it costs the
picture nothing. The same correction applied afterwards, to finished RGB, is
what bruises skin tones.
"""

import io
import os

import rawpy
from PIL import Image, ImageOps

RAW_EXTENSIONS = {
    ".cr2",
    ".cr3",
    ".nef",
    ".arw",
    ".raf",
    ".rw2",
    ".dng",
    ".orf",
    ".pef",
    ".srw",
}

#: The recipe step that is spent HERE rather than on pixels. It is deliberately
#: unknown to render.TOOLS — the renderer would have nothing to do with it.
DEVELOP_TOOL = "raw-develop"

# Warmer means more red AND less blue, so the red/blue ratio moves by the
# SQUARE of this at full travel - about 1.96x, or roughly ±3000K around
# daylight. That is the range a tungsten hall actually needs to be rescued
# from, and at 100 steps it still leaves ~30K a step to work in. Exponential,
# so two nudges the same way feel like twice one nudge rather than running out
# of travel at the end.
_WARMTH_SPAN = 1.4
_TINT_SPAN = 1.25


def is_raw(path) -> bool:
    return bool(path) and os.path.splitext(str(path))[1].lower() in RAW_EXTENSIONS


def develop_of(recipe_tools):
    """The decode-time step, pulled out of a recipe. -> dict or None.

    Returned as plain numbers rather than the tool instance: everything
    downstream of here should be able to decode a frame without knowing that
    recipes exist.
    """
    for t in recipe_tools or []:
        if t.get("toolId") != DEVELOP_TOOL or not t.get("enabled", True):
            continue
        p = t.get("params") or {}
        warmth = float(p.get("warmth", 0) or 0)
        tint = float(p.get("tint", 0) or 0)
        if warmth or tint:
            return {"warmth": warmth, "tint": tint}
    return None


def _user_wb(cam, warmth, tint):
    """The camera's own multipliers, nudged. -> [r, g, b, g2] or None.

    None means "could not improve on the camera", and the caller falls back to
    `use_camera_wb` — some files carry no multipliers at all, and a made-up
    neutral would be a visible colour cast on every frame of the shoot.

    Warmer means more red and less blue in the same breath: scaling only one
    of the two changes overall brightness as well as colour, which reads as the
    exposure slipping every time the temperature is touched.
    """
    cam = [float(x) for x in (cam or [])]
    if len(cam) < 3 or max(cam[:3]) <= 0:
        return None
    if len(cam) < 4 or cam[3] <= 0:
        cam = cam[:3] + [cam[1]]

    warm = _WARMTH_SPAN ** (max(-100.0, min(100.0, warmth)) / 100.0)
    # Positive tint is magenta and negative is green, the way every other tool
    # in this trade labels it — so a photographer's hand already knows which
    # way to go.
    green = _TINT_SPAN ** (-max(-100.0, min(100.0, tint)) / 100.0)
    return [cam[0] * warm, cam[1] * green, cam[2] / warm, cam[3] * green]


def _shrink(img, max_dim):
    if max_dim and max(img.size) > max_dim:
        s = max_dim / max(img.size)
        return img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    return img


def _postprocess(r, develop):
    # `.get`, not `[...]`: a caller that only wants to move the warmth writes
    # {"warmth": 40} and means it. Demanding both keys turned that into a
    # crash on decode, which is a strange way for a slider to behave.
    wb = (
        _user_wb(r.camera_whitebalance, develop.get("warmth", 0), develop.get("tint", 0))
        if develop
        else None
    )
    if wb is not None:
        return r.postprocess(user_wb=wb, no_auto_bright=False, output_bps=8)
    return r.postprocess(
        use_camera_wb=True,  # honour the camera's white balance
        no_auto_bright=False,
        output_bps=8,
    )


def decode_bytes(data: bytes, max_dim: int = 0, develop=None) -> Image.Image:
    with rawpy.imread(io.BytesIO(data)) as r:
        rgb = _postprocess(r, develop)
    return _shrink(Image.fromarray(rgb), max_dim)


def decode_path(path: str, max_dim: int = 0, develop=None) -> Image.Image:
    with open(path, "rb") as f:
        return decode_bytes(f.read(), max_dim, develop)


def source_long(path) -> int:
    """The frame's own long edge, without decoding it.

    Every tool that asks "is this face big enough to touch" is answering about
    the file, not about the proxy it was handed. Read from the header, so it
    costs nothing and stays true when the pixels came from `embedded`.
    """
    with rawpy.imread(path) as r:
        return max(int(r.sizes.width), int(r.sizes.height))


def embedded(path: str, width: int = 0):
    """The camera's own preview, lifted out of the file. -> (Image, long) or None.

    None when the file carries no usable preview, or carries one too small for
    the width being asked for — a 160px thumbnail blown up to fill a grid cell
    looks broken, and the caller decoding properly instead is worth the wait.
    Either way the decision is made HERE, so no caller has to know that some
    cameras embed a full-size JPEG and some embed a postage stamp.
    """
    try:
        with rawpy.imread(path) as r:
            longest = max(int(r.sizes.width), int(r.sizes.height))
            thumb = r.extract_thumb()
    except Exception:  # noqa: BLE001 - no preview is an answer, not a failure
        return None

    try:
        if thumb.format == rawpy.ThumbFormat.JPEG:
            im = Image.open(io.BytesIO(thumb.data))
            if width:
                im.draft("RGB", (width * 2, width * 2))
        elif thumb.format == rawpy.ThumbFormat.BITMAP:
            im = Image.fromarray(thumb.data)
        else:
            return None
        im = ImageOps.exif_transpose(im).convert("RGB")
    except Exception:  # noqa: BLE001
        return None

    if width and max(im.size) < width:
        return None
    return _shrink(im, width), longest
