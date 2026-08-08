"""Fetch the model files the engine needs, and derive the ones we export.

Models are not committed to git (binary, ~1GB). Run once after install:
    .venv/Scripts/python setup_models.py

Two kinds of file live in models/:

  DOWNLOADED  published weights, fetched as-is from upstream.
  DERIVED     graphs we export from those weights so the engine can run them
              on onnxruntime instead of torch. Generated here on a developer
              machine; in a packaged build they are bundled prebuilt, because
              the whole point is that the shipped app has no torch to run the
              export with.
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
    # learned skin retouching (DAMO ABPN U-Net, Apache 2.0). The engine does not
    # load this file — it loads abpn_unet.onnx, exported from it below.
    "pytorch_model.pt": (
        "https://www.modelscope.cn/api/v1/models/damo/"
        "cv_unet_skin_retouching_torch/repo?Revision=master&FilePath=pytorch_model.pt"
    ),
    # class-agnostic region segmentation for pixel_color's material anchors
    # (ChaoningZhang/MobileSAM, Apache 2.0 -- verified against the repo's own
    # LICENSE file, not assumed from memory, per the project's own rule).
    "mobile_sam.pt": (
        "https://raw.githubusercontent.com/ChaoningZhang/MobileSAM/master/"
        "weights/mobile_sam.pt"
    ),
}

# name -> (source file it is exported from, export_onnx model id)
#
# `source` is None when the exporter fetches its own weights: DINOv2 comes from
# torch.hub, not from a file in models/, so there is nothing to download first.
DERIVED = {
    "abpn_unet.onnx": ("pytorch_model.pt", "abpn"),
    "dinov2_vits14.onnx": (None, "dinov2"),
}


def _derive(name, source, model_id):
    """Export a graph from weights. Needs torch; dev machines have it.

    A failure here is loud on purpose. The old behaviour when a model file was
    absent was for the tool to return `{"error": "weights missing"}` into a meta
    dict nobody reads — i.e. the tool silently does nothing. Setup is the last
    place that can still say so out loud.
    """
    import export_onnx

    print(f"exporting {name} from {source or 'torch.hub'} ...")
    try:
        if model_id == "abpn":
            export_onnx.export_abpn(17)
        elif model_id == "dinov2":
            export_onnx.export_dinov2(17)
        else:
            raise SystemExit(f"cannot export {name}: unknown model id {model_id!r}")
    except ImportError as e:
        raise SystemExit(
            f"cannot export {name}: {e}\n"
            "torch is a BUILD dependency for this step (see requirements.txt).\n"
            "In a packaged build this file is bundled prebuilt and this step is skipped."
        ) from e


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

    for name, (source, model_id) in DERIVED.items():
        dest = os.path.join(MODELS_DIR, name)
        if os.path.exists(dest):
            print(f"skip {name} (already present)")
            continue
        if source is not None and not os.path.exists(os.path.join(MODELS_DIR, source)):
            raise SystemExit(f"cannot export {name}: {source} was not downloaded")
        _derive(name, source, model_id)
        print(f"  {os.path.getsize(dest) / 1e6:.1f} MB")

    print("done")
