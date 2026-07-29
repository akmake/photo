"""Structure preservation: injected LINES must survive the cleanup untouched.

test_cleanup_recall.py guards the true-positive side (marks must be healed).
This guards the side nothing measured before: a stray hair, a crease, an
eyeliner tail are LINES, and healing a stretch of a line cuts it — both loose
ends stay visible, which reads as damage far worse than the blemish. That is
exactly what the structure gate's line veto exists to prevent, and until this
file existed no test failed when the veto was loosened too far.

Collateral in the recall test cannot catch it: collateral is measured against
a run on the CLEAN image, so a hair the tool cuts in BOTH runs is subtracted
out as baseline. Structure damage needs its own ground truth, so lines with
known geometry are stamped onto eligible skin and the repair mask is asked
whether it touched them.

    python test_cleanup_structure.py <image> [more images...] [--sheet DIR]

The pair is the real gate: this file alone is passed by a tool that heals
NOTHING, and test_cleanup_recall alone is passed by a tool that heals
EVERYTHING. Neither number means anything without the other.
"""

import sys

import cv2
import numpy as np

import cleanup
import common
import masks

# Fraction of a line's pixels the repair mask may touch. Not zero: a line
# crossing a real blemish legitimately gets its crossing pixels repaired, and
# the grown repair region reaches a couple of pixels past the mark. A CUT
# needs a contiguous stretch, which is far above this.
TOUCHED_FRACTION_MAX = 0.10
# A cut is what actually damages the picture: one continuous run of repaired
# pixels in the middle of the line. Measured as the longest repaired run
# along the line's own axis, as a fraction of its length.
CUT_FRACTION_MAX = 0.15


def _line_points(rgb: np.ndarray, count: int, face_d: float):
    """Well-separated points deep inside heal-eligible skin.

    Same eligibility as the recall test — a line only tests the veto if it
    lies where the tool is actually allowed to heal.
    """
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


def _stamp_line(rgb, cx, cy, length, width, delta_lab, angle):
    """Blend a soft line with a gaussian cross-section; returns (img, mask, axis).

    A real hair is not a hard-edged rectangle — it is a sub-pixel filament
    whose contrast fades at both tips. The gaussian profile plus the tapered
    ends are what make the detector see it the way it sees a real one.
    """
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ca, sa = float(np.cos(angle)), float(np.sin(angle))
    dx, dy = xx - cx, yy - cy
    along = dx * ca + dy * sa           # position along the line
    across = -dx * sa + dy * ca         # distance from its axis
    half = length * 0.5
    profile = np.exp(-(across / max(0.6, width)) ** 2)
    # taper: full contrast over the middle 70%, fading to nothing at the tips
    t = np.clip((half - np.abs(along)) / max(1.0, half * 0.3), 0.0, 1.0)
    alpha = profile * t
    alpha[np.abs(along) > half] = 0.0
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab += alpha[..., None] * np.asarray(delta_lab, np.float32)
    out = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
    return out, alpha > 0.30, (along, half)


# name, length (of face_d), width px, Lab delta — one of each structure the
# line veto claims to protect, including the bright polarity.
LINES = [
    # a stray hair lying across the cheek: the canonical case
    ("stray-hair", 0.45, 1.4, (-30.0, +2.0, +4.0)),
    # a fine one, near the detector's own noise floor
    ("fine-hair", 0.32, 1.0, (-18.0, +1.0, +2.0)),
    # a crease/smile line: wider, much softer, longer
    ("crease", 0.50, 3.0, (-10.0, +1.0, +2.0)),
    # a light strand — the tophat polarity, which blackhat-only logic misses
    ("light-strand", 0.35, 1.4, (+24.0, -2.0, -3.0)),
]


def check(path: str, sheet_dir: str | None) -> bool:
    clean = common.to_np(common.load_image(path))
    skin = masks.get_mask(clean, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    if face_d < cleanup.MIN_FACE_PX:
        print(f"  SKIP {path}: face too small")
        return True

    points = _line_points(clean, len(LINES), face_d)
    if len(points) < len(LINES):
        print(f"  SKIP {path}: only {len(points)} eligible sites")
        return True

    rng = np.random.default_rng(11)
    dirty = clean.copy()
    line_masks = []
    for (name, lf, width, delta), (x, y) in zip(LINES, points):
        angle = float(rng.uniform(0, np.pi))
        dirty, m, axis = _stamp_line(
            dirty, x, y, face_d * lf, width, delta, angle
        )
        line_masks.append((name, m, axis, face_d * lf))

    healed, meta = cleanup.apply(dirty, {"strength": 60})
    changed = np.abs(healed.astype(np.int16) - dirty.astype(np.int16)).max(axis=2) > 3

    ok_all = True
    lines_out = []
    for name, m, (along, half), length in line_masks:
        n_px = int(m.sum())
        if n_px == 0:
            continue
        touched = changed & m
        frac = float(touched.sum()) / n_px

        # longest contiguous repaired run along the line's own axis — a cut
        pos = along[m]
        hit = touched[m]
        order = np.argsort(pos)
        hit_sorted = hit[order]
        pos_sorted = pos[order]
        best = run = 0.0
        start = None
        for i, h in enumerate(hit_sorted):
            if h:
                if start is None:
                    start = pos_sorted[i]
                run = float(pos_sorted[i] - start)
                best = max(best, run)
            else:
                start = None
        cut_frac = best / max(1.0, length)

        ok = frac <= TOUCHED_FRACTION_MAX and cut_frac <= CUT_FRACTION_MAX
        ok_all &= ok
        lines_out.append(
            f"    {'keep' if ok else 'CUT ':4s}  {name:13s} "
            f"touched={100*frac:5.1f}%  longest_cut={100*cut_frac:5.1f}% of length"
        )

    name = path.replace("/", chr(92)).split(chr(92))[-1]
    print(f"  {'PASS' if ok_all else 'FAIL'}  {name}  face_d={face_d:.0f}  "
          f"lineVetoed={meta.get('lineVetoed', '-')}")
    print("\n".join(lines_out))

    if sheet_dir:
        from PIL import Image

        ys, xs = np.where(skin > 0.5)
        pad = 60
        x0, x1 = max(0, xs.min() - pad), min(clean.shape[1], xs.max() + pad)
        y0, y1 = max(0, ys.min() - pad), min(clean.shape[0], ys.max() + pad)
        panels = [dirty[y0:y1, x0:x1], healed[y0:y1, x0:x1]]
        z = 2
        imgs = [
            Image.fromarray(p).resize(((x1 - x0) * z, (y1 - y0) * z), Image.LANCZOS)
            for p in panels
        ]
        w, h = imgs[0].size
        combo = Image.new("RGB", (w * 2 + 12, h), (18, 18, 22))
        for i, p in enumerate(imgs):
            combo.paste(p, (i * (w + 12), 0))
        out = f"{sheet_dir}/lines-{name}.jpg"
        combo.save(out, quality=95)
        print(f"    -> {out}  (lines injected | after cleanup)")

    return ok_all


if __name__ == "__main__":
    args = sys.argv[1:]
    sheet = None
    if "--sheet" in args:
        i = args.index("--sheet")
        sheet = args[i + 1]
        args = args[:i] + args[i + 2:]
    if not args:
        print("usage: python test_cleanup_structure.py <image> [...] [--sheet DIR]")
        sys.exit(2)
    ok = all([check(p, sheet) for p in args])
    sys.exit(0 if ok else 1)
