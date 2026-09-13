"""Evaluate the skin-retouch tool on a FIXED set of real photographs.

    python tools/evaluate_skin_retouch.py [--params '{"blemishes":100,"evenness":70}'] [image ...]

Writes, per face, to test-results/skin-retouch/<run>/:
  <photo>-f<i>.jpg        before | what was removed (hairline outline) | after
  <photo>-f<i>-100.jpg    the same at 100%, centred on the cheek
and prints one line of measurements per face. The measurements are what an
image CAN be held to without a retoucher's reference; they are not a verdict
on whether it looks right. That is judged on the sheets, whole face and 100%.

Measurements (skin only, per face):
  blush     cheek colour drift over CLEAN cheek pixels, Lab units — the
            test_blush.py assertion and its 0.6 bar
  seam      change in the face-vs-neck colour difference across the jaw, ΔE
  marks     an independent detector (local median residual, shares no code
            with the tool) finds marks; each is classed by how its deviation
            from the ring around it changed:
              healed   |dev| <= 1 on L and a
              reduced  smaller, same sign
              INVERTED sign flipped and still visible (> 2) — the documented
                       failure of the retired face-retouch
              AMPLIFIED larger than before by > 1
  texture   std of the fine band (sigma 0.0068 face widths) outside the removed
            pixels, after/before in %
  shape     mean |ΔL| of the broad light field (sigma 0.15 face widths)
"""

import argparse
import json
import os
import sys
import time

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "engine")
sys.path.insert(0, ENGINE)

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import common  # noqa: E402
import masks  # noqa: E402
import skin_retouch  # noqa: E402
from test_blush import cheek_stats, clean_cheeks  # noqa: E402

D = r"C:\Users\yosef dahan\Downloads\17072026"
FAMILY = D + r"\44\ענן — צילומי משפחה — 05.08\תמונות גלם"
DESK = r"C:\Users\yosef dahan\Desktop\תמונות לא"
FIXED_SET = [
    D + r"\istockphoto-971105428-2048x2048.jpg",   # heavy acne — stress
    FAMILY + r"\321A5015.JPG",                     # chin pimple, beard, three faces
    FAMILY + r"\321A5078.JPG",                     # seven faces, beards, chin wound
    FAMILY + r"\321A1809.JPG",                     # four children, forehead mark
    DESK + r"\321A2727.JPG",                       # a real mole on the cheek
    DESK + r"\321A3057.JPG",                       # mature skin
    DESK + r"\321A2729.JPG",                       # child, freckles
    FAMILY + r"\321A5117.JPG",                     # clean skin — must barely move
    D + r"\jm__yg0J2rjsE-dhAL\321A5601.JPG",       # clean skin, very large face
]

OUT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test-results", "skin-retouch")


def lab(rgb):
    return cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2Lab)


def marks_report(before, after, skin, removal_ignored, fw):
    lb, la = lab(before), lab(after)
    k = min(99, max(9, int(fw * 0.10)) | 1)
    b8 = cv2.cvtColor(before, cv2.COLOR_RGB2LAB)
    a_res = b8[..., 1].astype(np.float32) - cv2.medianBlur(b8[..., 1], k).astype(np.float32)
    l_res = b8[..., 0].astype(np.float32) - cv2.medianBlur(b8[..., 0], k).astype(np.float32)
    cand = (((a_res > 3.0) | (l_res < -3.0)) & (skin > 0.5)).astype(np.uint8)
    cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, lab_ids, stats, _ = cv2.connectedComponentsWithStats(cand, 8)
    max_area = np.pi * (fw * 0.04) ** 2
    counts = dict(marks=0, healed=0, reduced=0, inverted=0, amplified=0, unchanged=0)
    ring_k = np.ones((max(3, int(fw * 0.02)) | 1,) * 2, np.uint8)
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < 4 or area > max_area:
            continue
        x, y, w, h = stats[i, :4]
        pad = max(4, int(fw * 0.03))
        ys, xs = slice(max(0, y - pad), y + h + pad), slice(max(0, x - pad), x + w + pad)
        core = lab_ids[ys, xs] == i
        ring = (cv2.dilate(core.astype(np.uint8), ring_k) > 0) & ~core & (skin[ys, xs] > 0.5) & (cand[ys, xs] == 0)
        if ring.sum() < 8:
            continue
        counts["marks"] += 1
        db = np.array([lb[ys, xs][core][:, c].mean() - np.median(lb[ys, xs][ring][:, c]) for c in (0, 1)])
        da = np.array([la[ys, xs][core][:, c].mean() - np.median(la[ys, xs][ring][:, c]) for c in (0, 1)])
        if np.all(np.abs(da) <= 1.0):
            counts["healed"] += 1
        elif np.any((np.sign(da) != np.sign(db)) & (np.abs(da) > 2.0) & (np.abs(db) > 2.0)):
            counts["inverted"] += 1
        elif np.any(np.abs(da) > np.abs(db) + 1.0):
            counts["amplified"] += 1
        elif np.all(np.abs(da) < np.abs(db) - 0.5):
            counts["reduced"] += 1
        else:
            counts["unchanged"] += 1
    return counts


def seam_change(before, after, face_skin, body_skin, fw):
    band = max(3, int(fw * 0.10)) | 1
    k = np.ones((band, band), np.uint8)
    f = face_skin > 0.5
    b = body_skin > 0.5
    face_side = f & (cv2.dilate(b.astype(np.uint8), k) > 0)
    neck_side = b & (cv2.dilate(f.astype(np.uint8), k) > 0)
    if face_side.sum() < 64 or neck_side.sum() < 64:
        return None
    lb, la = lab(before), lab(after)
    gap_b = lb[face_side].mean(0) - lb[neck_side].mean(0)
    gap_a = la[face_side].mean(0) - la[neck_side].mean(0)
    return float(np.linalg.norm(gap_a - gap_b))


def outline(img, mask, color=(0, 255, 255)):
    out = img.copy()
    cnts, _ = cv2.findContours((mask > 0).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(out, cnts, -1, color, 1)
    return out


def label(img, text):
    out = img.copy()
    s = max(0.5, img.shape[1] / 900)
    for col, th in (((0, 0, 0), 5), ((255, 255, 255), 2)):
        cv2.putText(out, text, (int(12 * s), int(36 * s)), cv2.FONT_HERSHEY_SIMPLEX, 1.0 * s, col, max(1, int(th * s)))
    return out


def evaluate(path, params, run_dir):
    rgb = common.to_np(common.load_image(path))
    name = os.path.splitext(os.path.basename(path))[0][-10:]
    t0 = time.perf_counter()
    out, meta = skin_retouch.apply(rgb, params)
    total_ms = (time.perf_counter() - t0) * 1000
    print(f"\n{name}: {rgb.shape[1]}x{rgb.shape[0]}  {total_ms:.0f}ms  meta={meta}")
    h, w = rgb.shape[:2]
    for fi, ((x0, y0, x1, y1), fw) in enumerate(skin_retouch.face_crops(rgb)):
        if common.face_verdict(fw, skin_retouch.MIN_FACE_PX):
            print(f"  f{fi}: {int(fw)}px — refused (face too small)")
            continue
        box_id = "skin-retouch-%.4f,%.4f,%.4f,%.4f" % (x0 / w, y0 / h, x1 / w, y1 / h)
        bc, ac = rgb[y0:y1, x0:x1], out[y0:y1, x0:x1]
        with masks.scope(box_id):
            fskin = masks.get_mask(bc, "face-skin")
            bskin = masks.get_mask(bc, "body-skin")
            feats = masks.get_mask(bc, "face-features")
            cheeks = clean_cheeks(bc, masks.get_mask(bc, "cheeks"))
        skin = np.maximum(fskin, bskin)
        allowed = ((skin > 0.5) & (feats < 0.05)).astype(np.float32)
        keep = skin_retouch._switch(params.get("keepMoles", skin_retouch.DEFAULT_KEEP_MOLES),
                                    skin_retouch.DEFAULT_KEEP_MOLES)
        analysed = skin_retouch._analyse(np.ascontiguousarray(bc), allowed, skin, fw, keep)
        removal = analysed["removal"] > 0
        moles = analysed["moles"]

        cs_b, cs_a = cheek_stats(bc, cheeks), cheek_stats(ac, cheeks)
        blush = None if cs_b is None else float(np.abs(cs_a - cs_b).max())
        seam = seam_change(bc, ac, fskin, bskin, fw)
        mk = marks_report(bc, ac, np.where(feats < 0.05, fskin, 0), removal, fw)
        sel = (fskin > 0.5) & (feats < 0.05) & ~cv2.dilate(removal.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
        sig = max(1.5, fw * 0.0068)
        lb, la = lab(bc)[..., 0], lab(ac)[..., 0]
        hb, ha = lb - cv2.GaussianBlur(lb, (0, 0), sig), la - cv2.GaussianBlur(la, (0, 0), sig)
        texture = 100.0 * float(ha[sel].std() / max(1e-6, hb[sel].std()))
        shape = float(np.abs(cv2.GaussianBlur(la, (0, 0), fw * 0.15) - cv2.GaussianBlur(lb, (0, 0), fw * 0.15))[sel].mean())
        print(f"  f{fi}: {int(fw)}px  removedPx={int(removal.sum())}  blush={blush if blush is None else round(blush, 2)}"
              f"  seam={seam if seam is None else round(seam, 2)}  texture={texture:.1f}%  shape={shape:.2f}  marks={mk}")

        marked = outline(outline(bc, removal), moles, (255, 0, 255))
        sheet = np.hstack([label(bc, "before"), label(marked, "removed (cyan) / kept (magenta)"), label(ac, "after")])
        H = 1100
        sheet = cv2.resize(sheet, (int(sheet.shape[1] * H / sheet.shape[0]), H),
                           interpolation=cv2.INTER_AREA if sheet.shape[0] > H else cv2.INTER_CUBIC)
        cv2.imwrite(os.path.join(run_dir, f"{name}-f{fi}.jpg"), cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])

        cy, cx = int((y1 - y0) * 0.55), (x1 - x0) // 2
        r = min(350, cy, cx, (y1 - y0) - cy, (x1 - x0) - cx)
        win = (slice(cy - r, cy + r), slice(cx - r, cx + r))
        det = np.hstack([label(bc[win], "before 100%"), label(marked[win], "removed / kept"), label(ac[win], "after 100%")])
        cv2.imwrite(os.path.join(run_dir, f"{name}-f{fi}-100.jpg"), cv2.cvtColor(det, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--params", default=json.dumps({"blemishes": skin_retouch.DEFAULT_BLEMISHES,
                                                     "evenness": skin_retouch.DEFAULT_EVENNESS}))
    ap.add_argument("--run", default="default")
    ap.add_argument("images", nargs="*")
    a = ap.parse_args()
    params = json.loads(a.params)
    run_dir = os.path.join(OUT_ROOT, a.run)
    os.makedirs(run_dir, exist_ok=True)
    print("params:", params, "->", os.path.abspath(run_dir))
    for p in a.images or FIXED_SET:
        if not os.path.exists(p):
            print(f"\nMISSING {p}")
            continue
        evaluate(p, params, run_dir)


if __name__ == "__main__":
    main()
