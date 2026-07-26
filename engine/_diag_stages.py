"""Test-only: WHICH STAGE killed a candidate?

The pipeline is a chain of subtractions, and a lesion that is never repaired
looks identical whether the model failed to see it or a protection band forbade
it. This prints a kill ledger — for every pixel the skin model found novel,
which stage removed it — and paints the same attribution over the face, so the
answer is read off a map instead of guessed.

Usage: _diag_stages.py <image> <outdir> [strength]
"""

from __future__ import annotations

import sys
from collections import OrderedDict
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

rgb = common.to_np(common.load_image(SRC))
masks.set_source(rgb)
skin_full = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin_full.sum()))
box = common.region_box(skin_full, int(face_d * 0.25), rgb.shape)
x0, y0, x1, y1 = box
crop = rgb[y0:y1, x0:x1]

# --- rebuild confidence() stage by stage, keeping every intermediate ---------
strength = common.clamp01({"strength": STRENGTH}.get("strength", 60))
skin = masks.get_mask(crop, "face-skin")
face_c = float(np.sqrt(skin.sum()))
features = masks.get_mask(crop, "face-anatomy")
hair_raw = masks.get_mask(crop, "hair")
hr = max(3, int(face_c * 0.035)) | 1
hair = cv2.dilate(hair_raw, np.ones((hr, hr), np.uint8))

region_pre_erode = np.clip(skin - features - hair, 0.0, 1.0)
er = max(1, int(face_c * 0.03))
region = cv2.erode(region_pre_erode, np.ones((er, er), np.uint8))

model = cleanup.skinmodel.build(crop, region, face_c)
lo = 4.5 - strength * 3.0
hi = lo + 1.6
novel = model.novelty >= lo  # every pixel the model found unexplainable

conf, region_ref, _fc, _m = cleanup.confidence(crop, {"strength": STRENGTH})
repair = cleanup.decide(conf, face_c)

# --- per-part anatomy, so protection can be blamed by name ------------------
small = common.downscale(crop)
faces = masks._face_landmarks(small)
parts: "OrderedDict[str, np.ndarray]" = OrderedDict()
for lm in faces:
    for name, part in masks.anatomy_parts(small, lm).items():
        big = common.upscale_to(part.astype(np.float32) / 255.0, crop.shape) > 0.5
        parts[name] = np.maximum(parts.get(name, np.zeros_like(big)), big)


def ledger(sel: np.ndarray, label: str) -> None:
    """Attribute every novel pixel inside `sel` to the stage that removed it."""
    n = int((novel & sel).sum())
    print(f"\n=== {label} — {n} novel px (novelty >= {lo:.2f}) ===")
    if n == 0:
        print("  the skin model found NOTHING here — detection failure, not suppression")
        return
    outside = novel & sel & (skin <= 0.5)
    by_anat = novel & sel & (skin > 0.5) & (features > 0.0)
    by_hair = novel & sel & (skin > 0.5) & (features <= 0.0) & (hair > 0.0)
    by_erode = novel & sel & (region_pre_erode > 0) & (region <= 0)
    survived = novel & sel & (region > 0)
    for name, m in (
        ("not face-skin", outside),
        ("anatomy protect", by_anat),
        ("hair dilated", by_hair),
        ("region erosion", by_erode),
        ("SURVIVED to conf", survived),
    ):
        print(f"  {name:18s} {int(m.sum()):6d}  ({int(m.sum()) / n * 100:5.1f}%)")
    for name, part in parts.items():
        hit = int((novel & sel & (part > 0)).sum())
        if hit:
            print(f"      via {name:12s} {hit:6d}")
    print(f"  peak novelty here: {float(model.novelty[sel].max()):.2f}")
    if survived.any():
        print(f"  conf>0.60 seed px: {int(((conf > 0.60) & sel).sum())}")
        print(f"  conf>0.22 ext  px: {int(((conf > 0.22) & sel).sum())}")
        print(f"  in final repair  : {int(((repair > 0) & sel).sum())}")


face_sel = skin_full[y0:y1, x0:x1] > 0.5
ledger(face_sel, "WHOLE FACE")

# --- brow neighbourhoods ----------------------------------------------------
brow_boxes = []
h, w = crop.shape[:2]
sh, sw = small.shape[:2]
for lm in faces:
    for side, idx_set in (("L", masks.LEFT_EYEBROW), ("R", masks.RIGHT_EYEBROW)):
        pts = np.array([[lm[i].x * sw / sw * w, lm[i].y * sh / sh * h] for i in idx_set])
        bx0, by0 = pts.min(0)
        bx1, by1 = pts.max(0)
        pad = (bx1 - bx0) * 0.35
        brow_boxes.append(
            (
                side,
                int(max(0, bx0 - pad)),
                int(max(0, by0 - pad * 1.2)),
                int(min(w, bx1 + pad)),
                int(min(h, by1 + pad * 1.2)),
            )
        )

for side, a, b, c, d in brow_boxes:
    sel = np.zeros(crop.shape[:2], bool)
    sel[b:d, a:c] = True
    ledger(sel, f"BROW {side} box=({a},{b})-({c},{d})")

# --- attribution map --------------------------------------------------------
paint = crop.astype(np.float32)


def wash(m: np.ndarray, colour, alpha=0.62):
    global paint
    a = (m.astype(np.float32))[..., None] * alpha
    paint = paint * (1 - a) + np.array(colour, np.float32) * a


wash(novel & (skin > 0.5) & (features > 0.0), (255, 40, 40))  # blocked: anatomy
wash(novel & (skin > 0.5) & (features <= 0.0) & (hair > 0.0), (255, 150, 0))  # hair
wash(novel & (region_pre_erode > 0) & (region <= 0), (255, 240, 0))  # erosion
wash(novel & (region > 0), (60, 220, 255))  # allowed through
wash(repair > 0, (0, 255, 90), 0.85)  # actually repaired

drawn = Image.fromarray(np.clip(paint, 0, 255).astype(np.uint8))
dd = ImageDraw.Draw(drawn)
for side, a, b, c, d in brow_boxes:
    dd.rectangle((a, b, c, d), outline=(255, 255, 255), width=4)
paint_img = np.asarray(drawn)

nv = np.clip((model.novelty - lo) / 3.0, 0, 1)
heat = cv2.applyColorMap((nv * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)[..., ::-1]

panels = []
for label, image in [
    ("BEFORE", crop),
    ("novelty (what the model SEES)", heat),
    ("red=anatomy  orange=hair  yellow=erosion  cyan=allowed  green=repaired", paint_img),
]:
    p = Image.fromarray(np.asarray(image, np.uint8))
    scale = 1100 / p.height
    p = p.resize((int(p.width * scale), 1100), Image.LANCZOS)
    canvas = Image.new("RGB", (p.width, p.height + 34), (18, 18, 22))
    canvas.paste(p, (0, 34))
    ImageDraw.Draw(canvas).text((10, 12), label, fill=(240, 240, 240))
    panels.append(canvas)

gap = 10
sheet = Image.new(
    "RGB", (sum(p.width for p in panels) + gap * 2, panels[0].height), (18, 18, 22)
)
x = 0
for p in panels:
    sheet.paste(p, (x, 0))
    x += p.width + gap
sheet.save(OUT / "diag-stages.jpg", quality=95)
print("\n->", OUT / "diag-stages.jpg", sheet.size)
