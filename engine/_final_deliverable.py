"""Final pass: registry check, the full request list on 321A4093, both frames."""

import os

import cv2
import numpy as np

import common
import local_color
import masks
import presets
import render
import server  # import-only: proves the tool registry and dispatch resolve

OUT = r"c:\Users\yosef dahan\Documents\GitHub\photo\test-results\_final"
os.makedirs(OUT, exist_ok=True)

print("server tools :", [t["id"] for t in server.TOOLS])
print("render TOOLS :", sorted(render.TOOLS))
print("undispatched :", [t["id"] for t in server.TOOLS
                         if t["id"] not in server.DISPATCH] or "none")

SRC = r"C:\Users\yosef dahan\Downloads\321A4093.JPG"
img = common.load_image(SRC)
rgb = common.to_np(img)
h, w = rgb.shape[:2]
print(f"\n=== 321A4093  {w}x{h} ===")

# ---- what the frame can and cannot support -------------------------------
allch = (rgb >= 254).all(axis=2)
print(f"clipped all-3 (unrecoverable): {100*float(allch.mean()):.3f}%")
print(f"clipped any-1 (recoverable)  : {100*float((rgb >= 254).any(axis=2).mean()):.3f}%")
masks.set_source(rgb)
subject = masks.get_mask(rgb, "subject")
skin = masks.get_mask(rgb, "face-skin")
hair = masks.get_mask(rgb, "hair")
face_d = float(np.sqrt(float(skin.sum())))
print(f"face_d {face_d:.0f}px   subject {100*float((subject>0.5).mean()):.1f}%   "
      f"hair {100*float((hair>0.5).mean()):.2f}%")
# the tricycle: does the subject mask hold it, or will blur eat it?
trike = subject[int(0.30*h):int(0.75*h), int(0.20*w):int(0.40*w)]
print(f"subject alpha over the tricycle: {trike.mean():.3f}"
      f"  -> {'kept' if trike.mean() > 0.5 else 'BACKGROUND, blur would eat it'}")
masks.clear_source()

# ---- the request list, mapped to the tools that exist --------------------
#  3 shadows/blacks  4 highlights/whites  5+6 skin  7 blush  8 eyes
#  10 hair  11 dimension  14 sharpen  9 colour grade
FULL = presets.portrait("natural") + [
    {"toolId": "tone-color", "params": {"shadows": 22, "blacks": 10,      # 3
                                        "highlights": -24, "whites": -14,  # 4 + 1
                                        "contrast": 8, "vibrance": 14,
                                        "saturation": 3, "temperature": -3}},
    {"toolId": "dimension", "params": {"clarity": 14, "vignette": 14}},   # 11
    {"toolId": "color-grade", "params": {"shadowsWarm": -5,               # 9
                                         "highlightsWarm": 6}},
    {"toolId": "sharpen", "params": {"amount": 30, "radius": 20}},        # 14
]
out, meta = render.render(img, FULL)
print(f"\nfull list, {len(FULL)} tools:")
for s in meta["steps"]:
    print(f"   {s['tool']:<14}{s['ms']:>6} ms   {s['meta']}")
out.save(os.path.join(OUT, "321A4093-full-list.jpg"), quality=97, subsampling=0)

# ---- the four that are effects, not corrections: rendered separately -----
for label, tool in (
    ("13-light-point", {"toolId": "light-point",
                        "params": {"strength": 40, "x": 70, "y": 25,
                                   "size": 50, "warmth": 70}}),
    ("16-glow", {"toolId": "glow", "params": {"amount": 35, "radius": 40}}),
    ("15-oil-paint", {"toolId": "oil-paint", "params": {"amount": 65, "radius": 40}}),
    ("12-background-blur", {"toolId": "background-blur",
                            "params": {"amount": 60, "bokeh": 55}}),
):
    o, m = render.render(img, [tool])
    o.save(os.path.join(OUT, f"321A4093-{label}.jpg"), quality=94, subsampling=0)
    print(f"   {label:<20}{m['steps'][0]['meta']}")

# ---- face crops, before vs after ----------------------------------------
for name, path, level in (
    ("321A4093", SRC, "natural"),
    ("321A5247", r"C:\Users\yosef dahan\Downloads\321A5247.JPG", "light"),
):
    im = common.load_image(path)
    src = common.to_np(im)
    if name == "321A4093":
        res = common.to_np(out)
    else:
        r, mm = render.render(im, presets.portrait(level) + [
            {"toolId": "tone-color", "params": {"shadows": 16, "highlights": -20,
                                                "contrast": 8, "vibrance": 12}},
            {"toolId": "sharpen", "params": {"amount": 28}}])
        res = common.to_np(r)
        r.save(os.path.join(OUT, f"{name}-{level}.jpg"), quality=97, subsampling=0)
    masks.set_source(src)
    sk = masks.get_mask(src, "face-skin")
    fd = float(np.sqrt(float(sk.sum())))
    box = common.region_box(sk, int(fd * 0.5), src.shape)
    masks.clear_source()
    x0, y0, x1, y1 = box
    a, b = src[y0:y1, x0:x1], res[y0:y1, x0:x1]
    k = 900.0 / max(1, a.shape[1])
    a = cv2.resize(a, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    b = cv2.resize(b, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    cv2.imwrite(os.path.join(OUT, f"{name}-face.jpg"),
                cv2.cvtColor(np.hstack([a, b]), cv2.COLOR_RGB2BGR),
                [cv2.IMWRITE_JPEG_QUALITY, 96])

print("\nwrote ->", OUT)
