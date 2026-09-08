"""The two files a gallery actually publishes, made on the photographer's own
machine.

    preview   1600px long edge, q75   ~350KB   what the client looks at
    thumb      400px long edge, q78    ~35KB   what the grid is made of

600 frames come to about 0.25GB. The same 600 originals would be 12GB, which
is the whole reason the original never leaves the disk.

Generating here rather than in the cloud is not a shortcut, it is the
architecture: the engine is already sitting on the disk with a decoder open.
A gallery service that is only a cloud has to pay to receive the original,
pay to process it, and pay to store it. This one pays for none of the three.

Deliberately does NOT import from server.py. The helpers there are the ones
this file mirrors (_fit_size, _decode_small) but importing that module drags
in the whole MediaPipe/TFLite stack, which a gallery upload has no use for and
which costs seconds of start-up.
"""

import io

from PIL import Image, ImageOps

PREVIEW_WIDTH = 1600
PREVIEW_QUALITY = 75
THUMB_WIDTH = 400
THUMB_QUALITY = 78


def _fit(size, width):
    """The box a frame lands in at `width`, long edge.

    One rule for both sizes. Two independent roundings disagree by a pixel on
    the same file, and in a grid that is a row of frames that do not line up.
    """
    w, h = size
    longest = max(w, h)
    if longest <= width:
        return (w, h)
    scale = width / float(longest)
    return (max(1, round(w * scale)), max(1, round(h * scale)))


def _decode(path, width):
    """Decode no larger than needed; libjpeg downscales while it decodes.

    exif_transpose applies the orientation flag and then the save below writes
    no EXIF at all - which is the point. A proofing file is about to be handed
    to whoever has the link, and it should not carry the GPS of the venue or
    the camera's serial number with it.
    """
    im = Image.open(path)
    im.draft("RGB", (width * 2, width * 2))
    return ImageOps.exif_transpose(im).convert("RGB")


def _encode(im, width, quality):
    size = _fit(im.size, width)
    if im.size != size:
        im = im.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue(), size


def average_color(im):
    """One hex colour for the grid to hold the frame's place before it loads.

    A blurred base64 placeholder looks better and costs ~200 bytes per frame;
    at 600 frames that is 120KB of manifest before a single image is fetched,
    on a phone, on cellular. Seven characters gets most of the effect for a
    fortieth of the weight. Revisit if the grid ever feels cheap.
    """
    small = im.resize((1, 1), Image.LANCZOS)
    r, g, b = small.getpixel((0, 0))[:3]
    return f"#{r:02x}{g:02x}{b:02x}"


def derive(path):
    """preview + thumb + placeholder colour for one frame.

    Returns a dict, or raises. A frame that cannot be read is named by the
    caller and skipped - one unreadable file must not take a 600-frame upload
    down with it.
    """
    im = _decode(path, PREVIEW_WIDTH)
    source_size = im.size

    preview, preview_size = _encode(im, PREVIEW_WIDTH, PREVIEW_QUALITY)
    thumb, thumb_size = _encode(im, THUMB_WIDTH, THUMB_QUALITY)

    return {
        "preview": preview,
        "preview_size": preview_size,
        "thumb": thumb,
        "thumb_size": thumb_size,
        "color": average_color(im),
        "source_size": source_size,
        "aspect": round(source_size[0] / float(source_size[1]), 4),
    }
