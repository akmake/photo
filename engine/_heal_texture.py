"""Test-only: is the healed area missing skin texture?

Measures high-frequency energy inside the repair against the clean skin ring
around it.  A ratio near 1.0 means the repair carries the same pore texture as
its neighbourhood; near 0 means a smooth plastic patch.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

import common

OUT = Path(sys.argv[1])
mask = cv2.imread(str(OUT / "repair-mask.png"), cv2.IMREAD_GRAYSCALE)
binary = (mask > 127).astype(np.uint8)

ring = cv2.dilate(binary, np.ones((21, 21), np.uint8)) - cv2.dilate(
    binary, np.ones((7, 7), np.uint8)
)
inside = binary > 0
around = ring > 0

SRC = "C:/Users/yosef dahan/Downloads/321A4093.JPG"
for label, path in [
    ("original", SRC),
    ("Telea", OUT / "full-telea.jpg"),
    ("Navier-Stokes", OUT / "full-navier-stokes.jpg"),
    ("patch-frequency", OUT / "full-patch-frequency.jpg"),
    ("inpaint-texture", OUT / "full-inpaint-texture.jpg"),
]:
    if not Path(path).exists():
        continue
    rgb = common.to_np(common.load_image(str(path)))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    high = gray - cv2.GaussianBlur(gray, (0, 0), sigmaX=1.6)
    energy_in = float(high[inside].std())
    energy_ring = float(high[around].std())
    print(
        f"{label:>16}  texture inside={energy_in:5.2f}  ring={energy_ring:5.2f}  "
        f"ratio={energy_in / energy_ring:4.2f}"
    )
