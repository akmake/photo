"""Full DAMO local-retouch pipeline: detect blemishes -> inpaint them."""

import os
import sys

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

import common
import masks
import abpn_local

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
W = os.path.join(os.path.dirname(__file__), "models", "joint_20210926.pth")

det, inpnet = abpn_local.load(W)

rgb = common.to_np(common.load_image(SRC))
skin = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin.sum()))
box = common.region_box(skin, int(face_d * 0.45), rgb.shape)
x0, y0, x1, y1 = box
crop = rgb[y0:y1, x0:x1]
h, w = crop.shape[:2]

x = torch.from_numpy(crop.astype(np.float32) / 127.5 - 1.0).permute(2, 0, 1)[None]

with torch.no_grad():
    std = F.interpolate(x, size=(768, 768), mode="bilinear", align_corners=True)
    prob = torch.sigmoid(det(std))
    prob = F.interpolate(prob, size=(h, w), mode="nearest")

    # published thresholding, then invert: 1 = keep, 0 = hole to fill
    hard_low = (prob >= 0.35).float()
    hard_high = (prob >= 0.5).float()
    m = prob * (1 - hard_high) + hard_high
    m = m * hard_low
    mask = 1.0 - m

    # the net downsamples 6x, so pad to a multiple of 64
    ph = (64 - h % 64) % 64
    pw = (64 - w % 64) % 64
    xi = F.pad(x, (0, pw, 0, ph))
    mi = F.pad(mask, (0, pw, 0, ph), value=1.0)

    holed = xi * mi
    out = inpnet(holed, mi)
    comp = holed + (1 - mi) * out
    comp = comp[:, :, :h, :w]

res = ((comp[0].permute(1, 2, 0).numpy() + 1.0) / 2.0)
res = np.clip(res, 0, 1) * 255.0
holes = int((mask < 0.5).sum())
print(f"holes filled: {holes} px")

z = 4
# focus on the lower face where the marks are
ys, xs = np.where(skin > 0.5)
ly0 = int((ys.min() + (ys.max() - ys.min()) * 0.40)) - y0
ly1 = min(h, int(ys.max() - y0) + 40)
lx0, lx1 = max(0, int(xs.min() - x0) - 20), min(w, int(xs.max() - x0) + 20)

a = Image.fromarray(crop[ly0:ly1, lx0:lx1])
b = Image.fromarray(res[ly0:ly1, lx0:lx1].astype(np.uint8))
size = (a.width * z, a.height * z)
a, b = a.resize(size, Image.LANCZOS), b.resize(size, Image.LANCZOS)
combo = Image.new("RGB", (size[0] * 2 + 16, size[1]), (18, 18, 22))
combo.paste(a, (0, 0))
combo.paste(b, (size[0] + 16, 0))
combo.save(f"{OUT_DIR}/81-local-retouch.jpg", quality=96)
print("-> 81-local-retouch.jpg  (left=original, right=detect+inpaint)")
