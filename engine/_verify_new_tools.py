"""Evidence for blush / eye-sparkle / hair-tones. Run from engine/.

Not a smoke test. Each tool has a claim that the research pinned a number to,
and this measures that number rather than trusting the picture:

  blush       the blushed skin must stay within 10-15 R points of the skin
              around it, or it reads as makeup applied in post
  eye-sparkle the pupil and limbus must get DARKER while the lit iris edge gets
              brighter — if everything moved one way it is a flat lift
  hair-tones  a*/b* must move while L* essentially does not, or texture is
              being written when only colour should be

Writes whole-face and whole-frame images, never a cherry-picked crop.
"""

import os
import sys

import cv2
import numpy as np

import blush
import common
import eyes
import hairtone
import local_color
import masks
import render

SRC = r"C:\Users\yosef dahan\Downloads\321A5247.JPG"
OUT = r"c:\Users\yosef dahan\Documents\GitHub\photo\test-results\321A5247\new-tools"
os.makedirs(OUT, exist_ok=True)


def face_crop(rgb):
    h, w = rgb.shape[:2]
    return rgb[int(0.26 * h):int(0.58 * h), int(0.48 * w):int(0.64 * w)]


def eye_crop(rgb, lm):
    h, w = rgb.shape[:2]
    pts = np.array([[lm[i].x * w, lm[i].y * h] for i in
                    list(masks.LEFT_EYE) + list(masks.RIGHT_EYE)], np.float32)
    pad = int((pts[:, 0].max() - pts[:, 0].min()) * 0.25)
    return rgb[max(0, int(pts[:, 1].min()) - pad):int(pts[:, 1].max()) + pad,
               max(0, int(pts[:, 0].min()) - pad):int(pts[:, 0].max()) + pad]


def save(name, rgb):
    cv2.imwrite(os.path.join(OUT, name), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR),
                [cv2.IMWRITE_JPEG_QUALITY, 95])


def pair(name, before, after, scale=1):
    a, b = before, after
    if scale != 1:
        a = cv2.resize(a, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        b = cv2.resize(b, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    save(name, np.hstack([a, b]))


rgb = common.to_np(common.load_image(SRC))
masks.set_source(rgb)
faces = masks._face_landmarks(rgb)
lm = faces[0]
print(f"image {rgb.shape[1]}x{rgb.shape[0]}   faces={len(faces)}   landmarks={len(lm)}")

# =========================================================================
print("\n--- BLUSH -------------------------------------------------------")
b_out, b_meta = blush.apply(rgb, {"strength": 60, "size": 50, "warmth": 35})
print(" meta:", b_meta)

band = blush._cheek_band(rgb, faces, 1.0)
skin = masks.get_mask(rgb, "face-skin")
feat = masks.get_mask(rgb, "face-features")
region = np.clip(band * skin * (1.0 - feat), 0, 1)

# THE measured claim: R deviation of blushed skin vs the skin ringing it
core = region > 0.6
ring = (cv2.dilate((region > 0.15).astype(np.uint8),
                   np.ones((61, 61), np.uint8)) > 0) & (region < 0.05) & (skin > 0.5)
if core.sum() > 50 and ring.sum() > 50:
    r_before = float(rgb[..., 0][core].mean())
    r_after = float(b_out[..., 0][core].mean())
    r_ring = float(b_out[..., 0][ring].mean())
    print(f" R in blushed core : {r_before:.1f} -> {r_after:.1f}   (+{r_after-r_before:.1f})")
    print(f" R in skin around  : {r_ring:.1f}")
    print(f" deviation from surrounding skin = {abs(r_after-r_ring):.1f} R points"
          f"   [ceiling 10-15]  {'PASS' if abs(r_after-r_ring) <= 15 else 'FAIL'}")
    lab_b = local_color.to_lab(rgb)[..., 0][core].mean()
    lab_a = local_color.to_lab(b_out)[..., 0][core].mean()
    print(f" L* in core        : {lab_b:.2f} -> {lab_a:.2f}   (must be ~0: "
          f"{'PASS' if abs(lab_a-lab_b) < 1.5 else 'FAIL'})")

save("blush-mask.jpg", (np.dstack([region, region, region]) * 255).astype(np.uint8)[
    ::4, ::4])
pair("blush-face.jpg", face_crop(rgb), face_crop(b_out))
save("blush-full.jpg", b_out[::3, ::3])

# =========================================================================
print("\n--- EYE SPARKLE -------------------------------------------------")
e_out, e_meta = eyes.apply(rgb, {"strength": 65, "whites": 45, "sparkle": 55})
print(" meta:", e_meta)

# THE measured claim: pupil/limbus DOWN, lit iris edge UP.
# Measured on a box around the iris — an mgrid over the whole 20MP frame is
# 300MB of coordinates to look at a 20px circle.
h, w = rgb.shape[:2]
ctr = np.array([lm[468].x * w, lm[468].y * h], np.float32)
rim = np.array([[lm[i].x * w, lm[i].y * h] for i in (469, 470, 471, 472)], np.float32)
rad = float(np.mean(np.linalg.norm(rim - ctr, axis=1)))
bx0, by0 = int(ctr[0] - rad * 2), int(ctr[1] - rad * 2)
bx1, by1 = int(ctr[0] + rad * 2), int(ctr[1] + rad * 2)
yy, xx = np.mgrid[by0:by1, bx0:bx1].astype(np.float32)
dist = np.sqrt((xx - ctr[0]) ** 2 + (yy - ctr[1]) ** 2)
L0 = local_color.to_lab(rgb[by0:by1, bx0:bx1])[..., 0]
L1 = local_color.to_lab(e_out[by0:by1, bx0:bx1])[..., 0]
for label, sel in (
    ("pupil      ", dist < rad * 0.40),
    ("limbus ring", (dist > rad * 0.85) & (dist < rad * 1.02)),
    ("iris body  ", (dist > rad * 0.45) & (dist < rad * 0.80)),
):
    if sel.sum() > 4:
        print(f" L* {label}: {L0[sel].mean():7.2f} -> {L1[sel].mean():7.2f}"
              f"   ({L1[sel].mean()-L0[sel].mean():+.2f})")
print(f" iris radius = {rad:.1f} px")
pair("eyes-both.jpg", eye_crop(rgb, lm), eye_crop(e_out, lm), scale=2)
pair("eyes-face.jpg", face_crop(rgb), face_crop(e_out))

# =========================================================================
print("\n--- HAIR TONES --------------------------------------------------")
hr_out, h_meta = hairtone.apply(
    rgb, {"strength": 60, "warmth": 55, "shine": 45, "richness": 45})
print(" meta:", h_meta)

hair = masks.get_mask(rgb, "hair")
sel = hair > 0.6
lab0 = local_color.to_lab(rgb)
lab1 = local_color.to_lab(hr_out)
if sel.sum() > 100:
    for i, nm in ((0, "L*"), (1, "a*"), (2, "b*")):
        print(f" {nm} in hair : {lab0[...,i][sel].mean():7.2f} -> "
              f"{lab1[...,i][sel].mean():7.2f}   "
              f"({lab1[...,i][sel].mean()-lab0[...,i][sel].mean():+.2f})")
    # texture must survive: high-frequency energy inside the hair
    def hf(x):
        g = local_color.to_lab(x)[..., 0]
        return float(np.abs(g - cv2.GaussianBlur(g, (0, 0), 1.5))[sel].mean())
    print(f" hair texture energy: {hf(rgb):.3f} -> {hf(hr_out):.3f}   "
          f"({100*(hf(hr_out)/max(hf(rgb),1e-6)-1):+.1f}%)")

save("hair-mask.jpg", (np.dstack([hair, hair, hair]) * 255).astype(np.uint8)[::4, ::4])
pair("hair-face.jpg", face_crop(rgb), face_crop(hr_out))
save("hair-full.jpg", hr_out[::3, ::3])

# =========================================================================
print("\n--- ALL THREE, AND THE FULL RECIPE ------------------------------")
masks.clear_source()
img = common.load_image(SRC)

three = [
    {"toolId": "blush", "params": {"strength": 45, "size": 50, "warmth": 35}},
    {"toolId": "eye-sparkle", "params": {"strength": 50, "whites": 40, "sparkle": 45}},
    {"toolId": "hair-tones", "params": {"strength": 45, "warmth": 40, "shine": 35,
                                        "richness": 40}},
]
out3, m3 = render.render(img, three)
for s in m3["steps"]:
    print(f"   {s['tool']:<12} {s['ms']:>6} ms   {s['meta']}")
out3.save(os.path.join(OUT, "three-tools.jpg"), quality=96, subsampling=0)
pair("three-face.jpg", face_crop(rgb), face_crop(common.to_np(out3)))

full = [
    {"toolId": "face-retouch", "params": {"strength": 55}},
    {"toolId": "skin-cleanup", "params": {"strength": 50}},
    {"toolId": "skin", "params": {"strength": 35}},
] + three + [
    {"toolId": "tone-color", "params": {"shadows": 18, "blacks": 8, "highlights": -22,
                                        "whites": -12, "contrast": 8, "vibrance": 12,
                                        "saturation": 3, "temperature": -4}},
    {"toolId": "dimension", "params": {"clarity": 14, "vignette": 12}},
    {"toolId": "color-grade", "params": {"shadowsWarm": -6, "highlightsWarm": 4}},
    {"toolId": "sharpen", "params": {"amount": 30, "radius": 20}},
]
outF, mF = render.render(img, full)
print(f"\n full recipe, {len(full)} tools:")
for s in mF["steps"]:
    print(f"   {s['tool']:<14} {s['ms']:>6} ms")
outF.save(os.path.join(OUT, "full-recipe-with-new-tools.jpg"), quality=96, subsampling=0)
pair("final-face.jpg", face_crop(rgb), face_crop(common.to_np(outF)))
print("\nwrote ->", OUT)
