from __future__ import annotations

import json
import re
import math
from threading import Lock

from PIL import Image, ImageOps

from .config import settings
from .contracts import Box, Diagnosis
from .prompt import DIAGNOSIS_PROMPT


def _json_object(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError(f"Vision model did not return JSON: {text[:240]}")
    return json.loads(cleaned[start : end + 1])


def normalized_box_to_pixels(box: Box, width: int, height: int) -> Box:
    """Qwen3-VL uses 0..1000 relative coordinates, independent of overview size.

    Round outwards so small boxes do not collapse. Invalid model output is an
    error, never silently clamped into an apparently valid repair location.
    """
    if width < 1 or height < 1 or box.x2 > 1000 or box.y2 > 1000:
        raise ValueError('Expected a valid image and Qwen3 box in 0..1000')
    return Box(x1=math.floor(box.x1*width/1000),
               y1=math.floor(box.y1*height/1000),
               x2=math.ceil(box.x2*width/1000),
               y2=math.ceil(box.y2*height/1000))


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
        prompt = DIAGNOSIS_PROMPT
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
        for problem in diagnosis.problems:
            problem.box = normalized_box_to_pixels(problem.box, width, height)
        return diagnosis
