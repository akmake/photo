"""How much should the skin stack change a face? Render the ladder and look.

The three skin tools each have their own `strength`, and they STACK — a recipe
can be at 55/50/35 and no single number tells the photographer how far the face
has moved. This renders a ladder of coherent levels so the amount can be chosen
by eye instead of guessed, and measures how much texture each level costs.

usage: python -u _exp_strength_ladder.py <image> <out-dir-name>
"""

import os
import sys

import cv2
import numpy as np

import common
import local_color
import masks
import render

SRC = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\yosef dahan\Downloads\321A5247.JPG"
NAME = sys.argv[2] if len(sys.argv) > 2 else "ladder"
OUT = os.path.join(
    r"c:\Users\yosef dahan\Documents\GitHub\photo\test-results", NAME, "strength-ladder"
)
os.makedirs(OUT, exist_ok=True)

# One dial, three tools. The ratios are held fixed and only the level moves, so
# the levels are comparable and the photographer picks one number.
LEVELS = {
    "00-off":     (0, 0, 0),
    "01-natural": (25, 30, 12),
    "02-light":   (40, 40, 22),
    "03-medium":  (55, 50, 35),   # what the earlier render used
    "04-strong":  (72, 62, 50),
    "05-max":     (90, 80, 70),
}

img = common.load_image(SRC)
rgb = common.to_np(img)
h, w = rgb.shape[:2]
print(f"{os.path.basename(SRC)}  {w}x{h}")

masks.set_source(rgb)
skin = masks.get_mask(rgb, "face-skin")
feat = masks.get_mask(rgb, "face-features")
face_d = float(np.sqrt(float(skin.sum())))
faces = masks._face_landmarks(rgb)
print(f"face_d = {face_d:.0f} px, faces = {len(faces)}")

# crop to the face for the comparison strip
box = common.region_box(skin, int(face_d * 0.45), rgb.shape)
x0, y0, x1, y1 = box
# texture is measured on skin only, features excluded — a sharp eyelash would
# otherwise mask the loss of pores
tex_sel = (np.clip(skin - feat, 0, 1) > 0.6)


def texture_energy(x):
    g = local_color.to_lab(x)[..., 0]
    return float(np.abs(g - cv2.GaussianBlur(g, (0, 0), 1.5))[tex_sel].mean())


base_tex = texture_energy(rgb)
print(f"\n{'level':<12}{'params':<18}{'skin texture':>14}{'kept':>8}")
print(f"{'original':<12}{'-':<18}{base_tex:>14.3f}{'100%':>8}")

crops = []
for name, (retouch, cleanup_s, smooth) in LEVELS.items():
    recipe = []
    if retouch:
        recipe.append({"toolId": "face-retouch", "params": {"strength": retouch}})
    if cleanup_s:
        recipe.append({"toolId": "skin-cleanup", "params": {"strength": cleanup_s}})
    if smooth:
        recipe.append({"toolId": "skin", "params": {"strength": smooth}})
    out, _ = render.render(img, recipe) if recipe else (img, {})
    arr = common.to_np(out)
    t = texture_energy(arr)
    print(f"{name:<12}{f'{retouch}/{cleanup_s}/{smooth}':<18}{t:>14.3f}"
          f"{100*t/base_tex:>7.0f}%")
    arr = arr[y0:y1, x0:x1]
    cv2.putText(arr, name[3:], (12, 46), cv2.FONT_HERSHEY_SIMPLEX,
                max(0.8, face_d / 420), (255, 255, 255), 2, cv2.LINE_AA)
    crops.append(arr)
    cv2.imwrite(os.path.join(OUT, f"{name}.jpg"),
                cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])

row = np.hstack(crops)
scale = min(1.0, 2600.0 / row.shape[1])
row = cv2.resize(row, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(OUT, "ladder.jpg"), cv2.cvtColor(row, cv2.COLOR_RGB2BGR),
            [cv2.IMWRITE_JPEG_QUALITY, 95])
print("\nwrote ->", OUT)
