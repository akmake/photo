from __future__ import annotations

from io import BytesIO

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import settings
from .annotation import router as annotation_router
from .pipeline import SmartCleanupPipeline

app = FastAPI(title="Smart Cleanup Agent", version="0.1.0")
app.include_router(annotation_router)
pipeline = SmartCleanupPipeline()


def _image(data: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(data))
        image.load()
        return ImageOps.exif_transpose(image).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Unsupported or damaged image") from exc


@app.get("/health")
def health() -> dict:
    return {
        "status": "ready",
        "independent": True,
        "vision_model": settings.vision_model,
        "vision_loaded": pipeline.vision.loaded,
        "segment_model": settings.segment_model,
        "segment_loaded": pipeline.segmenter.loaded,
    }


@app.post("/v1/analyze")
async def analyze(image: UploadFile = File(...)):
    return pipeline.run(_image(await image.read()), clean=False)


@app.post("/v1/clean")
async def clean(image: UploadFile = File(...)):
    return pipeline.run(_image(await image.read()), clean=True)
