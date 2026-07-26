"""Test-only: native-pixel zoom on each brow — is a lesion there, and what covers it?

Aggregate percentages cannot answer "was THIS mark reachable"; only looking at
the pixels can. Each brow is shown at native resolution beside the protection
region that governs it and the mask the pipeline finally produced.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import masks

SRC = sys.argv[1]
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 100
ZOOM = 8

rgb = common.to_np(common.load_image(SRC))
masks.set_source(rgb)
skin_full = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin_full.sum()))
x0, y0, x1, y1 = common.region_box(skin_full, int(face_d * 0.25), rgb.shape)
crop = rgb[y0:y1, x0:x1]

conf, region, face_c, model = cleanup.confidence(crop, {"strength": STRENGTH})
repair = cleanup.decide(conf, face_c)

small = common.downscale(crop)
faces = masks._face_landmarks(small)
h, w = crop.shape[:2]

protect = np.zeros(crop.shape[:2], np.float32)
eyelid = np.zeros(crop.shape[:2], np.float32)
for lm in faces:
    for name, part in masks.anatomy_parts(small, lm).items():
        big = common.upscale_to(part.astype(np.float32) / 255.0, crop.shape)
        protect = np.maximum(protect, big)
        if name.startswith("eyelid"):
            eyelid = np.maximum(eyelid, big)

hair = masks.get_mask(crop, "hair")
hr = max(3, int(face_c * 0.035)) | 1
hair = cv2.dilate(hair, np.ones((hr, hr), np.uint8))


def wash(base, m, colour, alpha):
    a = np.clip(m, 0, 1)[..., None] * alpha
    return base * (1 - a) + np.array(colour, np.float32) * a


cover = crop.astype(np.float32)
cover = wash(cover, (eyelid > 0.5).astype(np.float32), (255, 40, 40), 0.55)
cover = wash(cover, ((protect > 0.5) & (eyelid <= 0.5)).astype(np.float32), (255, 0, 200), 0.45)
cover = wash(cover, ((hair > 0.5) & (protect <= 0.5)).astype(np.float32), (255, 160, 0), 0.45)
cover = wash(cover, (region <= 0).astype(np.float32) * (protect <= 0.5) * (hair <= 0.5), (255, 240, 0), 0.35)
cover = np.clip(cover, 0, 255).astype(np.uint8)

marked = wash(crop.astype(np.float32), repair.astype(np.float32), (0, 255, 120), 0.85)
marked = np.clip(marked, 0, 255).astype(np.uint8)

nv = np.clip(model.novelty / 6.0, 0, 1)
heat = cv2.applyColorMap((nv * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)[..., ::-1]

for lm in faces:
    for side, idx_set in (("L", masks.LEFT_EYEBROW), ("R", masks.RIGHT_EYEBROW)):
        pts = np.array([[lm[i].x * w, lm[i].y * h] for i in idx_set])
        bx0, by0 = pts.min(0)
        bx1, by1 = pts.max(0)
        pad = (bx1 - bx0) * 0.40
        a, b = int(max(0, bx0 - pad)), int(max(0, by0 - pad * 1.3))
        c, d = int(min(w, bx1 + pad)), int(min(h, by1 + pad * 1.3))
        print(f"\nBROW {side}: crop({a},{b})-({c},{d})  full({a+x0},{b+y0})-({c+x0},{d+y0})")
        print(f"  size {c-a}x{d-b} px at native resolution")
        sel = np.zeros(crop.shape[:2], bool)
        sel[b:d, a:c] = True
        print(f"  eligible skin (region>0): {int((region[sel] > 0).sum())} / {int(sel.sum())} px"
              f"  = {float((region[sel] > 0).mean()) * 100:.0f}%")
        print(f"  covered by eyelid hull  : {float((eyelid[sel] > 0.5).mean()) * 100:.0f}%")
        print(f"  covered by dilated hair : {float((hair[sel] > 0.5).mean()) * 100:.0f}%")
        print(f"  repaired px             : {int((repair[sel] > 0).sum())}")

        panels = []
        for label, image in [
            ("BEFORE (native px)", crop),
            ("novelty", heat),
            ("red=eye+brow hull  orange=hair  yellow=eroded", cover),
            ("green = actually repaired", marked),
        ]:
            p = Image.fromarray(np.asarray(image, np.uint8)[b:d, a:c])
            p = p.resize((p.width * ZOOM, p.height * ZOOM), Image.NEAREST)
            canvas = Image.new("RGB", (p.width, p.height + 34), (18, 18, 22))
            canvas.paste(p, (0, 34))
            ImageDraw.Draw(canvas).text((10, 12), label, fill=(240, 240, 240))
            panels.append(canvas)
        gap = 8
        sheet = Image.new(
            "RGB",
            (sum(p.width for p in panels) + gap * 3, panels[0].height),
            (18, 18, 22),
        )
        xx = 0
        for p in panels:
            sheet.paste(p, (xx, 0))
            xx += p.width + gap
        sheet.save(OUT / f"diag-brow-{side}.jpg", quality=95)
        print("  ->", OUT / f"diag-brow-{side}.jpg", sheet.size)
