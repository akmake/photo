"""Objective scorecard for skin cleanup — an INDEPENDENT referee.

Every previous round judged the tool with the tool's own confidence map, which
cannot tell us whether it was right. This module measures the result with
detectors that share no code with `cleanup`:

  blemish index   how much local redness / darkness is still on the skin
                  (a-channel and L residual against a MEDIAN background, which
                  small blobs cannot bend — so it does not inherit the
                  self-absorption failure of the per-face novelty model)
  brow / hair /   how much the tool changed places it must never touch
  eye damage
  tone error      for each repair, how far the result lands from the ring of
                  skin around it. This is what "brown patch" means numerically.
  texture ratio   high-frequency energy inside repairs vs. their surroundings.
                  1.0 = real skin; << 1 = plaster.
  landmark spots  the darkest compact spots (moles) must SURVIVE.

Usage: python test_cleanup_quality.py <image> <outdir> [strength] [label]
Writes metrics.json next to the sheets so runs can be diffed.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import masks

# Lab units. ~3 is around where a mark starts being visible on skin.
REDNESS_BAR = 3.0
DARKNESS_BAR = 3.0


def _protected(rgb, face_d):
    """Everything the tool must not alter: brows, eyes, lips, nose, hair."""
    small = common.downscale(rgb)
    brow = np.zeros(small.shape[:2], np.float32)
    eye = np.zeros(small.shape[:2], np.float32)
    other = np.zeros(small.shape[:2], np.float32)
    for lm in masks._face_landmarks(small):
        for name, part in masks.anatomy_parts(small, lm).items():
            p = part.astype(np.float32) / 255.0
            if name.startswith("brow"):
                brow = np.maximum(brow, p)
            elif name.startswith("eye"):
                eye = np.maximum(eye, p)
            else:
                other = np.maximum(other, p)
    up = lambda m: common.upscale_to(m, rgb.shape)
    return up(brow), up(eye), up(other), masks.get_mask(rgb, "hair")


def _blemish_index(rgb, judge, face_d):
    """Independent measure of remaining marks.

    A median background is essential: a small blob cannot raise its own
    reference, which is precisely the failure of a smooth-field model.

    The headline number is a count of MARKS — compact blobs — not of pixels.
    Raw pixel counts are dominated by ordinary skin texture (measured: 41k "dark"
    px on 173k px of skin, i.e. a quarter of the face, none of it a blemish), so
    they moved almost not at all no matter how much the tool improved. The same
    compactness filter as _diag_recall's ground truth, so the two agree.
    """
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    k = min(99, max(9, int(face_d * 0.10)) | 1)
    a_res = lab[..., 1].astype(np.float32) - cv2.medianBlur(lab[..., 1], k).astype(np.float32)
    l_res = lab[..., 0].astype(np.float32) - cv2.medianBlur(lab[..., 0], k).astype(np.float32)
    use = judge > 0.5
    red = (a_res > REDNESS_BAR) & use
    dark = (l_res < -DARKNESS_BAR) & use
    hit = cv2.morphologyEx(
        (red | dark).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)
    )
    n, labels, stats, _ = cv2.connectedComponentsWithStats(hit, 8)
    marks, mark_px = 0, 0
    severity = np.maximum(a_res, -l_res)
    sev_sum = 0.0
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        w, h = int(stats[i, cv2.CC_STAT_WIDTH]), int(stats[i, cv2.CC_STAT_HEIGHT])
        if area < 15 or area > face_d * face_d * 0.004:
            continue
        if max(w, h) > 4 * max(1, min(w, h)):
            continue
        marks += 1
        mark_px += area
        sev_sum += float(severity[labels == i].sum())
    return dict(
        marks=marks,
        mark_px=mark_px,
        red_px=int(red.sum()),
        severity=round(sev_sum / max(1, mark_px), 2),
    )


def _dark_spots(rgb, judge, face_d, top=6):
    """Compact very dark spots = moles. These must survive cleaning."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    k = max(9, int(face_d * 0.08)) | 1
    res = cv2.medianBlur(lab[..., 0], min(k, 99)).astype(np.float32) - lab[..., 0]
    res *= judge
    blobs = (res > 12).astype(np.uint8)
    blobs = cv2.morphologyEx(blobs, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, labels, stats, cents = cv2.connectedComponentsWithStats(blobs, 8)
    out = []
    for i in range(1, n):
        area = int(stats[i, cv2.CC_STAT_AREA])
        w, h = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        if area < 12 or max(w, h) > face_d * 0.06 or max(w, h) > 3 * min(w, h):
            continue
        out.append((area, (int(cents[i][0]), int(cents[i][1])), labels == i))
    out.sort(key=lambda t: -t[0])
    return out[:top]


def _tone_and_texture(before, after, repair, judge):
    """Per changed component: does it blend with its surroundings AFTERWARDS?

    The ring is sampled from the FINAL image, not the original. Comparing a
    corrected region against the uncorrected skin beside it scores a successful
    colour correction as an artefact — it flagged the tool's four best repairs at
    ~10 Lab and sent me hunting a bug that was the intended effect. The real
    question is only ever whether the result is continuous with what is now
    around it.
    """
    if not repair.any():
        return [], 0.0
    lab_b = cv2.cvtColor(after, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab_a = cv2.cvtColor(after, cv2.COLOR_RGB2LAB).astype(np.float32)
    hi_a = lab_a[..., 0] - cv2.GaussianBlur(lab_a[..., 0], (0, 0), 1.5)
    rows = []
    ratios = []
    n, labels, stats, cents = cv2.connectedComponentsWithStats(repair, 8)
    for i in range(1, n):
        comp = labels == i
        if comp.sum() < 8:
            continue
        rk = max(5, int(np.sqrt(comp.sum()) * 1.2)) | 1
        ring = cv2.dilate(comp.astype(np.uint8), np.ones((rk, rk), np.uint8)).astype(bool)
        ring &= ~comp
        ring &= judge > 0.5
        if ring.sum() < 16:
            continue
        err = float(np.abs(lab_a[comp].mean(axis=0) - lab_b[ring].mean(axis=0)).mean())
        inside = float(np.abs(hi_a[comp]).mean())
        outside = float(np.abs(hi_a[ring]).mean())
        ratio = inside / outside if outside > 1e-4 else 0.0
        ratios.append(ratio)
        rows.append(
            dict(xy=(int(cents[i][0]), int(cents[i][1])), area=int(comp.sum()),
                 tone_err=round(err, 2), texture=round(ratio, 2))
        )
    rows.sort(key=lambda r: -r["tone_err"])
    return rows, float(np.mean(ratios)) if ratios else 0.0


def run(src: str, outdir: Path, strength: float, label: str):
    outdir.mkdir(parents=True, exist_ok=True)
    rgb = common.to_np(common.load_image(src))
    masks.set_source(rgb)

    skin = masks.get_mask(rgb, "face-skin")
    face_d = float(np.sqrt(skin.sum()))
    brow, eye, other, hair = _protected(rgb, face_d)
    oval = masks.get_mask(rgb, "face-oval")
    # Where a blemish may legitimately live: face skin, no features, no hair.
    judge = np.clip(skin * oval - brow - eye - other - hair, 0.0, 1.0)

    moles = _dark_spots(rgb, judge, face_d)

    t0 = time.perf_counter()
    out, meta = cleanup.apply(rgb, {"strength": strength})
    elapsed = time.perf_counter() - t0

    diff = np.abs(out.astype(np.float32) - rgb.astype(np.float32)).mean(axis=2)
    touched = (diff > 1.0).astype(np.uint8)

    before_ix = _blemish_index(rgb, judge, face_d)
    after_ix = _blemish_index(out, judge, face_d)
    rows, tex = _tone_and_texture(rgb, out, touched, judge)

    def dmg(m):
        sel = m > 0.5
        return round(float(diff[sel].mean()), 2) if sel.any() else 0.0, (
            round(float(diff[sel].max()), 1) if sel.any() else 0.0
        )

    brow_d, brow_max = dmg(brow)
    hair_d, hair_max = dmg(hair)
    eye_d, eye_max = dmg(eye)

    # Moles are measured against the PIGMENT stage only, which is the guarantee
    # that actually exists. Spot healing is allowed to remove a mole: that is an
    # explicit product decision (cleanup.confidence, 2026-07-30) on the grounds
    # that a small round dark mark is most of what the healer exists for, and
    # withholding it there had the tool overruling the person using it.
    # Measuring moles through a run with `spots` on therefore scored the tool as
    # broken for obeying its own spec.
    pigment_only, _ = cleanup.apply(
        rgb, {"redness": strength, "spots": 0, "gloss": strength}
    )
    pig_diff = np.abs(pigment_only.astype(np.float32) - rgb.astype(np.float32)).mean(axis=2)
    mole_rows = []
    for area, xy, m in moles:
        mole_rows.append(dict(xy=xy, area=area,
                              changed=round(float(pig_diff[m].mean()), 1),
                              changed_with_healing=round(float(diff[m].mean()), 1)))

    metrics = dict(
        label=label, strength=strength, seconds=round(elapsed, 2),
        face_d=round(face_d, 1),
        judge_px=int((judge > 0.5).sum()),
        touched_px=int(touched.sum()),
        touched_pct_of_skin=round(100.0 * touched.sum() / max(1, (judge > 0.5).sum()), 1),
        blemish_before=before_ix,
        blemish_after=after_ix,
        marks_removed_pct=round(
            100.0 * (1 - after_ix["marks"] / max(1, before_ix["marks"])), 1
        ),
        mark_px_removed_pct=round(
            100.0 * (1 - after_ix["mark_px"] / max(1, before_ix["mark_px"])), 1
        ),
        brow_damage=brow_d, brow_damage_max=brow_max,
        hair_damage=hair_d, hair_damage_max=hair_max,
        eye_damage=eye_d, eye_damage_max=eye_max,
        texture_ratio=round(tex, 2),
        tone_err_mean=round(float(np.mean([r["tone_err"] for r in rows])), 2) if rows else 0.0,
        tone_err_max=round(max([r["tone_err"] for r in rows]), 2) if rows else 0.0,
        tone_err_over_6=sum(1 for r in rows if r["tone_err"] > 6),
        components=len(rows),
        moles=mole_rows,
        engine_meta={k: v for k, v in meta.items() if k != "colorHarmonization"},
    )

    print(f"\n=== {label}  (strength {strength}, {elapsed:.1f}s) ===")
    print(f"face_d {face_d:.0f}  judged skin {metrics['judge_px']}px  "
          f"touched {metrics['touched_px']}px ({metrics['touched_pct_of_skin']}% of skin)")
    print(f"MARKS    before {before_ix['marks']:4d} ({before_ix['mark_px']}px, "
          f"red {before_ix['red_px']}px, sev {before_ix['severity']})")
    print(f"         after  {after_ix['marks']:4d} ({after_ix['mark_px']}px, "
          f"red {after_ix['red_px']}px, sev {after_ix['severity']})"
          f"   -> marks -{metrics['marks_removed_pct']}%  area -{metrics['mark_px_removed_pct']}%")
    print(f"DAMAGE   brow {brow_d} (max {brow_max})   hair {hair_d} (max {hair_max})"
          f"   eye {eye_d} (max {eye_max})")
    print(f"TONE     mean {metrics['tone_err_mean']}  max {metrics['tone_err_max']}"
          f"  over-6: {metrics['tone_err_over_6']}/{len(rows)}")
    print(f"TEXTURE  {tex:.2f}  (1.0 = same as surrounding skin)")
    if mole_rows:
        print("MOLES    (pigment only — healing may legitimately remove them)")
        print("         " + "  ".join(
            f"{m['xy']} d={m['changed']}(+heal {m['changed_with_healing']})"
            for m in mole_rows))
    if rows[:6]:
        print("worst repairs:")
        for r in rows[:6]:
            print(f"   {str(r['xy']):>14} area={r['area']:5d} tone_err={r['tone_err']:5.1f}"
                  f" texture={r['texture']:.2f}")

    (outdir / f"metrics-{label}.json").write_text(json.dumps(metrics, indent=1))

    # ---- visual evidence: the WHOLE face, plus what changed ----------------
    box = common.region_box(skin, int(face_d * 0.35), rgb.shape)
    x0, y0, x1, y1 = box
    heat = rgb.copy().astype(np.float32)
    a = np.clip(diff / 12.0, 0, 1)[..., None]
    heat = np.clip(heat * (1 - a) + np.array([0.0, 255.0, 255.0]) * a, 0, 255).astype(np.uint8)
    for _, xy, _ in moles:
        cv2.circle(heat, xy, max(6, int(face_d * 0.02)), (255, 0, 0), 2)

    panels = [("BEFORE", rgb), ("what changed", heat), ("AFTER", out)]
    imgs = []
    for name, im in panels:
        p = Image.fromarray(im[y0:y1, x0:x1])
        p = p.resize((int(p.width * 900 / p.height), 900), Image.LANCZOS)
        cv = Image.new("RGB", (p.width, p.height + 30), (18, 18, 22))
        cv.paste(p, (0, 30))
        ImageDraw.Draw(cv).text((8, 8), f"{name}  [{label}]", fill=(240, 240, 240))
        imgs.append(cv)
    sheet = Image.new("RGB", (sum(i.width for i in imgs) + 20, imgs[0].height), (18, 18, 22))
    xx = 0
    for i in imgs:
        sheet.paste(i, (xx, 0))
        xx += i.width + 10
    sheet.save(outdir / f"sheet-{label}.jpg", quality=95)
    print("->", outdir / f"sheet-{label}.jpg")

    zooms = []
    for r in rows[:6]:
        cx, cy = r["xy"]
        h = max(40, int(np.sqrt(r["area"]) * 3.0))
        zx0, zy0 = max(0, cx - h), max(0, cy - h)
        zx1, zy1 = min(rgb.shape[1], cx + h), min(rgb.shape[0], cy + h)
        pair = []
        for nm, im in [("before", rgb), ("after", out)]:
            p = Image.fromarray(im[zy0:zy1, zx0:zx1]).resize((290, 290), Image.NEAREST)
            cv = Image.new("RGB", (290, 316), (18, 18, 22))
            cv.paste(p, (0, 26))
            ImageDraw.Draw(cv).text((5, 7), f"{nm} {r['xy']} e={r['tone_err']:.0f}",
                                    fill=(240, 240, 240))
            pair.append(cv)
        row = Image.new("RGB", (590, 316), (18, 18, 22))
        row.paste(pair[0], (0, 0))
        row.paste(pair[1], (300, 0))
        zooms.append(row)
    if zooms:
        cols = 3
        rws = (len(zooms) + cols - 1) // cols
        grid = Image.new("RGB", (cols * 600, rws * 326), (18, 18, 22))
        for n2, z in enumerate(zooms):
            grid.paste(z, ((n2 % cols) * 600, (n2 // cols) * 326))
        grid.save(outdir / f"zooms-{label}.jpg", quality=95)
        print("->", outdir / f"zooms-{label}.jpg")
    return metrics


if __name__ == "__main__":
    run(
        sys.argv[1],
        Path(sys.argv[2]),
        float(sys.argv[3]) if len(sys.argv) > 3 else 100.0,
        sys.argv[4] if len(sys.argv) > 4 else "run",
    )
