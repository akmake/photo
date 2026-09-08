from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from smart_cleanup_agent.face_analysis import FaceDetector, FaceSkinAnalyzer


TYPES = ("blemish", "scab", "scratch", "dirt", "saliva")


def irregular_blob(shape, center, radius, rng):
    points = []
    count = int(rng.integers(9, 18))
    for index in range(count):
        angle = 2 * np.pi * index / count
        local_radius = radius * float(rng.uniform(0.55, 1.35))
        points.append((
            round(center[0] + np.cos(angle) * local_radius),
            round(center[1] + np.sin(angle) * local_radius),
        ))
    mask = np.zeros(shape, np.uint8)
    cv2.fillPoly(mask, [np.array(points, np.int32)], 255)
    return mask


def defect_mask(shape, defect_type, center, scale, rng):
    mask = np.zeros(shape, np.uint8)
    if defect_type in {"scab", "scratch", "saliva"}:
        length = round(scale * rng.uniform(3.0, 7.0))
        angle = float(rng.uniform(0, 2 * np.pi))
        if defect_type == "saliva":
            angle = float(rng.uniform(1.15, 1.95))
        points = []
        for step in range(7):
            distance = length * step / 6
            points.append((
                round(center[0] + np.cos(angle) * distance + rng.normal(0, scale * 0.25)),
                round(center[1] + np.sin(angle) * distance + rng.normal(0, scale * 0.25)),
            ))
        thickness = max(2, round(scale * (0.45 if defect_type == "scratch" else 0.8)))
        cv2.polylines(mask, [np.array(points, np.int32)], False, 255, thickness, cv2.LINE_AA)
        if defect_type == "scab":
            for point in points[::2]:
                cv2.circle(mask, point, max(2, round(scale * rng.uniform(0.5, 1.1))), 255, -1)
    elif defect_type == "blemish":
        for _ in range(int(rng.integers(1, 5))):
            offset = rng.normal(0, scale * 1.4, 2)
            point = (round(center[0] + offset[0]), round(center[1] + offset[1]))
            cv2.circle(mask, point, max(2, round(scale * rng.uniform(0.45, 1.0))), 255, -1)
    else:
        mask = irregular_blob(shape, center, scale * rng.uniform(1.3, 2.8), rng)
    return mask


def composite(image, mask, defect_type, rng):
    result = image.astype(np.float32).copy()
    colors = {
        "blemish": np.array([115, 55, 65], np.float32),
        "scab": np.array([75, 45, 30], np.float32),
        "scratch": np.array([145, 75, 75], np.float32),
        "dirt": np.array([65, 55, 40], np.float32),
        "saliva": np.array([235, 235, 225], np.float32),
    }
    alpha = float(rng.uniform(0.30, 0.72))
    soft = cv2.GaussianBlur(mask, (0, 0), rng.uniform(0.6, 1.7)).astype(np.float32) / 255.0
    texture = rng.normal(0, 9, image.shape[:2]).astype(np.float32)
    color = colors[defect_type][None, None, :] + texture[..., None]
    blend = (soft * alpha)[..., None]
    result = result * (1 - blend) + color * blend
    return np.clip(result, 0, 255).astype(np.uint8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-faces", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--count", type=int, default=80)
    parser.add_argument("--seed", type=int, default=2026)
    args = parser.parse_args()
    rng = np.random.default_rng(args.seed)
    bases = sorted(path for path in args.base_faces.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png"})
    if not bases:
        raise ValueError("No base face images found")
    for folder in ("images", "masks", "protected"):
        (args.output / folder).mkdir(parents=True, exist_ok=True)
    detector, analyzer = FaceDetector(), FaceSkinAnalyzer()
    records = []
    for index in range(args.count):
        base_path = bases[index % len(bases)]
        pil = Image.open(base_path).convert("RGB")
        faces = detector.detect(pil)
        if not faces:
            raise ValueError(f"No face in {base_path}")
        face = max(faces, key=lambda item: (item.box[2] - item.box[0]) * (item.box[3] - item.box[1]))
        bgr = cv2.cvtColor(np.asarray(pil), cv2.COLOR_RGB2BGR)
        safe = analyzer.skin_mask(bgr, face)
        ys, xs = np.where(safe > 0)
        if not len(xs):
            raise ValueError(f"No safe facial skin in {base_path}")
        chosen = int(rng.integers(0, len(xs)))
        center = (int(xs[chosen]), int(ys[chosen]))
        scale = max(3.0, min(bgr.shape[:2]) * rng.uniform(0.010, 0.028))
        defect_type = TYPES[index % len(TYPES)]
        mask = defect_mask(safe.shape, defect_type, center, scale, rng)
        mask[safe == 0] = 0
        if np.count_nonzero(mask) < 8:
            continue
        generated = composite(bgr, mask, defect_type, rng)
        sample_id = f"bootstrap-{index:05d}"
        image_rel = Path("images") / f"{sample_id}.png"
        mask_rel = Path("masks") / f"{sample_id}.png"
        protected_rel = Path("protected") / f"{sample_id}.png"
        cv2.imwrite(str(args.output / image_rel), generated)
        cv2.imwrite(str(args.output / mask_rel), mask)
        cv2.imwrite(str(args.output / protected_rel), (safe == 0).astype(np.uint8) * 255)
        records.append({
            "id": sample_id, "image": str(image_rel).replace("\\", "/"),
            "mask": str(mask_rel).replace("\\", "/"),
            "protected_mask": str(protected_rel).replace("\\", "/"),
            "defect_type": defect_type, "source": "synthetic_bootstrap",
            "split": "validation" if index % 5 == 0 else "train",
        })
    (args.output / "manifest.jsonl").write_text(
        "\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8"
    )
    print(json.dumps({"generated": len(records), "manifest": str(args.output / 'manifest.jsonl')}))


if __name__ == "__main__":
    main()
