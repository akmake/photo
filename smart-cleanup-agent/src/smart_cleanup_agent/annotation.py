from __future__ import annotations

import json
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .config import settings


router = APIRouter()
STATIC = Path(__file__).with_name("static")


@router.get("/annotator")
def annotator():
    return FileResponse(STATIC / "annotator.html")


def _decode_png(data: bytes, label: str) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise HTTPException(400, f"Invalid {label}")
    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY if image.shape[2] == 4 else cv2.COLOR_BGR2GRAY)
    return image


@router.post("/v1/annotations")
async def save_annotation(
    image: UploadFile = File(...),
    defect_mask: UploadFile = File(...),
    protected_mask: UploadFile = File(...),
    defect_type: str = Form(...),
    split: str = Form("train"),
):
    allowed_types = {"blemish", "wound_scab", "scratch", "dirt_food", "saliva_mucus", "other"}
    if defect_type not in allowed_types or split not in {"train", "validation", "test"}:
        raise HTTPException(400, "Invalid annotation metadata")
    image_bytes = await image.read()
    source = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    defect = _decode_png(await defect_mask.read(), "defect mask")
    protected = _decode_png(await protected_mask.read(), "protected mask")
    if source is None or defect.shape != source.shape[:2] or protected.shape != source.shape[:2]:
        raise HTTPException(400, "Image and masks must have identical dimensions")
    defect = (defect > 127).astype(np.uint8) * 255
    protected = (protected > 127).astype(np.uint8) * 255
    defect[protected > 0] = 0
    if not np.any(defect):
        raise HTTPException(400, "Defect mask is empty")
    sample_id = f"real-{uuid.uuid4().hex}"
    root = settings.annotation_dir
    for folder in ("images", "masks", "protected"):
        (root / folder).mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(root / "images" / f"{sample_id}.png"), source)
    cv2.imwrite(str(root / "masks" / f"{sample_id}.png"), defect)
    cv2.imwrite(str(root / "protected" / f"{sample_id}.png"), protected)
    record = {
        "id": sample_id, "image": f"images/{sample_id}.png",
        "mask": f"masks/{sample_id}.png",
        "protected_mask": f"protected/{sample_id}.png",
        "defect_type": defect_type, "source": "real_annotated", "split": split,
    }
    with (root / "manifest.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
    return {"saved": True, "id": sample_id}
