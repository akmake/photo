"""Does the learned detector actually find the blemishes? Visual proof."""

import os
import sys

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

import common
import masks
import abpn_local

SRC, OUT_DIR = sys.argv[1], sys.argv[2]
W = os.path.join(os.path.dirname(__file__), "models", "joint_20210926.pth")

det, inp = abpn_local.load(W)
print("LOADED STRICT OK - both networks reconstructed")

rgb = common.to_np(common.load_image(SRC))
skin = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin.sum()))
box = common.region_box(skin, int(face_d * 0.45), rgb.shape)
x0, y0, x1, y1 = box
crop = rgb[y0:y1, x0:x1]
h, w = crop.shape[:2]
print(f"face crop {w}x{h}, face_d={face_d:.0f}")

# the pipeline normalises the ROI to [-1, 1]
x = torch.from_numpy(crop.astype(np.float32) / 127.5 - 1.0).permute(2, 0, 1)[None]

with torch.no_grad():
    std = F.interpolate(x, size=(768, 768), mode="bilinear", align_corners=True)
    logits = det(std)
    prob = torch.sigmoid(logits)
    prob = F.interpolate(prob, size=(h, w), mode="nearest")

p = prob[0, 0].numpy()
print(f"detector output: min={p.min():.3f} max={p.max():.3f} mean={p.mean():.4f}")
print(f"  pixels >=0.35: {int((p >= 0.35).sum())}   >=0.5: {int((p >= 0.5).sum())}")

# panels: face | detector heat | detected regions marked
heat = cv2.applyColorMap((np.clip(p, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
heat = heat[:, :, ::-1]
marked = crop.copy()
marked[p >= 0.35] = [255, 0, 0]

z = 3
panels = [
    Image.fromarray(a).resize((w * z, h * z), Image.LANCZOS)
    for a in (crop, heat, marked)
]
pw, ph = panels[0].size
combo = Image.new("RGB", (pw * 3 + 24, ph), (18, 18, 22))
for i, pn in enumerate(panels):
    combo.paste(pn, (i * (pw + 12), 0))
combo.save(f"{OUT_DIR}/80-detector.jpg", quality=95)
print("-> 80-detector.jpg  (face | detector heatmap | flagged)")
