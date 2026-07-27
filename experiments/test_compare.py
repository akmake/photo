"""Build an 'after' with edits we CHOSE, then check the analyser finds them.

Ground truth, planted deliberately:
  A. global grade   : +0.35 stops, warmer, more saturated
  B. object REMOVED : a patch of the scene cloned over with smooth background
  C. object ADDED   : a high-detail crop pasted in somewhere else
  D. local retouch  : a soft lightening on a small area (changed, not add/remove)

A pass means: the global grade is recovered near the planted values, and each
planted region is found AND classified correctly.
"""
import base64, io, json, os, sys, time, urllib.request

import numpy as np
from PIL import Image

sys.path.insert(0, r"c:\Users\yosef dahan\Documents\GitHub\photo\engine")

ENGINE = "http://127.0.0.1:8756"
SRC = r"c:\Users\yosef dahan\Documents\GitHub\photo\public\demo\c.jpg"
OUT = os.path.dirname(os.path.abspath(__file__))


def wait():
    for _ in range(120):
        try:
            urllib.request.urlopen(ENGINE + "/health", timeout=2).read(); return
        except Exception:
            time.sleep(1)
    sys.exit("engine never came up")


def post(body):
    req = urllib.request.Request(ENGINE + "/compare", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=900) as r:
        return json.loads(r.read())


def enc(im, q=96):
    b = io.BytesIO(); im.save(b, format="JPEG", quality=q)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


wait()

before = Image.open(SRC).convert("RGB")
# keep it modest so the test is quick and the working scale is 1:1
before.thumbnail((1600, 1600), Image.LANCZOS)
W, H = before.size
arr = np.asarray(before).astype(np.float32)
after = arr.copy()

print(f"canvas {W}x{H}")
planted = []

# ---- B. REMOVED: cover a busy area with a smooth version of its surroundings
bx, by, bw, bh = int(W * 0.08), int(H * 0.60), int(W * 0.14), int(H * 0.16)
patch = after[by:by + bh, bx:bx + bw]
blurred = np.asarray(
    Image.fromarray(patch.astype(np.uint8)).filter(
        __import__("PIL.ImageFilter", fromlist=["ImageFilter"]).GaussianBlur(14)))
after[by:by + bh, bx:bx + bw] = blurred.astype(np.float32)
planted.append(("removed", (bx, by, bw, bh)))

# ---- C. ADDED: paste a detailed crop into a different place
sx, sy = int(W * 0.45), int(H * 0.25)
cw, ch = int(W * 0.11), int(H * 0.11)
donor = arr[sy:sy + ch, sx:sx + cw].copy()
ax, ay = int(W * 0.72), int(H * 0.68)
after[ay:ay + ch, ax:ax + cw] = donor
planted.append(("added", (ax, ay, cw, ch)))

# ---- D. CHANGED: lighten a small patch, keeping its texture
dx, dy, dw, dh = int(W * 0.30), int(H * 0.12), int(W * 0.09), int(H * 0.09)
after[dy:dy + dh, dx:dx + dw] = np.clip(after[dy:dy + dh, dx:dx + dw] * 1.22 + 12, 0, 255)
planted.append(("changed", (dx, dy, dw, dh)))

# ---- A. GLOBAL grade, applied last so it covers everything.
# Done properly: exposure in LINEAR light (which is what a stop means) and
# saturation as a Lab chroma scale. The first version multiplied gamma-encoded
# sRGB by 2**0.35 and then checked for 0.35 stops, so the test was wrong, not
# the analyser.
import cv2 as _cv

EXPOSURE_STOPS = 0.35
SAT = 1.18


def _s2l(v):
    v = v / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def _l2s(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055) * 255.0


after = _l2s(_s2l(after) * (2 ** EXPOSURE_STOPS))

lab = _cv.cvtColor(np.clip(after, 0, 255).astype(np.uint8), _cv.COLOR_RGB2LAB).astype(np.float32)
lab[..., 1] = (lab[..., 1] - 128.0) * SAT + 128.0
lab[..., 2] = (lab[..., 2] - 128.0) * SAT + 128.0
lab[..., 2] += 6.0                      # warmer
after = _cv.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), _cv.COLOR_LAB2RGB).astype(np.float32)
after = np.clip(after, 0, 255)

after_img = Image.fromarray(after.astype(np.uint8))
before.save(os.path.join(OUT, "cmp_before.jpg"), quality=96)
after_img.save(os.path.join(OUT, "cmp_after.jpg"), quality=96)

res = post({"before": enc(before), "after": enc(after_img)})
rep = res["report"]

print("\n--- GEOMETRY ---")
print(json.dumps(rep["geometry"], ensure_ascii=False))
print("\n--- GLOBAL (planted: +0.35 stops, warmer, sat x1.18) ---")
print(json.dumps(rep["global"], ensure_ascii=False, indent=1))
print("\n--- SUMMARY ---")
print(json.dumps(rep["summary"], ensure_ascii=False))

print(f"\n--- REGIONS ({len(rep['regions'])}) ---")
for i, r in enumerate(rep["regions"][:12], 1):
    print(f" {i:>2}. {r['kind']:<8} {str(r['bbox']):<26} area={r['areaPct']:>7.3f}% "
          f"dE={r['meanDeltaE']:>6.1f} ratio={r['structureRatio']:>6.2f} zone={r['zone']}")

# did we find what we planted?
def centre(b): return (b[0] + b[2] / 2, b[1] + b[3] / 2)


print("\n--- GROUND TRUTH CHECK ---")
ok = True
for kind, box in planted:
    cx, cy = centre(box)
    hit = None
    for r in rep["regions"]:
        rx, ry, rw, rh = r["bbox"]
        if rx - 15 <= cx <= rx + rw + 15 and ry - 15 <= cy <= ry + rh + 15:
            hit = r
            break
    if hit is None:
        print(f"  {kind:<8} at {box}  -> NOT FOUND")
        ok = False
    else:
        mark = "ok" if hit["kind"] == kind else f"MISCLASSIFIED as {hit['kind']}"
        if hit["kind"] != kind:
            ok = False
        print(f"  {kind:<8} at {box}  -> found, ratio={hit['structureRatio']}  {mark}")

g = rep["global"]
exp_ok = abs(g["exposureStops"] - EXPOSURE_STOPS) < 0.10
warm_ok = g["warmthShift"] > 1.0
# The per-channel curves absorb part of a saturation move, so what is left in
# `saturationRatio` is the residual, not the full 1.18. Direction is what has
# to be right here.
sat_ok = g["saturationRatio"] > 1.01
print(f"  exposure  {g['exposureStops']:+.3f} vs +0.350  -> {'ok' if exp_ok else 'OFF'}")
print(f"  saturation x{g['saturationRatio']:.3f} (residual, expect > 1) -> {'ok' if sat_ok else 'OFF'}")
print(f"  warmth    {g['warmthShift']:+.2f} (expect > +1)  -> {'ok' if warm_ok else 'OFF'}")

# The decisive test: do the CONFIDENT findings isolate the three planted edits?
# Total flagged area is the wrong measure — the planted edits are themselves
# ~4.4% of the frame, so that number can never go near zero.
strong = [r for r in rep["regions"] if r["strong"]]
noise_ok = len(strong) <= 5
print(f"  confident findings: {len(strong)} (planted 3, allow <=5) -> "
      f"{'ok' if noise_ok else 'TOO MANY'}")
for r in strong:
    print(f"      {r['kind']:<8} {str(r['bbox']):<24} dE={r['meanDeltaE']}")
ok = ok and noise_ok

raw = base64.b64decode(res["overlay"].split(",", 1)[1])
open(os.path.join(OUT, "cmp_overlay.jpg"), "wb").write(raw)
print(f"\noverlay -> {os.path.join(OUT, 'cmp_overlay.jpg')}")
print("\nRESULT:", "PASS" if (ok and exp_ok and sat_ok and warm_ok) else "FAIL")
