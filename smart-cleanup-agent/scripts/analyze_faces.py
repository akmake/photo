from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from smart_cleanup_agent.face_analysis import FaceDetector, FaceSkinAnalyzer, serializable
from smart_cleanup_agent.face_semantics import (
    FaceSemanticVerifier, confirmed_candidates_for_marks, refine_confirmed_mask,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Face-only skin anomaly analysis; never edits the source image")
    parser.add_argument("image", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--semantic", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    pil = ImageOps.exif_transpose(Image.open(args.image)).convert("RGB")
    rgb = np.asarray(pil)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    detector, analyzer = FaceDetector(), FaceSkinAnalyzer()
    faces = detector.detect(pil)
    candidates = []
    face_crops = {}
    panels = []

    preview = bgr.copy()
    for face in faces:
        x1, y1, x2, y2 = face.box
        crop_x1, crop_y1, crop_x2, crop_y2 = face.crop_box
        crop = bgr[crop_y1:crop_y2, crop_x1:crop_x2].copy()
        face_crops[face.id] = crop.copy()
        safe_skin = analyzer.skin_mask(crop, face)
        face_candidates = analyzer.candidates(crop, safe_skin, face)
        candidates.extend(face_candidates)

        cv2.rectangle(preview, (x1, y1), (x2, y2), (20, 220, 20), max(3, round(x2 - x1) // 100))
        cv2.putText(preview, face.id, (x1, max(30, y1 - 12)), cv2.FONT_HERSHEY_SIMPLEX,
                    max(0.7, (x2 - x1) / 380), (20, 220, 20), 3, cv2.LINE_AA)
        for item in face_candidates:
            bx1, by1, bx2, by2 = item.box
            cv2.rectangle(preview, (bx1, by1), (bx2, by2), (0, 40, 255), 3)
            local_box = (bx1 - crop_x1, by1 - crop_y1, bx2 - crop_x1, by2 - crop_y1)
            cv2.rectangle(crop, local_box[:2], local_box[2:], (0, 40, 255), 2)

        overlay = crop.copy()
        overlay[safe_skin > 0] = (
            overlay[safe_skin > 0].astype(np.float32) * 0.68
            + np.array([30, 190, 30], np.float32) * 0.32
        ).astype(np.uint8)
        crop = cv2.addWeighted(crop, 0.72, overlay, 0.28, 0)
        cv2.putText(crop, f"{face.id}: {len(face_candidates)}", (12, 34),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 220, 20), 2, cv2.LINE_AA)
        crop_path = args.output / f"{face.id}-candidates.jpg"
        cv2.imwrite(str(crop_path), crop)
        panels.append(cv2.resize(crop, (520, 520), interpolation=cv2.INTER_AREA))

    cv2.imwrite(str(args.output / "faces-and-candidates.jpg"), preview)
    if panels:
        cv2.imwrite(str(args.output / "face-candidates-montage.jpg"), np.hstack(panels))
    payload = {
        "source": str(args.image),
        "mode": "face_only_detection_gate",
        "cleaning_performed": False,
        "face_count": len(faces),
        "candidate_count": len(candidates),
        "faces": [serializable(face) for face in faces],
        "candidates": [serializable(item) for item in candidates],
        "warning": "Candidates are high-recall visual anomalies, not yet verified as removable blemishes.",
    }
    (args.output / "face-analysis.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    confirmed = []
    semantic_payload = []
    if args.semantic:
        verifier = FaceSemanticVerifier()
        confirmed_preview = bgr.copy()
        mask_preview = bgr.copy()
        union_mask = np.zeros(bgr.shape[:2], dtype=np.uint8)
        confirmed_panels = []
        for face in faces:
            crop_rgb = cv2.cvtColor(face_crops[face.id], cv2.COLOR_BGR2RGB)
            marks = verifier.verify(Image.fromarray(crop_rgb))
            face_candidates = [item for item in candidates if item.face_id == face.id]
            accepted = confirmed_candidates_for_marks(face_candidates, face, marks)
            safe_skin = analyzer.skin_mask(face_crops[face.id], face)
            refined_mask = refine_confirmed_mask(
                face_crops[face.id], safe_skin, face, marks, accepted,
            )
            crop_x1, crop_y1, crop_x2, crop_y2 = face.crop_box
            union_mask[crop_y1:crop_y2, crop_x1:crop_x2] = cv2.max(
                union_mask[crop_y1:crop_y2, crop_x1:crop_x2], refined_mask,
            )
            confirmed.extend(accepted)
            semantic_payload.append({
                "face_id": face.id,
                "marks": [mark.__dict__ for mark in marks],
                "confirmed_candidate_ids": [item.id for item in accepted],
            })
            x1, y1, x2, y2 = face.box
            color = (20, 220, 20) if not marks else (0, 165, 255)
            cv2.rectangle(confirmed_preview, (x1, y1), (x2, y2), color, 3)
            for item in accepted:
                bx1, by1, bx2, by2 = item.box
                cv2.rectangle(confirmed_preview, (bx1, by1), (bx2, by2), (0, 30, 255), 4)
            panel = face_crops[face.id].copy()
            crop_x1, crop_y1, _, _ = face.crop_box
            for item in accepted:
                bx1, by1, bx2, by2 = item.box
                cv2.rectangle(
                    panel, (bx1 - crop_x1, by1 - crop_y1),
                    (bx2 - crop_x1, by2 - crop_y1), (0, 30, 255), 3,
                )
            label = "clean" if not marks else "; ".join(mark.description for mark in marks)
            cv2.putText(panel, f"{face.id}: {label}", (10, 32),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2, cv2.LINE_AA)
            confirmed_panels.append(cv2.resize(panel, (600, 600), interpolation=cv2.INTER_AREA))
        cv2.imwrite(str(args.output / "semantic-confirmed.jpg"), confirmed_preview)
        cv2.imwrite(str(args.output / "confirmed-mask.png"), union_mask)
        red = np.zeros_like(mask_preview)
        red[..., 2] = 255
        alpha = (union_mask.astype(np.float32) / 255.0 * 0.65)[..., None]
        mask_preview = (
            mask_preview.astype(np.float32) * (1.0 - alpha)
            + red.astype(np.float32) * alpha
        ).astype(np.uint8)
        cv2.imwrite(str(args.output / "confirmed-mask-overlay.jpg"), mask_preview)
        mask_panels = []
        for face in faces:
            crop_x1, crop_y1, crop_x2, crop_y2 = face.crop_box
            panel = mask_preview[crop_y1:crop_y2, crop_x1:crop_x2]
            mask_panels.append(cv2.resize(panel, (600, 600), interpolation=cv2.INTER_AREA))
        cv2.imwrite(
            str(args.output / "confirmed-mask-faces.jpg"),
            np.hstack(mask_panels),
        )
        cv2.imwrite(
            str(args.output / "semantic-confirmed-faces.jpg"),
            np.hstack(confirmed_panels),
        )
        (args.output / "semantic-analysis.json").write_text(
            json.dumps({
                "cleaning_performed": False,
                "faces": semantic_payload,
                "confirmed_candidates": [serializable(item) for item in confirmed],
            }, ensure_ascii=False, indent=2), encoding="utf-8",
        )

    print(json.dumps({
        "faces": len(faces), "candidates": len(candidates),
        "semantic_confirmed": len(confirmed), "output": str(args.output),
    }))


if __name__ == "__main__":
    main()
