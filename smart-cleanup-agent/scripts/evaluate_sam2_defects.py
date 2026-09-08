from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import Sam2Model, Sam2Processor

from smart_cleanup_agent.defect_dataset import mask_box, read_manifest


def boundary_f1(prediction: np.ndarray, target: np.ndarray, tolerance: int = 2) -> float:
    kernel = np.ones((3, 3), np.uint8)
    pred_edge = cv2.morphologyEx(prediction, cv2.MORPH_GRADIENT, kernel) > 0
    target_edge = cv2.morphologyEx(target, cv2.MORPH_GRADIENT, kernel) > 0
    if not pred_edge.any() and not target_edge.any():
        return 1.0
    tolerance_kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (tolerance * 2 + 1, tolerance * 2 + 1)
    )
    target_near = cv2.dilate(target_edge.astype(np.uint8), tolerance_kernel) > 0
    pred_near = cv2.dilate(pred_edge.astype(np.uint8), tolerance_kernel) > 0
    precision = float((pred_edge & target_near).sum()) / max(1, int(pred_edge.sum()))
    recall = float((target_edge & pred_near).sum()) / max(1, int(target_edge.sum()))
    return 2 * precision * recall / max(1e-8, precision + recall)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--decoder", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--split", default="validation")
    args = parser.parse_args()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = Sam2Processor.from_pretrained(args.model, local_files_only=True)
    model = Sam2Model.from_pretrained(args.model, local_files_only=True).to(device).eval()
    if args.decoder:
        state = torch.load(args.decoder, map_location=device, weights_only=True)
        model.mask_decoder.load_state_dict(state)
    metrics = []
    for record in read_manifest(args.manifest, args.split):
        image = Image.open(record.image).convert("RGB")
        target = cv2.imread(str(record.mask), cv2.IMREAD_GRAYSCALE)
        protected = cv2.imread(str(record.protected_mask), cv2.IMREAD_GRAYSCALE) > 127
        inputs = processor(
            images=image, input_boxes=[[mask_box(target)]], return_tensors="pt"
        ).to(device)
        with torch.inference_mode():
            output = model(**inputs, multimask_output=False)
        logits = F.interpolate(
            output.pred_masks[:, 0, 0, None], target.shape,
            mode="bilinear", align_corners=False,
        )[0, 0].cpu().numpy()
        prediction = (logits > 0).astype(np.uint8)
        raw_predicted_pixels = max(1, int(prediction.sum()))
        raw_leakage = float((prediction.astype(bool) & protected).sum()) / raw_predicted_pixels
        # This is a hard product invariant, independent of model confidence.
        prediction[protected] = 0
        target_binary = (target > 127).astype(np.uint8)
        intersection = int((prediction & target_binary).sum())
        union = int((prediction | target_binary).sum())
        predicted_pixels = max(1, int(prediction.sum()))
        metrics.append({
            "id": record.id,
            "iou": intersection / max(1, union),
            "dice": 2 * intersection / max(1, int(prediction.sum() + target_binary.sum())),
            "boundary_f1": boundary_f1(prediction, target_binary),
            "raw_protected_leakage": raw_leakage,
            "protected_leakage": float((prediction.astype(bool) & protected).sum()) / predicted_pixels,
        })
    summary = {
        "count": len(metrics),
        "mean_iou": float(np.mean([item["iou"] for item in metrics])) if metrics else 0,
        "mean_dice": float(np.mean([item["dice"] for item in metrics])) if metrics else 0,
        "mean_boundary_f1": float(np.mean([item["boundary_f1"] for item in metrics])) if metrics else 0,
        "mean_raw_protected_leakage": float(np.mean([item["raw_protected_leakage"] for item in metrics])) if metrics else 0,
        "mean_protected_leakage": float(np.mean([item["protected_leakage"] for item in metrics])) if metrics else 0,
    }
    payload = {"summary": summary, "samples": metrics}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
