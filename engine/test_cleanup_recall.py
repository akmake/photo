"""Cleanup recall assertion: injected blemishes must be found and healed.

test_blush.py guards the false-positive side (never touch the person's own
colour). This guards the true-positive side: a tool that damages nothing but
also HEALS nothing would pass every safety gate while being useless. Marks
with known ground truth are stamped onto eligible skin of a real face, so
recovery can be measured against the actual clean pixels underneath.

    python test_cleanup_recall.py <image> [more images...] [--sheet DIR]

Per mark: detected = the repair touched it; healed = the repaired pixels
moved back toward the original skin (residual well below the mark's own
amplitude). The run FAILS if fewer than REQUIRED_RECALL of marks heal, or if
anything outside the injected marks changed (collateral).
"""

import sys

import cv2
import numpy as np

import cleanup
import common
import masks

REQUIRED_RECALL = 0.8
# A healed mark must reduce its mean deviation from the true skin to below
# this fraction of the injected deviation. Calibrated visually: a wide soft
# smudge healed to 0.36-0.44 of its amplitude is indistinguishable from the
# skin's own variation at normal viewing, while a "dimmed but visible" ghost
# sits well above 0.5.
RESIDUAL_FRACTION = 0.45
# Healing the face's own real marks is the tool working, not collateral. What
# injection must NOT do is change the tool's behaviour elsewhere — so the
# collateral measure is pixels changed outside the marks that a run on the
# CLEAN image did not also change. Not zero by design: the second-pass skin
# model excludes detected pixels from its sample, so injection legitimately
# shifts borderline natural detections a little.
COLLATERAL_MAX_PX = 800


def _eligible_points(rgb: np.ndarray, count: int, face_d: float):
    """Well-separated points deep inside heal-eligible skin."""
    skin = masks.get_mask(rgb, "face-skin")
    anatomy = masks.get_mask(rgb, "face-anatomy")
    hair = masks.get_mask(rgb, "hair")
    hr = max(3, int(face_d * 0.035)) | 1
    hair = cv2.dilate(hair, np.ones((hr, hr), np.uint8))
    region = np.clip(skin - anatomy - hair, 0.0, 1.0)
    region *= masks.get_mask(rgb, "face-oval")
    er = max(1, int(face_d * 0.04))
    region = cv2.erode(region, np.ones((er, er), np.uint8))
    dist = cv2.distanceTransform((region > 0.5).astype(np.uint8), cv2.DIST_L2, 3)
    points = []
    spacing = int(face_d * 0.16)
    for _ in range(count):
        y, x = np.unravel_index(np.argmax(dist), dist.shape)
        if dist[y, x] < face_d * 0.02:
            break
        points.append((int(x), int(y)))
        cv2.circle(dist, (int(x), int(y)), spacing, 0.0, -1)
    return points


def _stamp(rgb: np.ndarray, cx: int, cy: int, radius: float, delta_lab, ecc=1.0, angle=0.0):
    """Blend a soft elliptical Lab shift into the image; returns its mask."""
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ca, sa = np.cos(angle), np.sin(angle)
    dx, dy = xx - cx, yy - cy
    u = (dx * ca + dy * sa) / max(1.0, radius)
    v = (-dx * sa + dy * ca) / max(1.0, radius * ecc)
    d2 = u * u + v * v
    alpha = np.exp(-d2 * 2.2)
    alpha[d2 > 4.0] = 0.0
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab += alpha[..., None] * np.asarray(delta_lab, np.float32)
    out = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
    return out, alpha > 0.30


# name, radius (of face_d), Lab delta, eccentricity — realistic amplitudes,
# one of each novelty direction the detector claims to catch.
MARKS = [
    ("dirt-smudge", 0.024, (-16.0, +2.0, +11.0), 1.6),
    ("red-pimple", 0.011, (-4.0, +19.0, +5.0), 1.0),
    ("dark-speck", 0.007, (-34.0, +4.0, +6.0), 1.2),
    ("bright-crumb", 0.007, (+26.0, -2.0, -4.0), 1.0),
    ("scratch", 0.020, (-20.0, +6.0, +7.0), 0.16),
]


def check(path: str, sheet_dir: str | None) -> bool:
    clean = common.to_np(common.load_image(path))
    skin = masks.get_mask(clean, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    if face_d < cleanup.MIN_FACE_PX:
        print(f"  SKIP {path}: face too small")
        return True

    points = _eligible_points(clean, len(MARKS), face_d)
    if len(points) < len(MARKS):
        print(f"  SKIP {path}: only {len(points)} eligible sites")
        return True

    rng = np.random.default_rng(7)
    dirty = clean.copy()
    mark_masks = []
    for (name, r, delta, ecc), (x, y) in zip(MARKS, points):
        dirty, m = _stamp(
            dirty, x, y, face_d * r, delta, ecc, angle=float(rng.uniform(0, np.pi))
        )
        mark_masks.append((name, m))

    healed, meta = cleanup.apply(dirty, {"strength": 60})

    clean_f = clean.astype(np.float32)
    all_marks = np.zeros(clean.shape[:2], bool)
    for _, m in mark_masks:
        all_marks |= m

    ok_count = 0
    lines = []
    for name, m in mark_masks:
        injected = float(np.abs(dirty.astype(np.float32) - clean_f)[m].mean())
        residual = float(np.abs(healed.astype(np.float32) - clean_f)[m].mean())
        touched = bool((np.abs(healed.astype(np.int16) - dirty.astype(np.int16)).max(axis=2) > 3)[m].any())
        healed_ok = touched and residual < injected * RESIDUAL_FRACTION
        ok_count += int(healed_ok)
        lines.append(
            f"    {'HEAL' if healed_ok else ('part' if touched else 'MISS'):4s}"
            f"  {name:12s} injected={injected:5.1f} residual={residual:5.1f}"
        )

    healed_clean, _ = cleanup.apply(clean, {"strength": 60})
    base_diff = np.abs(healed_clean.astype(np.int16) - clean.astype(np.int16)).max(axis=2) > 3
    base_diff = cv2.dilate(base_diff.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    diff = np.abs(healed.astype(np.int16) - dirty.astype(np.int16)).max(axis=2) > 3
    grown = cv2.dilate(all_marks.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
    collateral = int((diff & ~grown & ~base_diff).sum())

    recall_ok = ok_count >= int(np.ceil(REQUIRED_RECALL * len(MARKS)))
    collateral_ok = collateral <= COLLATERAL_MAX_PX
    name = path.replace("/", chr(92)).split(chr(92))[-1]
    print(
        f"  {'PASS' if (recall_ok and collateral_ok) else 'FAIL'}  {name}  "
        f"healed {ok_count}/{len(MARKS)}  collateral={collateral}px  {meta}"
    )
    print("\n".join(lines))

    if sheet_dir:
        from PIL import Image

        s = masks.get_mask(clean, "face-skin")
        ys, xs = np.where(s > 0.5)
        pad = 60
        x0, x1 = max(0, xs.min() - pad), min(clean.shape[1], xs.max() + pad)
        y0, y1 = max(0, ys.min() - pad), min(clean.shape[0], ys.max() + pad)
        panels = [clean[y0:y1, x0:x1], dirty[y0:y1, x0:x1], healed[y0:y1, x0:x1]]
        z = 2
        imgs = [
            Image.fromarray(p).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS)
            for p in panels
        ]
        w, h = imgs[0].size
        combo = Image.new("RGB", (w * 3 + 24, h), (18, 18, 22))
        for i, p in enumerate(imgs):
            combo.paste(p, (i * (w + 12), 0))
        out = f"{sheet_dir}/recall-{name}.jpg"
        combo.save(out, quality=95)
        print(f"    -> {out}  (clean | injected | healed)")

    return recall_ok and collateral_ok


if __name__ == "__main__":
    args = sys.argv[1:]
    sheet = None
    if "--sheet" in args:
        i = args.index("--sheet")
        sheet = args[i + 1]
        args = args[:i] + args[i + 2 :]
    if not args:
        print("usage: python test_cleanup_recall.py <image> [...] [--sheet DIR]")
        sys.exit(2)
    ok = all([check(p, sheet) for p in args])
    sys.exit(0 if ok else 1)
