"""One image, every item on the request list. No variants, no contact sheet.

Each tool is annotated with the request-list item it serves, so the recipe IS
the checklist. Amounts are chosen so the stack stays usable: oil-paint and glow
are stylistic effects that erase a portrait at full strength, so they run low
enough to read as finishing rather than as a filter.
"""

import os

import cv2
import numpy as np

import common
import masks
import presets
import render

SRC = r"C:\Users\yosef dahan\Downloads\321A4093.JPG"
OUT = r"c:\Users\yosef dahan\Documents\GitHub\photo\test-results\_final"
os.makedirs(OUT, exist_ok=True)

RECIPE = [
    # 2 + 5  הורדת ליכלוכים · ניקיון העור
    # skin-cleanup is OFF pending rework (presets.SKIN_CLEANUP_ENABLED) — its
    # repairs read as patches. face-retouch alone carries these two items for
    # now, which means small marks survive rather than being badly healed.
    {"toolId": "face-retouch", "params": {"strength": 25}},
    # 6  החלקת עור עדינה
    {"toolId": "skin", "params": {"strength": 12}},
    # 7  סומק ורודם
    {"toolId": "blush", "params": {"strength": 42, "size": 50, "warmth": 35}},
    # 8  ברק בעיניים
    {"toolId": "eye-sparkle", "params": {"strength": 50, "whites": 38, "sparkle": 45}},
    # 10  גוונים בשיער
    {"toolId": "hair-tones", "params": {"strength": 45, "warmth": 40, "shine": 35,
                                        "richness": 40}},
    # 12  טשטוש לרקע
    {"toolId": "background-blur", "params": {"amount": 45, "feather": 45, "bokeh": 55}},
    # 1 + 3 + 4  שרופים · שדואו/בלאק · הייליט/וויט
    {"toolId": "tone-color", "params": {"highlights": -26, "whites": -16,
                                        "shadows": 22, "blacks": 10,
                                        "contrast": 8, "vibrance": 14,
                                        "saturation": 3, "temperature": -3}},
    # 11  תלת מימדיות
    {"toolId": "dimension", "params": {"clarity": 14, "vignette": 14}},
    # 9  צבעוניות
    {"toolId": "color-grade", "params": {"shadowsWarm": -5, "highlightsWarm": 6}},
    # 13  נקודת אור טבעית
    {"toolId": "light-point", "params": {"strength": 28, "x": 72, "y": 22,
                                         "size": 55, "warmth": 70}},
    # 16  גלואו
    {"toolId": "glow", "params": {"amount": 18, "radius": 40}},
    # 15  אפקט ציור שמן
    {"toolId": "oil-paint", "params": {"amount": 12, "radius": 30}},
    # 14  חידוד
    {"toolId": "sharpen", "params": {"amount": 30, "radius": 20}},
]

img = common.load_image(SRC)
rgb = common.to_np(img)
out, meta = render.render(img, RECIPE)
total = sum(s["ms"] for s in meta["steps"])
print(f"{len(RECIPE)} tools, {total/1000:.1f}s")
for s in meta["steps"]:
    m = s["meta"]
    short = {k: v for k, v in m.items() if k != "colorHarmonization"} if m else {}
    print(f"   {s['tool']:<17}{s['ms']:>6} ms   {short}")

dest = os.path.join(OUT, "321A4093-ALL.jpg")
out.save(dest, quality=97, subsampling=0)
print("\n->", dest)

# one before/after, full frame
arr = common.to_np(out)
k = 1500.0 / rgb.shape[1]
a = cv2.resize(rgb, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
b = cv2.resize(arr, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(OUT, "321A4093-ALL-compare.jpg"),
            cv2.cvtColor(np.hstack([a, b]), cv2.COLOR_RGB2BGR),
            [cv2.IMWRITE_JPEG_QUALITY, 95])
print("->", os.path.join(OUT, "321A4093-ALL-compare.jpg"))
