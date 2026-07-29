"""Contour (dodge & burn) regression: the measured behaviour, locked.

Everything asserted here was first measured by hand (2026-07-29, sheets in
test-results/contour-sidelight/). The tool's contract:

  * each anatomical axis moves ITS band and nothing else, in its direction
  * the cheekbone slider is a pair — bone up, hollow down
  * only L* moves; skin colour and pore texture stay
  * the eye itself is never written by `undereye`
  * the scene-light gate (`fidelity`): a lit band keeps its full push at any
    fidelity, a shadowed band loses most of it
  * band placement is anchored to the FACE, not the frame — a rotated image
    gets the same (rotated) result

    python test_contour.py [image ...]   (defaults to the two side-lit refs)

The default references are the images the gate was calibrated on: a moderate
side-lit face and the extreme lying-head holdout. The axis battery runs on the
first image; the light-gate check runs on every image whose face halves differ
by at least ASYM_MIN; the rotation check runs on the first image that survives
face detection after rotation.
"""

import pathlib
import sys

import cv2
import numpy as np

import contour
import masks

DEFAULT_IMAGES = [
    r"c:\Users\yosef dahan\Downloads\22\321A5117.JPG",
    r"c:\Users\yosef dahan\Downloads\jm__yg0J2rjsE-dhAL\321A5601.JPG",
]

# in-band signed push at slider 70, L* units. Measured 1.4 (deep shadow, gated)
# to 3.8; the floor is far below any of it but far above noise.
BAND_MIN = 0.5
# mean |dL| everywhere on face skin outside the axis's own band. Measured 0.03.
REST_MAX = 0.15
# a*/b* inside the band: p99 of |delta|. The contract is L-only; the byte
# round-trip through RGB costs up to 1, a clipped highlight pixel can cost 5 —
# which is why this is a p99 and not a max.
AB_P99_MAX = 2.5
# high-frequency std inside the dodge band, after/before. Measured 0.992+.
TEXTURE_MIN = 0.95
# max |dL| inside the filled eye polygons when `undereye` runs. Measured 0.39
# (feather bleed at the polygon edge).
EYE_MAX = 0.6
# light gate: shadow-band push at fidelity 100 over fidelity 0. Measured 0.60
# on the moderate face, 0.16 on the extreme one.
GATE_SHADOW_MAX = 0.65
# ...and the lit band must not lose more than this fraction at any fidelity.
GATE_LIT_MIN = 0.95
# face-half L* asymmetry below which the shadow assertion is meaningless
ASYM_MIN = 6.0
# IoU of the dodge region between the upright run and a rotated-back run.
# Landmark jitter between orientations moves the bands a little; 0.5 still
# fails hard if a band lands on the wrong side of the cheek axis.
ROT_IOU_MIN = 0.5

FAILURES = []


def check(name, ok, detail):
    tag = "PASS" if ok else "FAIL"
    print(f"  {tag} {name}: {detail}")
    if not ok:
        FAILURES.append(name)


def lstar(rgb):
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)[..., 0].astype(np.float32) / 2.55


def load(path):
    img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    return None if img is None else cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def face_context(rgb):
    faces = masks._face_landmarks(rgb)
    if not faces:
        return None
    h, w = rgb.shape[:2]
    lm = max(faces, key=lambda f: abs(f[masks.FACE_RIGHT].x - f[masks.FACE_LEFT].x))
    pt = lambda i: np.array([lm[i].x * w, lm[i].y * h], np.float32)
    fw = float(np.linalg.norm(pt(masks.FACE_RIGHT) - pt(masks.FACE_LEFT)))
    bands = [b > 0.5 for b in contour._bands(rgb, [lm])]
    skin = masks.get_mask(rgb, "face-skin") > 0.5
    features = masks.get_mask(rgb, "face-features") > 0.5
    mid = (pt(masks.FACE_LEFT) + pt(masks.FACE_RIGHT)) / 2
    axis = (pt(masks.FACE_RIGHT) - pt(masks.FACE_LEFT)) / max(1e-6, fw)
    yy, xx = np.mgrid[0:h, 0:w]
    side = (xx - mid[0]) * axis[0] + (yy - mid[1]) * axis[1]
    return dict(lm=lm, pt=pt, fw=fw, bands=bands, skin=skin, features=features, side=side)


def axis_battery(rgb, ctx):
    """Each axis at 70: its band moves in its direction, the rest does not."""
    cheek_up, cheek_low, fore, jawband, under = ctx["bands"]
    L0 = lstar(rgb)
    lab0 = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    clean = ctx["skin"] & ~ctx["features"]

    for axis_id, dodge_band, burn_band in (
        ("cheekbones", cheek_up, cheek_low),
        ("forehead", fore, None),
        ("jaw", None, jawband),
        ("undereye", under, None),
    ):
        out, meta = contour.apply(rgb, {axis_id: 70})
        dL = lstar(out) - L0
        own = (dodge_band if dodge_band is not None else jawband)
        rest = clean & ~own
        if burn_band is not None:
            rest &= ~burn_band
        if dodge_band is not None:
            m = dodge_band & clean
            check(f"{axis_id} dodge", dL[m].mean() >= BAND_MIN,
                  f"band {dL[m].mean():+.2f} (>= +{BAND_MIN})")
        if burn_band is not None:
            m = burn_band if axis_id == "jaw" else burn_band & clean
            check(f"{axis_id} burn", dL[m].mean() <= -BAND_MIN,
                  f"band {dL[m].mean():+.2f} (<= -{BAND_MIN})")
        check(f"{axis_id} isolation", abs(dL[rest]).mean() <= REST_MAX,
              f"rest {abs(dL[rest]).mean():.3f} (<= {REST_MAX})")

        if dodge_band is not None:
            m = dodge_band & clean
            lab1 = cv2.cvtColor(out, cv2.COLOR_RGB2LAB).astype(np.float32)
            dab = np.abs(lab1[..., 1:] - lab0[..., 1:]).max(axis=2)
            check(f"{axis_id} L-only", np.percentile(dab[m], 99) <= AB_P99_MAX,
                  f"p99 |d a*/b*| {np.percentile(dab[m], 99):.2f} (<= {AB_P99_MAX})")
            hp0 = L0 - cv2.GaussianBlur(L0, (9, 9), 0)
            hp1 = lstar(out) - cv2.GaussianBlur(lstar(out), (9, 9), 0)
            ratio = float(hp1[m].std() / max(1e-6, hp0[m].std()))
            check(f"{axis_id} texture", ratio >= TEXTURE_MIN,
                  f"high-freq std {ratio:.3f} (>= {TEXTURE_MIN})")

    # the eye itself under `undereye`
    out, _ = contour.apply(rgb, {"undereye": 70})
    dL = lstar(out) - L0
    eye_fill = np.zeros(rgb.shape[:2], np.uint8)
    for idx in (masks.LEFT_EYE, masks.RIGHT_EYE):
        poly = np.array([ctx["pt"](i) for i in idx], np.int32)
        cv2.fillPoly(eye_fill, [cv2.convexHull(poly)], 1)
    m = eye_fill.astype(bool)
    check("undereye eye-safety", abs(dL[m]).max() <= EYE_MAX,
          f"max |dL| in eyeball {abs(dL[m]).max():.2f} (<= {EYE_MAX})")

    # no-op contract
    out, meta = contour.apply(rgb, {})
    check("no-op", meta.get("applied") == 0 and out is rgb,
          f"applied={meta.get('applied')}")


def light_gate(rgb, ctx):
    """Lit band keeps its push at any fidelity; a shadowed one loses most."""
    L0 = lstar(rgb)
    clean = ctx["skin"] & ~ctx["features"]
    sL = L0[clean & (ctx["side"] < 0)].mean()
    sR = L0[clean & (ctx["side"] > 0)].mean()
    if abs(sL - sR) < ASYM_MIN:
        print(f"  skip light-gate: face halves differ {abs(sL - sR):.1f} L* (< {ASYM_MIN})")
        return
    shadow_sgn = -1 if sL < sR else 1
    cheek_up = ctx["bands"][0]
    shadow_m = cheek_up & clean & (shadow_sgn * ctx["side"] > 0)
    lit_m = cheek_up & clean & (shadow_sgn * ctx["side"] < 0)

    push = {}
    for fid in (0, 100):
        out, _ = contour.apply(rgb, {"cheekbones": 70, "fidelity": fid})
        dL = lstar(out) - L0
        push[fid] = (float(dL[shadow_m].mean()), float(dL[lit_m].mean()))
    shadow_ratio = push[100][0] / max(1e-6, push[0][0])
    lit_ratio = push[100][1] / max(1e-6, push[0][1])
    check("gate shadow", shadow_ratio <= GATE_SHADOW_MAX,
          f"fid100/fid0 {shadow_ratio:.2f} (<= {GATE_SHADOW_MAX})")
    check("gate lit", lit_ratio >= GATE_LIT_MIN,
          f"fid100/fid0 {lit_ratio:.2f} (>= {GATE_LIT_MIN})")


def rotation(rgb):
    """Band placement must rotate with the face. 180 first, else 90."""
    L0 = lstar(rgb)
    out, _ = contour.apply(rgb, {"cheekbones": 70})
    dodge = (lstar(out) - L0) > 0.5

    for name, fwd, back in (
        ("rot180", cv2.ROTATE_180, cv2.ROTATE_180),
        ("rot90", cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE),
    ):
        rot = cv2.rotate(rgb, fwd)
        out_r, meta_r = contour.apply(np.ascontiguousarray(rot), {"cheekbones": 70})
        if not meta_r.get("applied"):
            print(f"  skip {name}: no face detected after rotation")
            continue
        dodge_r = cv2.rotate(((lstar(out_r) - lstar(rot)) > 0.5).astype(np.uint8), back).astype(bool)
        inter = (dodge & dodge_r).sum()
        union = (dodge | dodge_r).sum()
        iou = inter / max(1, union)
        check(f"pose {name}", iou >= ROT_IOU_MIN, f"dodge IoU {iou:.2f} (>= {ROT_IOU_MIN})")
        return
    print("  skip pose: no rotation survived face detection")


def main():
    paths = sys.argv[1:] or DEFAULT_IMAGES
    ran_battery = ran_rotation = False
    for i, path in enumerate(paths):
        if not pathlib.Path(path).exists():
            print(f"skip {path}: missing")
            continue
        rgb = load(path)
        ctx = face_context(rgb)
        print(f"\n{pathlib.Path(path).name}  face {ctx['fw']:.0f}px" if ctx else f"\n{path}: no face")
        if ctx is None:
            continue
        if not ran_battery:
            axis_battery(rgb, ctx)
            ran_battery = True
        light_gate(rgb, ctx)
        if not ran_rotation:
            rotation(rgb)
            ran_rotation = True

    print(f"\n{'FAIL' if FAILURES else 'PASS'}: {len(FAILURES)} failures"
          + (f" -> {FAILURES}" if FAILURES else ""))
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    main()
