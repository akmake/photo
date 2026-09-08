from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    vision_model: str = os.getenv("SMART_CLEANUP_VISION_MODEL", "Qwen/Qwen3-VL-4B-Instruct")
    segment_model: str = os.getenv("SMART_CLEANUP_SEGMENT_MODEL", "facebook/sam2.1-hiera-small")
    model_dir: Path = Path(os.getenv("SMART_CLEANUP_MODEL_DIR", "models")).resolve()
    run_dir: Path = Path(os.getenv("SMART_CLEANUP_RUN_DIR", "runs")).resolve()
    annotation_dir: Path = Path(os.getenv("SMART_CLEANUP_ANNOTATION_DIR", "training-data/real-v1")).resolve()
    max_new_tokens: int = int(os.getenv("SMART_CLEANUP_MAX_TOKENS", "600"))
    overview_max_side: int = int(os.getenv("SMART_CLEANUP_OVERVIEW_MAX_SIDE", "1280"))


settings = Settings()
settings.model_dir.mkdir(parents=True, exist_ok=True)
settings.run_dir.mkdir(parents=True, exist_ok=True)
settings.annotation_dir.mkdir(parents=True, exist_ok=True)
