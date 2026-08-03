"""Honest evaluation of the skin-smoothing tool on real frames.

For every detected face it emits a strip:
    before | after | change-map | what-was-marked
The change-map is |after-before| amplified, so over-smoothing and spread show.
The mask is drawn as a hairline outline only (no fill), on the before crop.
Faces are upscaled for viewing AFTER smoothing at native resolution, so the
texture you judge is the real output, not an interpolation.
"""

import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import common
import masks
import skin

FRAMES = sys.argv[1:] or [
    "../test-results/skin-reality/321A1791.jpg",
    "../test-results/skin-reality/321A5015.jpg",
    "../test-results/skin-reality/321A5117.jpg",
]
OUT_DIR = "../test-results/skin-eval"
PARAMS = {"strength": 60}          # the tool's own default
VIEW = 460                          # min face height when viewing

try:
    FONT = ImageFont.truetype("arial.ttf", 20)
except Exception:
    FONT = ImageFont.load_default()


def label(pil, text):
    d = ImageDraw.Draw(pil)
    d.rectangle([0, 0, pil.width, 26], fill=(20, 20, 24))
    d.text((6, 3), text, fill=(235, 235, 235), font=FONT)
    return pil


def outline(bgr_or_rgb_crop, mask_crop):
    """Hairline outline of the mask on the crop, no fill (memory: overlays
    never cover content)."""
    base = bgr_or_rgb_crop.copy()
    m = (mask_crop > 0.5).astype(np.uint8) * 255
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(base, cnts, -1, (255, 80, 80), 1)
    return base


def upscale(arr, target_h):
    h = arr.shape[0]
    if h >= target_h:
        return arr
    f = target_h / h
    return cv2.resize(arr, (int(arr.shape[1] * f), int(arr.shape[0] * f)),
                      interpolation=cv2.INTER_NEAREST)


def main():
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    for path in FRAMES:
        name = os.path.splitext(os.path.basename(path))[0]
        rgb = common.to_np(common.load_image(path))
        t0 = time.time()
        out, meta = skin.apply(rgb.copy(), PARAMS)
        dt = (time.time() - t0) * 1000
        print(f"\n{name}: {meta}  ({dt:.0f}ms)")

        # the smoothing region, for the outline (single-face path; groups use
        # per-crop but the marked skin is the same set of pixels)
        skin_m = masks.get_mask(rgb, "face-skin")
        feat = masks.get_mask(rgb, "face-features")
        region = np.clip(skin_m - feat, 0, 1)

        boxes = masks.face_boxes(rgb)
        print(f"  faces detected: {len(boxes)}")
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            b = rgb[y0:y1, x0:x1]
            a = out[y0:y1, x0:x1]
            reg = region[y0:y1, x0:x1]

            diff = np.abs(a.astype(np.int16) - b.astype(np.int16)).sum(2)
            amp = np.clip(diff * 3, 0, 255).astype(np.uint8)
            heat = cv2.applyColorMap(amp, cv2.COLORMAP_INFERNO)
            heat = cv2.cvtColor(heat, cv2.COLOR_BGR2RGB)
            marked = outline(b, reg)

            th = max(VIEW, b.shape[0])
            panels = [upscale(x, th) for x in (b, a, heat, marked)]
            H = max(p.shape[0] for p in panels)
            strip = np.full((H + 26, sum(p.shape[1] for p in panels) + 3 * 8, 3),
                            20, np.uint8)
            x = 0
            names = ["before", "after (str 60)", "change x3", "marked skin"]
            for p, nm in zip(panels, names):
                pil = label(Image.fromarray(p), nm)
                pa = np.asarray(pil)
                strip[:pa.shape[0], x:x + pa.shape[1]] = pa
                x += pa.shape[1] + 8
            meanchg = float(diff[reg > 0.5].mean()) if (reg > 0.5).any() else 0
            Image.fromarray(strip).save(
                f"{OUT_DIR}/{name}-face{i}.jpg", quality=95)
            print(f"  face{i} {x1-x0}x{y1-y0}px  mean change in skin: "
                  f"{meanchg:.1f}/765")
    print(f"\nsaved to {OUT_DIR}")


if __name__ == "__main__":
    main()
