"""Ground-truth bench: what a person sees, against what each tool finds.

The project's own survey script (`_survey_folder.py`) deliberately refuses to
score, and it is right — a detector cannot be its own referee. This adds the
missing half: the referee's sheet.

It emits, per face, into SEPARATE folders so the two passes cannot contaminate
each other:

    clean/    the face at native resolution, NOTHING drawn on it. This is what
              the person looks at first, to write the list of real dirt.
    marked/   the same crop with every candidate outlined by a 1px hairline and
              numbered OUTSIDE the shape, so the mark never hides the evidence.
    <name>.json   every candidate, with the fact that decides a false positive:
              its distance to the nearest facial FEATURE landmark (eye corner,
              nostril, lip line, brow) in face-width units.

Run order matters: generate clean/ and read it before opening marked/.

    python _gt_bench.py <folder> <outdir> [strength]
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback

import cv2
import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import masks

# Verdict -> outline colour. Green is "the engine treats it", red is "the engine
# found it and refused"; both are shown, because a wrong refusal and a wrong
# treatment are the two different failures we are hunting.
COLOURS = {
    "heal": (60, 230, 120),
    "line": (255, 120, 120),
    "shading": (255, 190, 90),
    "size": (150, 150, 255),
}

# Feature landmarks a candidate must NOT be sitting on. Anything within
# NEAR_FEATURE of one of these is a suspected false positive on anatomy.
NEAR_FEATURE = 0.10  # in face-width units


def feature_points(lm, w, h):
    """{label: [(x, y), ...]} in pixels — the anatomy a blemish is never on."""
    pts = {
        "eye-corner": [33, 133, 263, 362],
        "nostril": [129, 358, 98, 327],
        "lip": list(masks.LIPS),
        "brow": list(masks.LEFT_EYEBROW) + list(masks.RIGHT_EYEBROW),
        "eye-rim": list(masks.LEFT_EYE) + list(masks.RIGHT_EYE),
    }
    return {
        label: [(lm[i].x * w, lm[i].y * h) for i in idx] for label, idx in pts.items()
    }


def nearest_feature(cx, cy, feats, face_d):
    best_label, best_d = "none", 9.9
    for label, points in feats.items():
        for px, py in points:
            d = float(np.hypot(cx - px, cy - py)) / face_d
            if d < best_d:
                best_label, best_d = label, d
    return best_label, round(best_d, 3)


def crop_box(lm, w, h):
    xs = np.array([p.x * w for p in lm])
    ys = np.array([p.y * h for p in lm])
    face_d = float(
        np.hypot(
            (lm[masks.FACE_RIGHT].x - lm[masks.FACE_LEFT].x) * w,
            (lm[masks.FACE_RIGHT].y - lm[masks.FACE_LEFT].y) * h,
        )
    )
    pad = face_d * 0.30
    x0 = max(0, int(xs.min() - pad))
    x1 = min(w, int(xs.max() + pad))
    y0 = max(0, int(ys.min() - pad))
    y1 = min(h, int(ys.max() + face_d * 0.45))
    return (x0, y0, x1, y1), face_d


def draw_marks(crop, items, box, w, h, scale):
    """1px outline + a number set OUTSIDE the shape. Never a fill."""
    x0, y0 = box[0], box[1]
    img = crop.copy()
    labels = []
    for n, item in enumerate(items, 1):
        colour = COLOURS.get(item["verdict"], (200, 200, 200))
        for contour in item["contours"]:
            pts = np.array(
                [
                    [int((px * w - x0) * scale), int((py * h - y0) * scale)]
                    for px, py in contour
                ],
                np.int32,
            )
            if len(pts) >= 2:
                cv2.polylines(img, [pts], True, colour, 1, cv2.LINE_AA)
        bx0, by0, bx1, by1 = item["bbox"]
        labels.append(
            (
                n,
                int((bx1 * w - x0) * scale) + 3,
                int((by0 * h - y0) * scale) - 2,
                colour,
            )
        )
    pil = Image.fromarray(img)
    drw = ImageDraw.Draw(pil)
    for n, lx, ly, colour in labels:
        drw.text((lx, max(0, ly)), str(n), fill=colour)
    return pil


def survey(path: str, out: str, strengths: list) -> dict:
    """`strengths` is the SPOT dial, because that is what drives detection.

    `cleanup.apply` hands the spot half its own strength (`_params`), so
    `detect(strength=25)` is literally what the shipped default sees, and
    `detect(strength=100)` is the ceiling — everything the detector can see at
    all. Running both is the only way to tell "the tool missed it" apart from
    "the tool saw it and the default is too timid".
    """
    name = os.path.splitext(os.path.basename(path))[0]
    folder = os.path.basename(os.path.dirname(path))
    tag = f"{folder}_{name}"
    rgb = common.to_np(common.load_image(path))
    masks.set_source(rgb)
    h, w = rgb.shape[:2]

    t0 = time.time()
    faces = masks._face_landmarks(rgb) or []
    dets = {s: cleanup.detect(rgb, {"strength": s}) for s in strengths}
    elapsed = time.time() - t0

    record = {
        "image": tag,
        "path": path,
        "size": [w, h],
        "faces": len(faces),
        "seconds": round(elapsed, 1),
        "notes": {s: d["notes"] for s, d in dets.items()},
        "candidates": [],
    }

    for index, lm in enumerate(faces):
        box, face_d = crop_box(lm, w, h)
        x0, y0, x1, y1 = box
        if x1 - x0 < 60 or y1 - y0 < 60:
            continue
        feats = feature_points(lm, w, h)

        # Viewing scale, not working scale. These are 5472px frames with 250px
        # faces in them — at native crop size a 6px blemish is unjudgeable by
        # eye, and the whole point of this bench is the eye. Detection already
        # ran at full resolution; this only resamples what the referee looks at.
        crop = rgb[y0:y1, x0:x1]
        scale = 1150.0 / max(1, crop.shape[0])
        crop = cv2.resize(
            crop,
            (int(crop.shape[1] * scale), int(crop.shape[0] * scale)),
            interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4,
        )
        Image.fromarray(crop).save(
            os.path.join(out, "clean", f"{tag}_f{index}.jpg"), quality=95
        )

        for strength, det in dets.items():
            mine = [
                it for it in det["items"] if it["face"] == index or det["faces"] < 2
            ]
            # with one detect box for the frame, keep only what lands in this face
            mine = [
                it
                for it in mine
                if x0 <= it["bbox"][0] * w <= x1 and y0 <= it["bbox"][1] * h <= y1
            ]
            draw_marks(crop, mine, box, w, h, scale).save(
                os.path.join(out, "marked", f"{tag}_f{index}_s{int(strength)}.jpg"),
                quality=95,
            )
            for n, item in enumerate(mine, 1):
                bx0, by0, bx1, by1 = item["bbox"]
                cx, cy = (bx0 + bx1) / 2 * w, (by0 + by1) / 2 * h
                label, dist = nearest_feature(cx, cy, feats, face_d)
                record["candidates"].append(
                    {
                        "n": n,
                        "spots": strength,
                        "face": index,
                        "faceWidthPx": int(face_d),
                        "kind": item["kind"],
                        "verdict": item["verdict"],
                        "bboxFrame": [round(bx0, 5), round(by0, 5),
                                      round(bx1, 5), round(by1, 5)],
                        "widthPx": round((bx1 - bx0) * w, 1),
                        "heightPx": round((by1 - by0) * h, 1),
                        "nearest": label,
                        "distFaceD": dist,
                        "onFeature": dist < NEAR_FEATURE,
                        "facts": item["facts"],
                    }
                )

    per = []
    for s in strengths:
        heals = [c for c in record["candidates"]
                 if c["spots"] == s and c["verdict"] == "heal"]
        record[f"heal@{int(s)}"] = len(heals)
        record[f"healOnFeature@{int(s)}"] = sum(1 for c in heals if c["onFeature"])
        per.append(f"s{int(s)}: heal={len(heals):3d} onFeat={record[f'healOnFeature@{int(s)}']:2d}")
    print(f"{tag:24s} faces={len(faces)}  {'  '.join(per)}  {elapsed:5.0f}s")
    return record


def main():
    folder, out = sys.argv[1], sys.argv[2]
    strengths = [float(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 else [25.0, 100.0]
    for sub in ("clean", "marked"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)

    paths = []
    if os.path.isfile(folder):  # a single frame, for calibration runs
        paths.append(folder)
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                paths.append(os.path.join(root, f))
    print(f"{len(paths)} images, spot strengths={strengths}\n")

    records = []
    for p in paths:
        try:
            records.append(survey(p, out, strengths))
        except Exception as exc:  # one bad frame must not lose the run
            print(f"{os.path.basename(p):24s} FAILED: {exc}")
            traceback.print_exc()
            records.append({"image": os.path.basename(p), "error": str(exc)})
    with open(os.path.join(out, "bench.json"), "w", encoding="utf-8") as fh:
        json.dump(records, fh, indent=1, ensure_ascii=False)
    print(f"\nwrote {out}/bench.json")


if __name__ == "__main__":
    main()
