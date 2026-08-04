"""The second half of the bench: what each tool actually DID to the face.

`_gt_bench.py` answers "what did it mark". Only one of the two tools can answer
that — `face-retouch` is a learned model with no candidate list at all. So the
common currency between them is the pixels: identical crop, identical viewing
scale, three panels per face.

    clean/          untouched            (written by _gt_bench)
    after_cleanup/  skin-cleanup applied
    after_retouch/  face-retouch applied

Crops come from `_gt_bench.crop_box`, so a mark sits at the same coordinate in
all three and the eye can flick between them without re-locating anything.

    python _gt_effect.py <folder> <outdir> [redness,spots] [retouchStrength]
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback

import cv2
import numpy as np
from PIL import Image

import abpn
import cleanup
import common
import masks
from _gt_bench import crop_box


def view(rgb, box):
    x0, y0, x1, y1 = box
    crop = rgb[y0:y1, x0:x1]
    scale = 1150.0 / max(1, crop.shape[0])
    return cv2.resize(
        crop,
        (int(crop.shape[1] * scale), int(crop.shape[0] * scale)),
        interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4,
    )


def run(path: str, out: str, clean_params: dict, retouch: float) -> dict:
    name = os.path.splitext(os.path.basename(path))[0]
    tag = f"{os.path.basename(os.path.dirname(path))}_{name}"
    rgb = common.to_np(common.load_image(path))
    masks.set_source(rgb)
    faces = masks._face_landmarks(rgb) or []
    h, w = rgb.shape[:2]

    t0 = time.time()
    cleaned, cmeta = cleanup.apply(rgb, dict(clean_params))
    retouched, rmeta = abpn.apply(rgb, {"strength": retouch})
    elapsed = time.time() - t0

    for index, lm in enumerate(faces):
        box, _ = crop_box(lm, w, h)
        if box[2] - box[0] < 60 or box[3] - box[1] < 60:
            continue
        Image.fromarray(view(cleaned, box)).save(
            os.path.join(out, "after_cleanup", f"{tag}_f{index}.jpg"), quality=95
        )
        Image.fromarray(view(retouched, box)).save(
            os.path.join(out, "after_retouch", f"{tag}_f{index}.jpg"), quality=95
        )

    def changed(other):
        d = np.abs(other.astype(np.float32) - rgb.astype(np.float32)).mean(axis=2)
        return int((d > 1.0).sum()), round(float(d.max()), 1)

    c_px, c_max = changed(cleaned)
    r_px, r_max = changed(retouched)
    rec = {
        "image": tag,
        "faces": len(faces),
        "seconds": round(elapsed, 1),
        "cleanup": {"changedPx": c_px, "maxDelta": c_max,
                    "meta": {k: v for k, v in cmeta.items()
                             if k != "colorHarmonization"}},
        "retouch": {"changedPx": r_px, "maxDelta": r_max, "meta": rmeta},
    }
    print(f"{tag:24s} faces={len(faces)} cleanupPx={c_px:8d} retouchPx={r_px:8d}"
          f"  {elapsed:5.0f}s")
    return rec


def main():
    folder, out = sys.argv[1], sys.argv[2]
    rn, sp = (sys.argv[3].split(",") if len(sys.argv) > 3 else ["90", "25"])
    retouch = float(sys.argv[4]) if len(sys.argv) > 4 else 70.0
    clean_params = {"redness": float(rn), "spots": float(sp)}
    for sub in ("after_cleanup", "after_retouch"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)

    paths = []
    if os.path.isfile(folder):
        paths.append(folder)
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                paths.append(os.path.join(root, f))
    print(f"{len(paths)} images  cleanup={clean_params}  retouch={retouch}\n")

    records = []
    for p in paths:
        try:
            records.append(run(p, out, clean_params, retouch))
        except Exception as exc:  # one bad frame must not lose the run
            print(f"{os.path.basename(p):24s} FAILED: {exc}")
            traceback.print_exc()
            records.append({"image": os.path.basename(p), "error": str(exc)})
    with open(os.path.join(out, "effect.json"), "w", encoding="utf-8") as fh:
        json.dump(records, fh, indent=1, ensure_ascii=False)
    print(f"\nwrote {out}/effect.json")


if __name__ == "__main__":
    main()
