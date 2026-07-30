"""Diagnose the 'brown patch' artefact: report every repaired lesion with the
colour it had, the colour it was given, and the colour of the skin around it.

A repair whose result is far from its own surrounding ring is by definition
wrong, no matter what the detector thought.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import healing
import masks

SRC = sys.argv[1]
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 100

rgb = common.to_np(common.load_image(SRC))
masks.set_source(rgb)
print("image", rgb.shape)

skin = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin.sum()))
print("face_d", round(face_d, 1))
box = common.region_box(skin, int(face_d * 0.25), rgb.shape)
x0, y0, x1, y1 = box
crop = rgb[y0:y1, x0:x1]

got = cleanup.confidence(crop, {"strength": STRENGTH})
if got is None:
    raise SystemExit("no confidence")
conf, region, face_c, model = got
repair = cleanup.decide(conf, face_c)
allowed = (region > 0.35).astype(np.uint8)
print("repair px", int(repair.sum()))

healed = healing.inpaint_texture(crop, repair, allowed)
telea_only = healing.telea(crop, repair)

out, meta = cleanup.apply(rgb, {"strength": STRENGTH})
print("meta", meta)

count, labels, stats, cents = cv2.connectedComponentsWithStats(repair, 8)
rows = []
for i in range(1, count):
    comp = labels == i
    if comp.sum() < 2:
        continue
    ring_k = max(5, int(np.sqrt(comp.sum()) * 1.2)) | 1
    ring = cv2.dilate(comp.astype(np.uint8), np.ones((ring_k, ring_k), np.uint8)).astype(bool)
    ring &= ~comp
    ring &= allowed > 0
    before = crop[comp].mean(axis=0)
    after = healed[comp].mean(axis=0)
    tel = telea_only[comp].mean(axis=0)
    around = crop[ring].mean(axis=0) if ring.sum() > 8 else np.array([np.nan] * 3)
    # how far the RESULT lands from the skin that surrounds it
    err = float(np.abs(after - around).mean()) if ring.sum() > 8 else -1.0
    cx, cy = cents[i]
    rows.append(
        dict(
            i=i,
            full=(int(cx + x0), int(cy + y0)),
            crop=(int(cx), int(cy)),
            area=int(comp.sum()),
            before=before,
            after=after,
            telea=tel,
            around=around,
            err=err,
        )
    )

rows.sort(key=lambda r: -r["err"])
print(f"\n{len(rows)} lesions, worst first (err = |result - surrounding skin|):")
print(f"{'full xy':>14} {'area':>5} {'err':>6}  before RGB      result RGB      around RGB")
for r in rows:
    b, a, s = r["before"], r["after"], r["around"]
    print(
        f"{str(r['full']):>14} {r['area']:5d} {r['err']:6.1f}  "
        f"{b[0]:3.0f},{b[1]:3.0f},{b[2]:3.0f}   "
        f"{a[0]:3.0f},{a[1]:3.0f},{a[2]:3.0f}   "
        f"{s[0]:3.0f},{s[1]:3.0f},{s[2]:3.0f}"
    )

# ---- visual sheet: whole face, then zooms on the worst offenders -----------
detected = crop.copy().astype(np.float32)
a = np.clip(conf, 0, 1)[..., None]
detected = np.clip(detected * (1 - a) + np.array([0.0, 255.0, 255.0]) * a, 0, 255).astype(np.uint8)
outlined = out[y0:y1, x0:x1].copy()
cont, _ = cv2.findContours(repair, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
cv2.drawContours(outlined, cont, -1, (0, 255, 255), 1)

panels = [("BEFORE", crop), ("detected", detected), ("AFTER", out[y0:y1, x0:x1]), ("AFTER+mask", outlined)]
target_h = 760
imgs = []
for label, im in panels:
    p = Image.fromarray(im)
    p = p.resize((int(p.width * target_h / p.height), target_h), Image.LANCZOS)
    cv = Image.new("RGB", (p.width, p.height + 30), (18, 18, 22))
    cv.paste(p, (0, 30))
    ImageDraw.Draw(cv).text((8, 8), label, fill=(240, 240, 240))
    imgs.append(cv)
sheet = Image.new("RGB", (sum(i.width for i in imgs) + 30, imgs[0].height), (18, 18, 22))
xx = 0
for i in imgs:
    sheet.paste(i, (xx, 0))
    xx += i.width + 10
sheet.save(OUT / "brown-face.jpg", quality=95)
print("->", OUT / "brown-face.jpg", sheet.size)

zooms = []
for r in rows[:6]:
    cx, cy = r["crop"]
    h = max(34, int(np.sqrt(r["area"]) * 3.5))
    zx0, zy0 = max(0, cx - h), max(0, cy - h)
    zx1, zy1 = min(crop.shape[1], cx + h), min(crop.shape[0], cy + h)
    pair = []
    for label, im in [("before", crop), ("after", out[y0:y1, x0:x1])]:
        p = Image.fromarray(im[zy0:zy1, zx0:zx1]).resize((300, 300), Image.NEAREST)
        cv = Image.new("RGB", (300, 328), (18, 18, 22))
        cv.paste(p, (0, 28))
        ImageDraw.Draw(cv).text((6, 8), f"{label} {r['full']} err={r['err']:.0f}", fill=(240, 240, 240))
        pair.append(cv)
    row = Image.new("RGB", (610, 328), (18, 18, 22))
    row.paste(pair[0], (0, 0))
    row.paste(pair[1], (310, 0))
    zooms.append(row)
if zooms:
    cols = 3
    rws = (len(zooms) + cols - 1) // cols
    grid = Image.new("RGB", (cols * 620, rws * 338), (18, 18, 22))
    for n, z in enumerate(zooms):
        grid.paste(z, ((n % cols) * 620, (n // cols) * 338))
    grid.save(OUT / "brown-zooms.jpg", quality=95)
    print("->", OUT / "brown-zooms.jpg", grid.size)
