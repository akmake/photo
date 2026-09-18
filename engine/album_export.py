"""The engine's two jobs in an album export: serving the pixels of the real
file, and the final encoding of a print-ready sRGB JPEG."""

import base64
import io

from PIL import Image, ImageCms

import common


def _encode_print_jpeg(image, ppi: int):
    """The one encode a printed sheet is allowed to go through.

    Quality 97 with no chroma subsampling, the resolution written into the
    file so the lab opens it at the right size, and sRGB attached so nobody
    downstream has to guess which red was meant.
    """
    ppi = max(72, min(600, int(ppi)))
    srgb_profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    output = io.BytesIO()
    image.save(
        output,
        format="JPEG",
        quality=97,
        subsampling=0,
        optimize=True,
        dpi=(ppi, ppi),
        icc_profile=srgb_profile,
    )
    return output.getvalue(), {
        "widthPx": image.width,
        "heightPx": image.height,
        "ppi": ppi,
        "quality": 97,
        "subsampling": "4:4:4",
        "icc": "sRGB",
    }


def finalize_srgb_jpeg(image_data: str, ppi: int = 300):
    data, meta = _encode_print_jpeg(common.b64_to_image(image_data), ppi)
    return base64.b64encode(data).decode("ascii"), meta


def finalize_sheet(data: bytes, ppi: int = 300):
    """A rendered sheet in, the file the lab prints out — bytes both ways.

    The screen sends the sheet LOSSLESS (a PNG), and this is where it becomes
    a JPEG, once. The older door takes base64 JSON, which on a 56cm spread at
    300dpi means a 90MB string; and if the screen were to send that as a JPEG
    instead, the file would be compressed twice and the second pass would show
    in skin and in a gold hairline.
    """
    image = Image.open(io.BytesIO(data))
    image.load()
    if image.mode != "RGB":
        image = image.convert("RGB")
    return _encode_print_jpeg(image, ppi)


def source_jpeg(path: str, long_edge: int = 0) -> bytes:
    """The pixels an album export draws with — the FILE, at export quality.

    /thumb is the wrong door for this and always was: it serves quality 82
    and, on a raw frame, the preview the camera buried in it rather than the
    picture. Right for finding a photograph in a grid of six hundred, wrong
    for a 56cm spread, where both decisions are visible on paper.

    `long_edge` is a CAP, never a target. The screen asks for the size the
    place will actually take, so a 45MP frame landing in a small square is
    resized HERE, by Lanczos, instead of by the browser while it draws — and
    a file smaller than its place stays its own size. Nothing here upscales:
    an enlargement invented at this level would look exactly like resolution
    the file never had, and the print check upstairs is what must say so.
    """
    image = common.load_image(path)
    cap = int(long_edge or 0)
    if cap > 0 and max(image.size) > cap:
        scale = cap / float(max(image.size))
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )
    output = io.BytesIO()
    image.save(output, "JPEG", quality=96, subsampling=0, optimize=True)
    return output.getvalue()
