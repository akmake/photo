from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .contracts import Diagnosis


class IndependentRestorer:
    """First independent restorer; replace strategies without changing the API."""

    def restore(self, image: Image.Image, diagnosis: Diagnosis) -> Image.Image:
        rgb = np.asarray(image.convert("RGB"))
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        union = np.zeros(rgb.shape[:2], dtype=np.uint8)

        for problem in diagnosis.problems:
            if not problem.safe_to_auto_fix or not problem.mask_path:
                continue
            if problem.repair_strategy not in {"texture_inpaint", "object_inpaint"}:
                continue
            mask = cv2.imread(str(Path(problem.mask_path)), cv2.IMREAD_GRAYSCALE)
            if mask is not None:
                union = cv2.max(union, mask)

        if not np.any(union):
            return image.copy()
        radius = max(2, min(9, round(min(rgb.shape[:2]) * 0.004)))
        repaired = cv2.inpaint(bgr, union, radius, cv2.INPAINT_TELEA)
        return Image.fromarray(cv2.cvtColor(repaired, cv2.COLOR_BGR2RGB))

