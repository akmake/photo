from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .config import settings
from .face_analysis import FaceRegion, SkinCandidate


@dataclass(frozen=True)
class RemovableMark:
    description: str
    region: str
    confidence: float


PROMPT = """
You are the semantic verification stage of a professional portrait-retouching system.
This is one enlarged face crop. Inspect FACIAL SKIN only at high detail. Identify only
temporary removable material or marks: dirt, food, saliva/drool, mucus, a scratch-like
temporary light/dark streak, or a distinct temporary blemish. Ignore normal anatomy,
freckles/moles, eyes, eyelashes, eyebrows, lips, teeth, hair, lighting gradients, shine
that follows face shape, and ordinary skin texture.

Return JSON only using exactly this structure:
{"removable_marks":[{"description":"short factual description","region":"forehead|left_cheek|right_cheek|nose|around_mouth|chin","confidence":0.0}]}
Check forehead, cheeks, nose area, around the mouth, and chin. Do not invent a mark.
""".strip()


def _json_object(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError(f"Face verifier did not return JSON: {text[:240]}")
    return json.loads(cleaned[start:end + 1])


class FaceSemanticVerifier:
    def __init__(self, model_path: Path | None = None) -> None:
        configured = Path(settings.vision_model)
        self.model_path = model_path or (
            configured if configured.exists() else settings.model_dir / "qwen3-vl-4b"
        )
        self._processor = None
        self._model = None

    def load(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        self._processor = AutoProcessor.from_pretrained(self.model_path, local_files_only=True)
        self._model = AutoModelForImageTextToText.from_pretrained(
            self.model_path, local_files_only=True, device_map="auto", dtype=torch.bfloat16,
        ).eval()

    def verify(self, crop: Image.Image) -> list[RemovableMark]:
        self.load()
        messages = [{"role": "user", "content": [
            {"type": "image", "image": crop.convert("RGB")},
            {"type": "text", "text": PROMPT},
        ]}]
        inputs = self._processor.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=True,
            return_dict=True, return_tensors="pt",
        ).to(self._model.device)
        import torch
        with torch.inference_mode():
            generated = self._model.generate(
                **inputs, max_new_tokens=350, do_sample=False,
            )
        answer = self._processor.decode(
            generated[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True,
        )
        payload = _json_object(answer)
        allowed = {"forehead", "left_cheek", "right_cheek", "nose", "around_mouth", "chin"}
        marks = []
        for item in payload.get("removable_marks", []):
            region = str(item.get("region", "")).lower().strip()
            confidence = float(item.get("confidence", 0))
            if region in allowed and confidence >= 0.60:
                marks.append(RemovableMark(
                    description=str(item.get("description", "temporary mark")),
                    region=region, confidence=max(0.0, min(1.0, confidence)),
                ))
        return marks


def candidate_in_region(candidate: SkinCandidate, face: FaceRegion, region: str) -> bool:
    x, y = candidate.center
    x1, y1, x2, y2 = face.box
    width, height = x2 - x1, y2 - y1
    eye_y = sum(point[1] for point in face.landmarks[:2]) / 2
    nose_x, nose_y = face.landmarks[2]
    mouth_y = sum(point[1] for point in face.landmarks[3:5]) / 2
    center_x = (x1 + x2) / 2
    if region == "forehead":
        return y < eye_y - height * 0.04 and y > y1 - height * 0.04
    if region == "chin":
        return y > mouth_y + height * 0.06 and y < y2 + height * 0.12
    if region == "nose":
        return abs(x - nose_x) < width * 0.20 and abs(y - nose_y) < height * 0.20
    if region == "around_mouth":
        return abs(x - center_x) < width * 0.30 and abs(y - mouth_y) < height * 0.22
    if region == "left_cheek":
        return x < center_x and eye_y < y < mouth_y + height * 0.12
    if region == "right_cheek":
        return x >= center_x and eye_y < y < mouth_y + height * 0.12
    return False


def confirmed_candidates_for_marks(
    candidates: list[SkinCandidate], face: FaceRegion, marks: list[RemovableMark]
) -> list[SkinCandidate]:
    accepted: list[SkinCandidate] = []
    mouth_y = sum(point[1] for point in face.landmarks[3:5]) / 2
    face_width = face.box[2] - face.box[0]
    face_height = face.box[3] - face.box[1]
    for mark in marks:
        matching = [item for item in candidates if candidate_in_region(item, face, mark.region)]
        description = mark.description.lower()
        if "drool" in description or "saliva" in description:
            matching = [item for item in matching if item.center[1] > mouth_y + face_height * 0.02]
        if ("line" in description or "streak" in description) and len(matching) > 1:
            # A real thin mark is often split into several neighboring pixel
            # components. Keep the densest cluster and drop isolated highlights.
            remaining = set(range(len(matching)))
            clusters: list[list[SkinCandidate]] = []
            while remaining:
                seed = remaining.pop()
                group_indexes = {seed}
                frontier = [seed]
                while frontier:
                    current = frontier.pop()
                    cx, cy = matching[current].center
                    neighbors = [index for index in remaining if (
                        abs(matching[index].center[0] - cx) <= face_width * 0.14
                        and abs(matching[index].center[1] - cy) <= face_height * 0.13
                    )]
                    for index in neighbors:
                        remaining.remove(index)
                        group_indexes.add(index)
                        frontier.append(index)
                clusters.append([matching[index] for index in group_indexes])
            matching = max(
                clusters, key=lambda group: (len(group), sum(item.score for item in group))
            )
        accepted.extend(matching)
    unique = {item.id: item for item in accepted}
    return list(unique.values())


def refine_confirmed_mask(
    crop_bgr: np.ndarray,
    safe_skin: np.ndarray,
    face: FaceRegion,
    marks: list[RemovableMark],
    accepted: list[SkinCandidate],
) -> np.ndarray:
    """Turn semantic-confirmed proposal fragments into a conservative pixel mask."""
    mask = np.zeros(crop_bgr.shape[:2], dtype=np.uint8)
    if not marks or not accepted:
        return mask
    crop_x, crop_y, _, _ = face.crop_box
    face_width = face.box[2] - face.box[0]
    face_height = face.box[3] - face.box[1]
    luminance = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2LAB)[..., 0]
    kernel_size = max(17, round(min(crop_bgr.shape[:2]) * 0.075) | 1)
    white_hat = cv2.morphologyEx(
        luminance, cv2.MORPH_TOPHAT,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)),
    ).astype(np.float32)

    for mark in marks:
        matching = [item for item in accepted if candidate_in_region(item, face, mark.region)]
        if not matching:
            continue
        x1 = min(item.box[0] for item in matching) - crop_x
        y1 = min(item.box[1] for item in matching) - crop_y
        x2 = max(item.box[2] for item in matching) - crop_x
        y2 = max(item.box[3] for item in matching) - crop_y
        description = mark.description.lower()
        if "line" in description or "streak" in description:
            pad_x, pad_y = round(face_width * 0.16), round(face_height * 0.06)
            close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 5))
        elif "drool" in description or "saliva" in description:
            pad_x, pad_y = round(face_width * 0.08), round(face_height * 0.13)
            close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 13))
        else:
            pad_x, pad_y = round(face_width * 0.06), round(face_height * 0.06)
            close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        x1, y1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
        x2 = min(crop_bgr.shape[1], x2 + pad_x)
        y2 = min(crop_bgr.shape[0], y2 + pad_y)
        roi = np.zeros_like(mask, dtype=bool)
        roi[y1:y2, x1:x2] = True
        valid = roi & safe_skin.astype(bool)
        values = white_hat[valid]
        if values.size < 20:
            continue
        threshold = max(5.0, float(np.quantile(values, 0.94)))
        current = ((white_hat >= threshold) & valid).astype(np.uint8)
        current = cv2.morphologyEx(current, cv2.MORPH_CLOSE, close_kernel)
        current = cv2.dilate(
            current, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
        )
        mask = cv2.max(mask, current * 255)
    return mask
