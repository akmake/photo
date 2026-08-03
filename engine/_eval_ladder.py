"""Push the skin tool to its ceiling on one cheek, to separate 'timid default'
from 'weak operation'. Native-res cheek crop, 2x nearest-neighbour view."""
import os
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

import common
import masks
import skin

SRC = "../test-results/skin-reality/321A1791.jpg"
OUT = "../test-results/skin-eval/ladder.jpg"
try:
    FONT = ImageFont.truetype("arial.ttf", 22)
except Exception:
    FONT = ImageFont.load_default()

LADDER = [
    ("original", None),
    ("default s60 e50 c50", {"strength": 60}),
    ("s100 e50", {"strength": 100, "evenness": 50}),
    ("s100 e100", {"strength": 100, "evenness": 100}),
    ("s100 e100 c100", {"strength": 100, "evenness": 100, "scale": 100}),
    ("s100 e100 c100 tex40", {"strength": 100, "evenness": 100, "scale": 100, "texture": 40}),
]

rgb = common.to_np(common.load_image(SRC))
# locate the largest face, take a cheek/forehead crop from it
boxes = masks.face_boxes(rgb)
boxes.sort(key=lambda b: (b[2]-b[0])*(b[3]-b[1]), reverse=True)
x0, y0, x1, y1 = boxes[0]
w, h = x1 - x0, y1 - y0
# cheek band: middle-vertical, left-cheek third
cx0 = x0 + int(w * 0.18); cx1 = x0 + int(w * 0.62)
cy0 = y0 + int(h * 0.40); cy1 = y0 + int(h * 0.80)

tiles = []
for name, p in LADDER:
    if p is None:
        out = rgb
    else:
        out, _ = skin.apply(rgb.copy(), p)
    crop = out[cy0:cy1, cx0:cx1]
    crop = cv2.resize(crop, (crop.shape[1]*2, crop.shape[0]*2),
                      interpolation=cv2.INTER_NEAREST)
    pil = Image.fromarray(crop)
    d = ImageDraw.Draw(pil)
    d.rectangle([0, 0, pil.width, 28], fill=(20, 20, 24))
    d.text((6, 4), name, fill=(240, 240, 240), font=FONT)
    tiles.append(np.asarray(pil))

# 3 cols x 2 rows
cols = 3
rows = (len(tiles) + cols - 1) // cols
th, tw = tiles[0].shape[:2]
grid = np.full((rows*th + (rows-1)*8, cols*tw + (cols-1)*8, 3), 20, np.uint8)
for i, t in enumerate(tiles):
    r, c = divmod(i, cols)
    grid[r*(th+8):r*(th+8)+th, c*(tw+8):c*(tw+8)+tw] = t
Image.fromarray(grid).save(OUT, quality=95)
print("saved", OUT, grid.shape)
