"""Why does the skin work look good on 321A5247 and bad on 321A4093?

Compares the two frames on the quantities the pipeline actually depends on,
rather than on impression. The hypothesis being tested is that the difference is
SCALE: below some face size there is no pore texture left to separate, so
"frequency separation" is separating sensor and JPEG noise, and healing is
grafting that noise around.

usage: python -u _exp_why_4093.py
"""

import os

import cv2
import numpy as np

import cleanup
import common
import local_color
import masks
import render

PAIR = [
    ("321A5247", r"C:\Users\yosef dahan\Downloads\321A5247.JPG"),
    ("321A4093", r"C:\Users\yosef dahan\Downloads\321A4093.JPG"),
]
OUT = r"c:\Users\yosef dahan\Documents\GitHub\photo\test-results\_compare"
os.makedirs(OUT, exist_ok=True)

RECIPE = [
    {"toolId": "face-retouch", "params": {"strength": 55}},
    {"toolId": "skin-cleanup", "params": {"strength": 50}},
    {"toolId": "skin", "params": {"strength": 35}},
]

rows = []
for name, path in PAIR:
    img = common.load_image(path)
    rgb = common.to_np(img)
    h, w = rgb.shape[:2]
    masks.set_source(rgb)

    skin = masks.get_mask(rgb, "face-skin")
    feat = masks.get_mask(rgb, "face-features")
    faces = masks._face_landmarks(rgb)
    face_d = float(np.sqrt(float(skin.sum())))
    sel = np.clip(skin - feat, 0, 1) > 0.6

    lab = local_color.to_lab(rgb)
    L = lab[..., 0]

    # Texture energy at two scales. sigma 1.0 is pore/noise scale; sigma 3.0 is
    # the scale real skin structure lives at. On a face too small to resolve
    # pores the 1.0 band is almost entirely noise, so the RATIO between them is
    # the honest scale test.
    fine = float(np.abs(L - cv2.GaussianBlur(L, (0, 0), 1.0))[sel].mean())
    mid = float(np.abs(L - cv2.GaussianBlur(L, (0, 0), 3.0))[sel].mean())

    # what does the same recipe do to it?
    out, meta = render.render(img, RECIPE)
    arr = common.to_np(out)
    fine_after = float(
        np.abs(local_color.to_lab(arr)[..., 0]
               - cv2.GaussianBlur(local_color.to_lab(arr)[..., 0], (0, 0), 1.0))[sel].mean()
    )
    spots = next((s["meta"] for s in meta["steps"] if s["tool"] == "skin-cleanup"), {})

    # skin-only crop, before and after, at the SAME on-screen face size so the
    # two images can be judged against each other rather than against the frame
    box = common.region_box(skin, int(face_d * 0.45), rgb.shape)
    x0, y0, x1, y1 = box
    a, b = rgb[y0:y1, x0:x1], arr[y0:y1, x0:x1]
    k = 900.0 / max(1, a.shape[1])
    a = cv2.resize(a, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    b = cv2.resize(b, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    cv2.imwrite(os.path.join(OUT, f"{name}-before-after.jpg"),
                cv2.cvtColor(np.hstack([a, b]), cv2.COLOR_RGB2BGR),
                [cv2.IMWRITE_JPEG_QUALITY, 96])

    masks.clear_source()
    rows.append({
        "name": name, "mp": w * h / 1e6, "faces": len(faces), "face_d": face_d,
        "face_pct": 100.0 * float(sel.mean()), "fine": fine, "mid": mid,
        "ratio": fine / max(mid, 1e-6), "fine_after": fine_after,
        "kept": 100.0 * fine_after / max(fine, 1e-6),
        "spots": spots.get("spotsRemoved", 0), "px": spots.get("correctedPx", 0),
    })

hdr = (f"{'frame':<11}{'faces':>6}{'face_d':>8}{'skin%':>7}"
       f"{'fine':>7}{'mid':>7}{'f/m':>7}{'kept':>7}{'spots':>7}{'px':>7}")
print(hdr)
print("-" * len(hdr))
for r in rows:
    print(f"{r['name']:<11}{r['faces']:>6}{r['face_d']:>8.0f}{r['face_pct']:>7.2f}"
          f"{r['fine']:>7.2f}{r['mid']:>7.2f}{r['ratio']:>7.2f}"
          f"{r['kept']:>6.0f}%{r['spots']:>7}{r['px']:>7}")

a, b = rows[0], rows[1]
print(f"\nface_d ratio       : {a['face_d']/b['face_d']:.2f}x  "
      f"({a['name']} is that much bigger)")
print(f"fine/mid ratio     : {a['ratio']:.2f} vs {b['ratio']:.2f}")
print(f"MIN_FACE_PX gates  : cleanup {cleanup.MIN_FACE_PX}, "
      f"and {b['name']} is at {b['face_d']:.0f}")
print("\nwrote ->", OUT)
