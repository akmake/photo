"""Final encoding for print-ready sRGB album JPEGs."""

import base64
import io

from PIL import ImageCms

import common


def finalize_srgb_jpeg(image_data: str, ppi: int = 300):
    image = common.b64_to_image(image_data)
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
    payload = base64.b64encode(output.getvalue()).decode("ascii")
    return payload, {
        "widthPx": image.width,
        "heightPx": image.height,
        "ppi": ppi,
        "quality": 97,
        "subsampling": "4:4:4",
        "icc": "sRGB",
    }
