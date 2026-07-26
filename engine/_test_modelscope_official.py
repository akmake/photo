"""Run DAMO ModelScope's official skin-retouching code as a reference.

The published wrapper defaults to ``retouch_local = False`` and whitening on.
This test saves both that default output and a local-blemish-only output made
by calling the wrapper's own ``retouch_local`` method and utility functions.
No project healing or detection code participates in the local result.
"""

from __future__ import annotations

import importlib
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw

import common
import masks

from modelscope.outputs import OutputKeys
from modelscope.pipelines import pipeline
from modelscope.preprocessors import LoadImage


SRC = sys.argv[1]
MODEL_DIR = sys.argv[2]
OUT_DIR = Path(sys.argv[3])
OUT_DIR.mkdir(parents=True, exist_ok=True)


started = time.perf_counter()
official = pipeline(
    "skin-retouching-torch",
    model=MODEL_DIR,
    device="cpu",
    trust_remote_code=True,
)
print(f"pipeline init: {time.perf_counter() - started:.1f}s")

started = time.perf_counter()
default_bgr = official(SRC)[OutputKeys.OUTPUT_IMG]
print(f"official default: {time.perf_counter() - started:.1f}s")
cv2.imwrite(str(OUT_DIR / "official-default-full.jpg"), default_bgr)

# Use the exact helper functions imported by the downloaded official wrapper.
wrapper = importlib.import_module(official.__class__.__module__)
source = LoadImage.convert_to_ndarray(SRC).astype(np.uint8)
output_pred = torch.from_numpy(source.copy())

started = time.perf_counter()
det_results = official.detector(source)
face_records = []
for index in range(len(det_results["scores"])):
    face_records.append({
        "bbox": np.asarray(det_results["boxes"][index]).astype(np.int32).tolist(),
        "score": det_results["scores"][index],
        "landmarks": np.asarray(det_results["keypoints"][index])
        .astype(np.int32)
        .reshape(5, 2)
        .tolist(),
    })

crop_bboxes = wrapper.get_crop_bbox(face_records)
print(f"official faces: {len(crop_bboxes)}")
for bbox in crop_bboxes:
    roi, _, crop_tblr = wrapper.get_roi_without_padding(source, bbox)
    roi = wrapper.preprocess_roi(wrapper.roi_to_tensor(roi)).to(official.device)
    local = official.retouch_local(roi)
    local_pred = (
        ((local[0].permute(1, 2, 0) + 1.0) / 2.0) * 255.0
    ).clamp(0, 255).byte().cpu()
    output_pred[
        crop_tblr[0] : crop_tblr[1],
        crop_tblr[2] : crop_tblr[3],
    ] = local_pred

local_bgr = output_pred.numpy()[:, :, ::-1]
print(f"official local-only: {time.perf_counter() - started:.1f}s")
cv2.imwrite(str(OUT_DIR / "official-local-full.jpg"), local_bgr)

# ModelScope outputs BGR for OpenCV.  Convert all panels to upright RGB and
# crop with the project's face landmarks only for visual presentation.
original_rgb = common.to_np(common.load_image(SRC))
default_rgb = cv2.cvtColor(default_bgr, cv2.COLOR_BGR2RGB)
local_rgb = cv2.cvtColor(local_bgr, cv2.COLOR_BGR2RGB)

if default_rgb.shape != original_rgb.shape or local_rgb.shape != original_rgb.shape:
    raise RuntimeError(
        f"orientation/size mismatch: original={original_rgb.shape}, "
        f"default={default_rgb.shape}, local={local_rgb.shape}"
    )

skin = masks.get_mask(original_rgb, "face-skin")
ys, xs = np.where(skin > 0.5)
fx0, fy0, fx1, fy1 = xs.min(), ys.min(), xs.max(), ys.max()
fw, fh = fx1 - fx0, fy1 - fy0

# Force a few small, precise holes over the visible blemishes into the
# official inpainting network.  This deliberately bypasses only its detector:
# preprocessing, patching, network and compositing remain the published code.
manual_holes = np.zeros(original_rgb.shape[:2], dtype=np.float32)
for nx, ny, radius in [
    (0.80, 0.55, 0.026),  # bright residue beside the nose
    (0.74, 0.63, 0.038),  # inflamed raised blemish
    (0.83, 0.70, 0.027),  # pale residue near the mouth
    (0.58, 0.86, 0.030),  # chin blemish
]:
    cv2.circle(
        manual_holes,
        (int(fx0 + nx * fw), int(fy0 + ny * fh)),
        max(2, int(radius * fw)),
        1.0,
        -1,
        lineType=cv2.LINE_AA,
    )


def official_inpaint_with_keep_mask(image, keep_mask):
    """Run the official retouch_local inpainting path with a supplied mask."""
    with torch.no_grad():
        sub_h, sub_w = image.shape[2:]
        standard_h = (
            sub_h
            if sub_h % official.patch_size == 0
            else (sub_h // official.patch_size + 1) * official.patch_size
        )
        standard_w = (
            sub_w
            if sub_w % official.patch_size == 0
            else (sub_w // official.patch_size + 1) * official.patch_size
        )
        image_padded = F.pad(
            image,
            (0, standard_w - sub_w, 0, standard_h - sub_h, 0, 0),
            mode="constant",
            value=0,
        )
        mask_padded = F.pad(
            keep_mask,
            (0, standard_w - sub_w, 0, standard_h - sub_h, 0, 0),
            mode="constant",
            value=0,
        )
        image_patches = wrapper.patch_partition_overlap(
            image_padded, p1=official.patch_size, p2=official.patch_size
        )
        mask_patches = wrapper.patch_partition_overlap(
            mask_padded, p1=official.patch_size, p2=official.patch_size
        )
        completed = []
        for image_patch, mask_patch in zip(image_patches, mask_patches):
            image_patch = image_patch.unsqueeze(0)
            mask_patch = mask_patch.unsqueeze(0)
            network_input = image_patch * mask_patch
            prediction = official.inpainting_net(network_input, mask_patch)
            completed.append(network_input + (1 - mask_patch) * prediction)
        merged = wrapper.patch_aggregation_overlap(
            torch.cat(completed, dim=0),
            h=int(round(standard_h / official.patch_size)),
            w=int(round(standard_w / official.patch_size)),
        )
        return merged[:, :, :sub_h, :sub_w]


started = time.perf_counter()
manual_pred = torch.from_numpy(source.copy())
for bbox in crop_bboxes:
    roi_np, _, crop_tblr = wrapper.get_roi_without_padding(source, bbox)
    top, bottom, left, right = crop_tblr
    hole_roi = manual_holes[top:bottom, left:right]
    if not np.any(hole_roi > 0):
        continue
    roi_tensor = wrapper.preprocess_roi(wrapper.roi_to_tensor(roi_np)).to(
        official.device
    )
    keep_tensor = torch.from_numpy(1.0 - hole_roi).unsqueeze(0).unsqueeze(0)
    keep_tensor = keep_tensor.to(device=official.device, dtype=roi_tensor.dtype)
    manual_local = official_inpaint_with_keep_mask(roi_tensor, keep_tensor)
    manual_local_pred = (
        ((manual_local[0].permute(1, 2, 0) + 1.0) / 2.0) * 255.0
    ).clamp(0, 255).byte().cpu()
    manual_pred[top:bottom, left:right] = manual_local_pred

manual_bgr = manual_pred.numpy()[:, :, ::-1]
manual_rgb = cv2.cvtColor(manual_bgr, cv2.COLOR_BGR2RGB)
print(f"official manual-mask: {time.perf_counter() - started:.1f}s")
cv2.imwrite(str(OUT_DIR / "official-manual-mask-full.jpg"), manual_bgr)

marked_rgb = original_rgb.copy()
marked_rgb[manual_holes > 0.05] = (
    0.35 * marked_rgb[manual_holes > 0.05] + 0.65 * np.array([255, 40, 40])
).astype(np.uint8)

x0 = max(0, fx0 - int(fw * 0.18))
x1 = min(original_rgb.shape[1], fx1 + int(fw * 0.18))
y0 = max(0, fy0 + int(fh * 0.35))
y1 = min(original_rgb.shape[0], fy1 + int(fh * 0.18))

zoom = 4
panels = []
for label, image in [
    ("original", original_rgb),
    ("official local-only", local_rgb),
    ("forced test mask", marked_rgb),
    ("official repair / forced mask", manual_rgb),
]:
    crop = Image.fromarray(image[y0:y1, x0:x1])
    crop = crop.resize(
        (crop.width * zoom, crop.height * zoom),
        Image.Resampling.LANCZOS,
    )
    panel = Image.new("RGB", (crop.width, crop.height + 38), (18, 18, 22))
    panel.paste(crop, (0, 38))
    ImageDraw.Draw(panel).text((12, 11), label, fill=(240, 240, 240))
    panels.append(panel)

gap = 12
comparison = Image.new(
    "RGB",
    (sum(panel.width for panel in panels) + gap * (len(panels) - 1), panels[0].height),
    (18, 18, 22),
)
x = 0
for panel in panels:
    comparison.paste(panel, (x, 0))
    x += panel.width + gap
comparison.save(OUT_DIR / "official-comparison.jpg", quality=97)
print(f"wrote {OUT_DIR / 'official-comparison.jpg'}")
