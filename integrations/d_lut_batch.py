"""Batch adapter for the official D-LUT training-free color transfer model."""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
import yaml
from PIL import Image, ImageOps
from torchvision.transforms.functional import pil_to_tensor, to_pil_image


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--style", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--skip", action="append", default=[])
    parser.add_argument("--tile-rows", type=int, default=512)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


@torch.no_grad()
def apply_tiled(lut, content, tile_rows):
    _, height, _ = content.shape
    output = torch.empty_like(content, device="cpu")
    lut = lut.unsqueeze(0)
    for y0 in range(0, height, tile_rows):
        y1 = min(height, y0 + tile_rows)
        tile = content[:, y0:y1].unsqueeze(0).to(lut.device)
        grid = tile.permute(0, 2, 3, 1).unsqueeze(1).mul(2.0).sub(1.0)
        result = F.grid_sample(
            lut,
            grid,
            mode="bilinear",
            padding_mode="border",
            align_corners=True,
        ).squeeze(2)
        output[:, y0:y1] = result.squeeze(0).cpu()
    return output.clamp_(0, 1)


def main():
    args = parse_args()
    repo = Path(args.repo).resolve()
    sys.path.insert(0, str(repo))
    import codebase as cb
    from codebase.Exp2Runner import Exp2Runner
    from codebase.LUT import save_3dlut_to_file

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    config = yaml.safe_load(
        """
seed: 12213
root_dir: WORK_DIR
model_type: Energy
swish: "True"
train_epochs: 15
save_epoch: null
save_model_flag: true
batch_size: 128
learning_rate: 0.001
sigma: 0.005
style_dir: STYLE_PATH
style_shape: [400, 300]
add_uniform: false
uniform_percentage: 0.05
L_steps: 40
eps: 0.0002
content_dir: null
content_shape: [300, 400]
lut_dim: 15
lut_sample: 50
model_dir: null
vis_dim: 20
"""
        .replace("WORK_DIR", str((output_dir / "work").resolve()).replace("\\", "/"))
        .replace("STYLE_PATH", str(Path(args.style).resolve()).replace("\\", "/"))
    )
    runner = Exp2Runner(cb.utils.dict2namespace(config))
    training_started = time.time()
    runner.train()
    lut_path = runner.lut_langevie()
    learned = lut_path[-1].mean(dim=0).permute(3, 0, 1, 2).detach()
    training_seconds = round(time.time() - training_started, 3)
    save_3dlut_to_file(learned.cpu(), str(output_dir), "learned-style")

    timings = {}
    source_dir = Path(args.source_dir)
    skip = {Path(value).name.lower() for value in args.skip}
    paths = sorted(
        path
        for path in source_dir.iterdir()
        if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
        and path.name.lower() not in skip
    )
    if args.limit:
        paths = paths[: args.limit]
    for path in paths:
        started = time.time()
        with Image.open(path) as opened:
            source_image = ImageOps.exif_transpose(opened).convert("RGB")
        content = pil_to_tensor(source_image).float().div_(255.0)
        result = apply_tiled(learned.to(runner.device), content, args.tile_rows)
        destination = output_dir / f"{path.stem}-d-lut.jpg"
        to_pil_image(result).save(
            destination,
            quality=95,
            subsampling=0,
            icc_profile=source_image.info.get("icc_profile"),
        )
        timings[path.name] = round(time.time() - started, 3)
        print(f"[D-LUT] {path.name}: {timings[path.name]}s", flush=True)

    report = {
        "engine": "D-LUT",
        "device": str(runner.device),
        "trainingSeconds": training_seconds,
        "images": len(paths),
        "seconds": timings,
        "license": "Apache-2.0",
    }
    (output_dir / "report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
