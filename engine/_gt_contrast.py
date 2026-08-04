"""Does an ABSOLUTE contrast gate separate real marks from anatomy? Measure it.

The detector's bar is in sigmas of THIS face's own variation
(`cleanup._novelty_bar`): `lo = 4.5 - strength*3`, scored against a Mahalanobis
novelty. Nothing anywhere asks how big the deviation is in actual levels. On a
child's flawless skin the model's sigma is tiny, so an ordinary anatomical ramp
— the lower-lid ridge, the philtrum, the alar crease — clears 3.75 sigma while
being invisible to a person.

That predicts a specific fix: require a minimum deviation in L*/a* against the
candidate's own surround, in levels, on top of the sigma bar. This script tests
the prediction before anyone writes the fix: it measures that deviation for
every accepted heal, so the two populations can be looked at side by side.

    python _gt_contrast.py <benchdir> <spots>
"""

from __future__ import annotations

import json
import os
import sys

import cv2
import numpy as np

import cleanup
import common
import masks


def ring_stats(lab, mask, face_d):
    """(dL, dA) of the candidate against a ring of skin just outside it."""
    r = max(3, int(face_d * 0.03)) | 1
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r))
    outer = cv2.dilate(mask, k)
    ring = np.clip(outer - cv2.dilate(mask, cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (3, 3))), 0, 1)
    if mask.sum() < 4 or ring.sum() < 8:
        return None
    inside = lab[mask > 0]
    around = lab[ring > 0]
    return (
        float(np.median(inside[:, 0]) - np.median(around[:, 0])),
        float(np.median(inside[:, 1]) - np.median(around[:, 1])),
        float(np.median(inside[:, 2]) - np.median(around[:, 2])),
    )


def main():
    base = sys.argv[1]
    spots = float(sys.argv[2]) if len(sys.argv) > 2 else 25.0
    recs = json.load(open(os.path.join(base, "bench.json"), encoding="utf-8"))

    rows = []
    for rec in recs:
        if "path" not in rec or not os.path.exists(rec["path"]):
            continue
        rgb = common.to_np(common.load_image(rec["path"]))
        masks.set_source(rgb)
        h, w = rgb.shape[:2]
        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
        det = cleanup.detect(rgb, {"strength": spots})
        by_face = {}
        for c in rec.get("candidates", []):
            if c["spots"] == spots:
                by_face[(c["face"], c["n"])] = c

        counters = {}
        for item in det["items"]:
            f = item["face"]
            counters[f] = counters.get(f, 0) + 1
            meta = by_face.get((f, counters[f]))
            if meta is None or item["verdict"] != "heal":
                continue
            mask = np.zeros((h, w), np.uint8)
            for contour in item["contours"]:
                pts = np.array([[int(px * w), int(py * h)] for px, py in contour],
                               np.int32)
                cv2.fillPoly(mask, [pts], 1)
            st = ring_stats(lab, mask, meta["faceWidthPx"])
            if st is None:
                continue
            dl, da, db = st
            rows.append({
                "image": rec["image"], "face": f, "n": counters[f],
                "kind": item["kind"], "nearest": meta["nearest"],
                "onFeature": meta["onFeature"], "dist": meta["distFaceD"],
                "dL": round(dl, 2), "da": round(da, 2), "db": round(db, 2),
                "mag": round(float(np.hypot(dl, np.hypot(da, db))), 2),
                "areaPx": int(mask.sum()),
                "novelty": item["facts"].get("noveltyPeak"),
            })
        print(f"{rec['image']:24s} {len(rows):4d} rows")

    out = os.path.join(base, f"contrast_s{int(spots)}.json")
    json.dump(rows, open(out, "w", encoding="utf-8"), indent=1)
    print(f"\nwrote {out}  ({len(rows)} heals measured)")


if __name__ == "__main__":
    main()
