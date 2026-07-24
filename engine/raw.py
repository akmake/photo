"""RAW decoding via rawpy (LibRaw).

The browser cannot display a RAW file, so the engine decodes it and serves a
preview. In the packaged Electron app this reads straight from disk by path —
far faster than shipping 30MB of bytes over the wire.
"""

import io

import rawpy
from PIL import Image

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


def decode_bytes(data: bytes, max_dim: int = 0) -> Image.Image:
    with rawpy.imread(io.BytesIO(data)) as r:
        rgb = r.postprocess(
            use_camera_wb=True,  # honour the camera's white balance
            no_auto_bright=False,
            output_bps=8,
        )
    img = Image.fromarray(rgb)
    if max_dim and max(img.size) > max_dim:
        s = max_dim / max(img.size)
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    return img


def decode_path(path: str, max_dim: int = 0) -> Image.Image:
    with open(path, "rb") as f:
        return decode_bytes(f.read(), max_dim)
