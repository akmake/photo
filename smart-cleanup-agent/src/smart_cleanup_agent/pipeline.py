from __future__ import annotations

import json
import uuid
from pathlib import Path

from PIL import Image

from .config import settings
from .contracts import RunResult
from .restore import IndependentRestorer
from .segment import Segmenter
from .proposal import PixelAnomalyProposer
from .vision import VisionDiagnoser


class SmartCleanupPipeline:
    def __init__(self) -> None:
        self.vision = VisionDiagnoser()
        self.proposer = PixelAnomalyProposer()
        self.segmenter = Segmenter()
        self.restorer = IndependentRestorer()

    def run(self, image: Image.Image, *, clean: bool) -> RunResult:
        run_id = uuid.uuid4().hex
        run_dir = settings.run_dir / run_id
        run_dir.mkdir(parents=True)
        original_path = run_dir / "original.png"
        image.convert("RGB").save(original_path)

        diagnosis = self.vision.diagnose(image.convert("RGB"))
        existing_boxes = [p.box for p in diagnosis.problems]
        for proposal in self.proposer.propose(image):
            if any(
                proposal.box.x1 < box.x2 and proposal.box.x2 > box.x1
                and proposal.box.y1 < box.y2 and proposal.box.y2 > box.y1
                for box in existing_boxes
            ):
                continue
            diagnosis.problems.append(proposal)
        diagnosis = self.segmenter.create_masks(image.convert("RGB"), diagnosis, run_dir / "masks")
        (run_dir / "diagnosis.json").write_text(
            diagnosis.model_dump_json(indent=2), encoding="utf-8"
        )

        result_path: Path | None = None
        status = "analyzed"
        if clean:
            restored = self.restorer.restore(image, diagnosis)
            result_path = run_dir / "result.png"
            restored.save(result_path)
            status = "needs_review" if any(
                not p.safe_to_auto_fix for p in diagnosis.problems
            ) else "cleaned"

        return RunResult(
            run_id=run_id,
            diagnosis=diagnosis,
            original_path=str(original_path),
            result_path=str(result_path) if result_path else None,
            status=status,
        )
