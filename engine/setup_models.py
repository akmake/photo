"""Download the MediaPipe model files the engine needs.

Models are not committed to git (binary, ~20MB). Run once after install:
    .venv/Scripts/python setup_models.py
"""

import os
import urllib.request

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")

MODELS = {
    # multiclass selfie segmenter: background / hair / body-skin / face-skin / clothes
    "selfie_multiclass_256x256.tflite": (
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
        "selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"
    ),
    # 478-point face landmarks (eyes, cheeks, face oval)
    "face_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/latest/face_landmarker.task"
    ),
    # monocular depth (MiDaS small, MIT) — depth-of-field gradient
    "midas_small.onnx": (
        "https://github.com/isl-org/MiDaS/releases/download/v2_1/model-small.onnx"
    ),
}

if __name__ == "__main__":
    os.makedirs(MODELS_DIR, exist_ok=True)
    for name, url in MODELS.items():
        dest = os.path.join(MODELS_DIR, name)
        if os.path.exists(dest):
            print(f"skip {name} (already present)")
            continue
        print(f"downloading {name} ...")
        urllib.request.urlretrieve(url, dest)
        print(f"  {os.path.getsize(dest) / 1e6:.1f} MB")
    print("done")
