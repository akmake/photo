"""The engine's two jobs in an album export: serving the pixels of the real
file, and the final encoding of a print-ready sRGB JPEG."""

import base64
import io

from PIL import Image, ImageCms, ImageFilter

import common
import icc_profiles
import raw


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


_SRGB = ImageCms.createProfile("sRGB")
_ADOBE_RGB = icc_profiles.adobe_rgb_1998_icc()

# Output sharpening, per paper — the last of Fraser & Schewe's three passes,
# applied at the size the photo is printed. Radius scales with the resolution
# so the halo stays ~1/100 inch, what the eye resolves at reading distance
# (measured: a 4px edge band at 300 PPI). The paper changes the AMOUNT, not
# the width: matte and fine-art papers spread the ink and want more; gloss and
# luster less. THESE AMOUNTS ARE A STARTING POINT, NOT YET JUDGED ON A PRINTED
# PAGE — see docs/ALBUM-PRINT-TIMELINE.md.
_OUTPUT_SHARPEN = {
    "gloss": (0.9, 70),
    "luster": (0.9, 80),
    "matte": (0.9, 120),
    "fine-art": (0.9, 140),
}


def _embedded_profile(path: str):
    """The colour space the file says it is in, as ICC bytes — or None for
    sRGB and for files that say nothing (which ARE sRGB by convention).

    A camera set to Adobe RGB usually embeds no profile; it marks the file
    instead (EXIF ColorSpace = uncalibrated, interoperability index R03).
    """
    if raw.is_raw(path):
        return None  # the decoder hands over sRGB
    with Image.open(path) as image:
        icc = image.info.get("icc_profile")
        if icc:
            try:
                name = ImageCms.getProfileDescription(
                    ImageCms.ImageCmsProfile(io.BytesIO(icc))
                )
            except Exception:  # noqa: BLE001 — unreadable profile: do not guess
                return None
            return None if "srgb" in name.lower().replace(" ", "") else icc
        try:
            exif = image.getexif()
            if exif.get_ifd(0x8769).get(0xA001) == 0xFFFF:
                if exif.get_ifd(0xA005).get(0x0001) == "R03":
                    return _ADOBE_RGB
        except Exception:  # noqa: BLE001
            pass
    return None


def to_srgb(image, icc: bytes):
    """Convert pixels from the space `icc` describes into sRGB — the numbers
    change so the COLOUR stays. Labelling them sRGB without converting is the
    bug this exists to stop: an Adobe RGB frame printed that way comes out dull."""
    transform = ImageCms.buildTransform(
        ImageCms.ImageCmsProfile(io.BytesIO(icc)),
        _SRGB,
        "RGB",
        "RGB",
        renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
        flags=ImageCms.Flags.BLACKPOINTCOMPENSATION,
    )
    return ImageCms.applyTransform(image.convert("RGB"), transform)


def output_sharpen(image, paper: str, ppi: int):
    setting = _OUTPUT_SHARPEN.get(paper or "")
    if not setting:
        return image
    radius, percent = setting
    return image.filter(ImageFilter.UnsharpMask(
        radius=radius * max(72, int(ppi)) / 300.0, percent=percent, threshold=2,
    ))


def source_jpeg(path: str, long_edge: int = 0, paper: str = "", ppi: int = 300) -> bytes:
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
    icc = _embedded_profile(path)
    if icc:
        image = to_srgb(image, icc)
    cap = int(long_edge or 0)
    if cap > 0 and max(image.size) > cap:
        scale = cap / float(max(image.size))
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )
    # Sharpened only at the size it is printed: a photo smaller than its place
    # is enlarged later, in the browser, and would carry the halo up with it.
    if paper and cap > 0 and max(image.size) >= cap * 0.9:
        image = output_sharpen(image, paper, ppi)
    output = io.BytesIO()
    image.save(output, "JPEG", quality=96, subsampling=0, optimize=True)
    return output.getvalue()
