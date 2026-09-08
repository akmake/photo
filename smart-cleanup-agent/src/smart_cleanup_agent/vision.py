from __future__ import annotations

import json
import re
from threading import Lock

from PIL import Image, ImageOps

from .config import settings
from .contracts import Diagnosis
from .prompt import DIAGNOSIS_PROMPT


def _json_object(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError(f"Vision model did not return JSON: {text[:240]}")
    return json.loads(cleaned[start : end + 1])


class VisionDiagnoser:
    def __init__(self) -> None:
        self._processor = None
        self._model = None
        self._lock = Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        if self.loaded:
            return
        with self._lock:
            if self.loaded:
                return
            import torch
            from transformers import AutoModelForImageTextToText, AutoProcessor

            self._processor = AutoProcessor.from_pretrained(
                settings.vision_model, cache_dir=settings.model_dir
            )
            self._model = AutoModelForImageTextToText.from_pretrained(
                settings.vision_model,
                cache_dir=settings.model_dir,
                device_map="auto",
                dtype=torch.bfloat16,
            ).eval()

    def diagnose(self, image: Image.Image) -> Diagnosis:
        self.load()
        image = ImageOps.exif_transpose(image).convert("RGB")
        width, height = image.size
        overview = image.copy()
        overview.thumbnail(
            (settings.overview_max_side, settings.overview_max_side),
            Image.Resampling.LANCZOS,
        )
        view_width, view_height = overview.size
        prompt = (
            f"{DIAGNOSIS_PROMPT}\nThe supplied overview dimensions are "
            f"{view_width}x{view_height}; return coordinates in those dimensions."
        )
        messages = [{"role": "user", "content": [
            {"type": "image", "image": overview},
            {"type": "text", "text": prompt},
        ]}]
        inputs = self._processor.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=True,
            return_dict=True, return_tensors="pt"
        ).to(self._model.device)

        import torch
        with torch.inference_mode():
            generated = self._model.generate(
                **inputs, max_new_tokens=settings.max_new_tokens, do_sample=False
            )
        answer = self._processor.decode(
            generated[0][inputs["input_ids"].shape[-1] :], skip_special_tokens=True
        )
        payload = _json_object(answer)
        payload.update({"width": width, "height": height, "model": settings.vision_model})
        diagnosis = Diagnosis.model_validate(payload)
        scale_x, scale_y = width / view_width, height / view_height
        for problem in diagnosis.problems:
            problem.box.x1 = min(round(problem.box.x1 * scale_x), width - 1)
            problem.box.x2 = min(round(problem.box.x2 * scale_x), width)
            problem.box.y1 = min(round(problem.box.y1 * scale_y), height - 1)
            problem.box.y2 = min(round(problem.box.y2 * scale_y), height)
        return diagnosis
