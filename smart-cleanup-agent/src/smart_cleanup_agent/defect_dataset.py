from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from torch.utils.data import Dataset


@dataclass(frozen=True)
class DefectRecord:
    id: str
    image: Path
    mask: Path
    protected_mask: Path
    defect_type: str
    source: str
    split: str


def read_manifest(path: Path, split: str | None = None) -> list[DefectRecord]:
    records = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        payload = json.loads(line)
        if split and payload["split"] != split:
            continue
        record = DefectRecord(
            id=payload["id"], image=(path.parent / payload["image"]).resolve(),
            mask=(path.parent / payload["mask"]).resolve(),
            protected_mask=(path.parent / payload["protected_mask"]).resolve(),
            defect_type=payload["defect_type"], source=payload["source"],
            split=payload["split"],
        )
        for field in (record.image, record.mask, record.protected_mask):
            if not field.exists():
                raise FileNotFoundError(f"Manifest line {line_number}: missing {field}")
        records.append(record)
    return records


def mask_box(mask: np.ndarray, jitter: int = 0, rng: np.random.Generator | None = None) -> list[int]:
    ys, xs = np.where(mask > 0)
    if not len(xs):
        raise ValueError("Positive training mask is empty")
    x1, y1, x2, y2 = int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)
    if jitter and rng is not None:
        x1 -= int(rng.integers(0, jitter + 1))
        y1 -= int(rng.integers(0, jitter + 1))
        x2 += int(rng.integers(0, jitter + 1))
        y2 += int(rng.integers(0, jitter + 1))
    return [max(0, x1), max(0, y1), min(mask.shape[1], x2), min(mask.shape[0], y2)]


class PromptedDefectDataset(Dataset):
    def __init__(self, manifest: Path, split: str, seed: int = 1234) -> None:
        self.records = read_manifest(manifest, split)
        self.rng = np.random.default_rng(seed)

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> dict:
        record = self.records[index]
        image = Image.open(record.image).convert("RGB")
        mask = cv2.imread(str(record.mask), cv2.IMREAD_GRAYSCALE)
        protected = cv2.imread(str(record.protected_mask), cv2.IMREAD_GRAYSCALE)
        if mask is None or protected is None:
            raise ValueError(f"Unreadable masks for {record.id}")
        jitter = max(4, round(max(mask.shape) * 0.035))
        return {
            "id": record.id, "image": image,
            "mask": (mask > 127).astype(np.float32),
            "protected_mask": (protected > 127).astype(np.float32),
            "box": mask_box(mask, jitter=jitter, rng=self.rng),
            "defect_type": record.defect_type,
        }
