"""Bridge for visually verifying the JS global tools outside a browser.

dump:    image -> raw RGBA (+ width/height header)
restore: raw RGBA -> viewable image
"""

import struct
import sys

import numpy as np
from PIL import Image, ImageOps

mode = sys.argv[1]

if mode == "dump":
    src, dst = sys.argv[2], sys.argv[3]
    maxdim = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    img = ImageOps.exif_transpose(Image.open(src)).convert("RGBA")
    if maxdim and max(img.size) > maxdim:
        s = maxdim / max(img.size)
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    with open(dst, "wb") as f:
        f.write(struct.pack("<II", img.width, img.height))
        f.write(np.asarray(img, dtype=np.uint8).tobytes())
    print(f"dumped {img.width}x{img.height}")

elif mode == "restore":
    src, dst = sys.argv[2], sys.argv[3]
    with open(src, "rb") as f:
        w, h = struct.unpack("<II", f.read(8))
        arr = np.frombuffer(f.read(), dtype=np.uint8).reshape(h, w, 4)
    Image.fromarray(arr, "RGBA").convert("RGB").save(dst, quality=95)
    print(f"restored {w}x{h} -> {dst}")
