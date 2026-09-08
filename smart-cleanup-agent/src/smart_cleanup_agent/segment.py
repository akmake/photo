from __future__ import annotations

from pathlib import Path
from threading import Lock

import numpy as np
from PIL import Image

from .config import settings
from .contracts import Diagnosis


MASKABLE = {
    "skin_blemish", "temporary_skin_mark", "stray_hair", "clothing_lint",
    "clothing_stain", "sensor_dust", "surface_dirt", "distracting_object",
    "red_eye", "glare", "reflection", "other",
}


class Segmenter:
    def __init__(self) -> None:
        self._processor = None
        self._model = None
        self._device = None
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
            from transformers import Sam2Model, Sam2Processor

            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            self._processor = Sam2Processor.from_pretrained(
                settings.segment_model, cache_dir=settings.model_dir
            )
            self._model = Sam2Model.from_pretrained(
                settings.segment_model, cache_dir=settings.model_dir
            ).to(self._device).eval()

    def create_masks(self, image: Image.Image, diagnosis: Diagnosis, output: Path) -> Diagnosis:
        candidates = [p for p in diagnosis.problems if p.kind.value in MASKABLE]
        if not candidates:
            return diagnosis
        self.load()
        import torch

        boxes = [[[p.box.x1, p.box.y1, p.box.x2, p.box.y2] for p in candidates]]
        inputs = self._processor(images=image, input_boxes=boxes, return_tensors="pt").to(self._device)
        with torch.inference_mode():
            result = self._model(**inputs, multimask_output=False)
        masks = self._processor.post_process_masks(
            result.pred_masks.cpu(), inputs["original_sizes"]
        )[0]
        output.mkdir(parents=True, exist_ok=True)
        for index, problem in enumerate(candidates):
            mask = masks[index, 0].numpy().astype(np.uint8) * 255
            path = output / f"{problem.id}.png"
            Image.fromarray(mask, mode="L").save(path)
            problem.mask_path = str(path)
        return diagnosis
