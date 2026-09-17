"""How a photograph becomes the pixels a screen asks for — sizing, decoding,
the working frame and thumbnails.

Shared by the engine (server.py) and the background preparer (prep.py). They
MUST agree to the pixel: prep computes masks and thumbnails ahead of time and
writes them to the same caches the engine reads, and a cache entry is only a
hit when the picture it was computed from is the picture being rendered. One
copy of this code is what makes that true; two copies would drift.
"""

import hashlib
import io
import os

from PIL import Image, ImageOps

import common
import raw


# Panel widths come from the WINDOW, so they are whatever the photographer
# dragged the edge to. Masks are cached per picture-as-rendered, so a free-
# running width meant every resize re-segmented the whole set: measured, the
# same photograph cost 2.4s at a width it had seen and 8.5s one pixel off.
#
# Rendering is therefore quantised to a ladder and the panel scales the result
# the last few pixels — it is already scaling it to fit. Rounding UP keeps the
# frame at least as large as asked, so nothing is ever upscaled to fill the
# panel.
_WIDTH_STEP = 256


def _quantise_width(cap, size):
    if cap <= 0:
        return cap
    stepped = -(-int(cap) // _WIDTH_STEP) * _WIDTH_STEP
    return min(stepped, max(size))


def _fit_size(size, width):
    """The box a frame lands in at `width`, long edge.

    ONE rule, used by /thumb and /preview alike. They used to size themselves
    independently — thumbnail() twice for the preview, once for the thumb — and
    the two roundings disagreed by a pixel (213 vs 214 on the same file). In a
    grid that is a row of frames that do not line up, and between the raw frame
    and the graded one it makes an A/B comparison impossible.
    """
    w, h = size
    longest = max(w, h)
    if longest <= width:
        return (w, h)
    scale = width / float(longest)
    return (max(1, round(w * scale)), max(1, round(h * scale)))


def _decode_small(path, width, develop=None, fast=False):
    """Decode small. Reading a 20MP frame to show it at 320px costs about twenty
    times more, and libjpeg can downscale while it decodes.

    Returns the frame and THE FILE'S OWN long edge, read before the draft throws
    it away. Everything downstream that asks "is this face big enough" needs it:
    without it the tools answer about the proxy, and a strip drawn at 320px
    would report every face in the set as too small to touch. Rotation does not
    change a long edge, so this survives `exif_transpose`.

    `fast` is the raw shortcut and means nothing on a JPEG: take the preview
    the camera buried in the file instead of rebuilding the picture from sensor
    data. Seconds become milliseconds, at the cost of showing the CAMERA's
    interpretation rather than the one the recipe would produce. Right for a
    wall of thumbnails, wrong for anything being judged — so it is off unless
    a caller asks, and a file with no usable preview falls through to the real
    decode rather than to an error.
    """
    if raw.is_raw(path):
        if fast:
            got = raw.embedded(path, width)
            if got is not None:
                return got
        im = raw.decode_path(path, develop=develop)
        source_long = max(im.size)
        im = ImageOps.exif_transpose(im).convert("RGB")
        # The draft the JPEG path gets for free, done by hand: downstream still
        # resizes to the exact box, and carrying 24MP there costs a second.
        if width and max(im.size) > width * 2:
            im = im.resize(_fit_size(im.size, width * 2), Image.LANCZOS)
        return im, source_long

    im = Image.open(path)
    source_long = max(im.size)
    im.draft("RGB", (width * 2, width * 2))
    return ImageOps.exif_transpose(im).convert("RGB"), source_long


def _photo_key(path):
    """A stable name for the FILE, so its masks are computed once ever.

    Path plus mtime plus size: editing or replacing the file changes the name,
    so a stale mask cannot survive it, while opening the same photograph at a
    different panel width keeps it. Returns None when we were handed pixels
    instead of a file — then the caches fall back to hashing those pixels.
    """
    try:
        st = os.stat(path)
    except OSError:
        return None
    return f"{os.path.realpath(path)}|{st.st_mtime_ns}|{st.st_size}"


def cache_root():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(base, "TEZA", "cache")


def working_frame(path, capreq, develop=None):
    """-> (source PIL, working PIL, scale) — the frame the edit screen renders.

    The file, EXIF-upright, resized to the quantised panel width. `scale` is how
    much it was shrunk, which the face tools need to judge size honestly.

    Never the camera's quick preview: this is the frame being WORKED ON, and
    every tool that runs on it has to see the same pixels the delivered file
    will be made from.
    """
    img = common.load_image(path, develop=develop)
    source, scale = img, 1.0
    cap = _quantise_width(capreq, img.size)
    if cap > 0:
        size = _fit_size(img.size, cap)
        if size != img.size:
            scale = max(img.size) / float(max(size))
            img = img.resize(size, Image.LANCZOS)
    return source, img, scale


# ------------------------------------------------------------------ thumbnails
#
# A grid of 416 frames asked the engine to open 416 twenty-megapixel files, and
# asked again after every restart: ~0.2s a frame, six at a time, on the same
# cores the edit screen renders on. A thumbnail is a pure function of the file
# and the width, so it is kept on disk and served in a millisecond afterwards —
# the same thing Lightroom's preview cache is. Bump THUMB_VERSION when the way
# a thumbnail is drawn changes.
THUMB_VERSION = 1


def thumb_cache_path(path, width):
    key = photo_key(path)
    if key is None:
        return None
    ident = hashlib.sha1(f"{THUMB_VERSION}|{key}|{int(width)}".encode("utf-8")).hexdigest()
    return os.path.join(cache_root(), "thumbs", ident[:2], f"{ident}.jpg")


def thumb_bytes(path, width):
    """The JPEG /thumb serves. Computed exactly as it always was.

    `fast`: a thumbnail is for finding a photograph, not for judging one, and a
    folder of 600 raw frames must not cost half an hour to look at.
    """
    im, _ = _decode_small(path, width, fast=True)  # a thumb runs no tools
    # the same rule /preview uses, so a raw frame and a graded one are
    # never a pixel apart
    size = _fit_size(im.size, width)
    if im.size != size:
        im = im.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82)
    return buf.getvalue()


def cached_thumb(path, width):
    """-> bytes, from disk when this frame was drawn at this width before."""
    target = thumb_cache_path(path, width)
    if target is not None:
        try:
            with open(target, "rb") as fh:
                return fh.read()
        except OSError:
            pass
    data = thumb_bytes(path, width)
    if target is not None:
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            tmp = f"{target}.{os.getpid()}.tmp"
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, target)
        except OSError:
            pass  # a cache that cannot be written still serves pixels
    return data


def prep_marker(path, width, recipe_text):
    """The file prep.py leaves when a frame is fully prepared for this width
    and recipe — how anyone asks "is this one ready" without guessing."""
    key = photo_key(path)
    if key is None:
        return None
    ident = hashlib.sha1(f"{key}|{int(width)}|{recipe_text}".encode("utf-8")).hexdigest()
    return os.path.join(cache_root(), "prepared", ident[:2], ident)


# public names; server.py keeps its historical underscored ones
fit_size = _fit_size
quantise_width = _quantise_width
decode_small = _decode_small
photo_key = _photo_key
