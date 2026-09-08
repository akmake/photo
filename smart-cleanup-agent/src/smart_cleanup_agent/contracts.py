from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ProblemKind(str, Enum):
    SKIN_BLEMISH = "skin_blemish"
    TEMPORARY_SKIN_MARK = "temporary_skin_mark"
    STRAY_HAIR = "stray_hair"
    CLOTHING_LINT = "clothing_lint"
    CLOTHING_STAIN = "clothing_stain"
    SENSOR_DUST = "sensor_dust"
    SURFACE_DIRT = "surface_dirt"
    DISTRACTING_OBJECT = "distracting_object"
    RED_EYE = "red_eye"
    GLARE = "glare"
    REFLECTION = "reflection"
    COMPRESSION_ARTIFACT = "compression_artifact"
    NOISE = "noise"
    BLUR = "blur"
    EXPOSURE = "exposure"
    COLOR_CAST = "color_cast"
    OTHER = "other"


class Box(BaseModel):
    x1: int = Field(ge=0)
    y1: int = Field(ge=0)
    x2: int = Field(gt=0)
    y2: int = Field(gt=0)

    @field_validator("x2")
    @classmethod
    def x_order(cls, value: int, info):
        if "x1" in info.data and value <= info.data["x1"]:
            raise ValueError("x2 must be greater than x1")
        return value

    @field_validator("y2")
    @classmethod
    def y_order(cls, value: int, info):
        if "y1" in info.data and value <= info.data["y1"]:
            raise ValueError("y2 must be greater than y1")
        return value


class Problem(BaseModel):
    id: str
    kind: ProblemKind
    label: str
    description: str
    box: Box
    confidence: float = Field(ge=0, le=1)
    severity: float = Field(ge=0, le=1)
    safe_to_auto_fix: bool
    preserve_warning: str | None = None
    repair_strategy: Literal[
        "texture_inpaint", "object_inpaint", "color_correct", "denoise",
        "deblur", "exposure_correct", "manual_review"
    ]
    mask_path: str | None = None


class Diagnosis(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    summary: str
    problems: list[Problem]
    model: str


class RunResult(BaseModel):
    run_id: str
    diagnosis: Diagnosis
    original_path: str
    result_path: str | None = None
    status: Literal["analyzed", "cleaned", "needs_review"]

