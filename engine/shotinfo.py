"""פרטי הצילום — how a frame was taken: camera, lens, shutter, aperture, ISO.

Read from the file's own EXIF. A raw file whose container Pillow cannot open
is read through the camera's embedded preview, which carries the same EXIF on
most bodies. Whatever cannot be read is simply absent from the answer — the
screen shows what is there and never fills a gap with a guess.

The focus point is NOT read: it lives in each maker's private notes, in a
different layout per brand, and a wrong point is worse than none.
"""

import io
from fractions import Fraction
from functools import lru_cache

from PIL import Image

import raw

EXIF_IFD = 0x8769
TAGS = {
    "make": (None, 271),
    "model": (None, 272),
    "exposure": (EXIF_IFD, 33434),
    "fnumber": (EXIF_IFD, 33437),
    "iso": (EXIF_IFD, 34855),
    "focal": (EXIF_IFD, 37386),
    "lens": (EXIF_IFD, 42036),
    "bias": (EXIF_IFD, 37380),
}


def _exif_of(path):
    try:
        with Image.open(path) as im:
            return im.getexif()
    except Exception:  # noqa: BLE001 - a raw container Pillow cannot open
        pass
    if not raw.is_raw(path):
        return None
    try:
        import rawpy

        with rawpy.imread(path) as r:
            thumb = r.extract_thumb()
        if thumb.format != rawpy.ThumbFormat.JPEG:
            return None
        with Image.open(io.BytesIO(thumb.data)) as im:
            return im.getexif()
    except Exception:  # noqa: BLE001
        return None


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


@lru_cache(maxsize=4096)
def read(path):
    """-> dict of the fields found, as display-ready values."""
    exif = _exif_of(path)
    if not exif:
        return {}
    sub = exif.get_ifd(EXIF_IFD)
    got = {}
    for key, (ifd, tag) in TAGS.items():
        v = (sub if ifd == EXIF_IFD else exif).get(tag)
        if v not in (None, "", b""):
            got[key] = v

    out = {}
    make = str(got.get("make", "")).strip().strip("\x00")
    model = str(got.get("model", "")).strip().strip("\x00")
    if model:
        out["camera"] = model if make.split(" ")[0].lower() in model.lower() else f"{make} {model}".strip()
    lens = str(got.get("lens", "")).strip().strip("\x00")
    if lens:
        out["lens"] = lens
    t = _num(got.get("exposure"))
    if t and t > 0:
        out["shutter"] = f"{t:g}s" if t >= 0.5 else f"1/{round(1 / t)}"
    f = _num(got.get("fnumber"))
    if f:
        out["aperture"] = f"f/{round(f, 1):g}"
    iso = got.get("iso")
    if isinstance(iso, (tuple, list)):
        iso = iso[0] if iso else None
    if _num(iso):
        out["iso"] = int(_num(iso))
    fl = _num(got.get("focal"))
    if fl:
        out["focal"] = f"{round(fl)}mm"
    b = _num(got.get("bias"))
    if b:
        out["bias"] = f"{Fraction(b).limit_denominator(3)} EV".replace("+", "")
        if b > 0:
            out["bias"] = "+" + out["bias"]
    return out
