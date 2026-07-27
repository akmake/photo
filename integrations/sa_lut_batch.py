"""Batch adapter for the official SA-LUT model with portable tiled inference."""

import argparse
import json
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image, ImageOps
from torchvision.transforms.functional import pil_to_tensor, to_pil_image


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--style", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--skip", action="append", default=[])
    parser.add_argument("--network-size", type=int, default=256)
    parser.add_argument("--tile-rows", type=int, default=384)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def load_tensor(path):
    with Image.open(path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    return pil_to_tensor(image).float().div_(255.0), image


@torch.no_grad()
def apply_tiled(lut, context, content, tile_rows):
    _, height, width = content.shape
    context_full = F.interpolate(
        context, size=(height, width), mode="bilinear", align_corners=True
    )
    output = torch.empty_like(content, device="cpu")
    for y0 in range(0, height, tile_rows):
        y1 = min(height, y0 + tile_rows)
        rgb = content[:, y0:y1].unsqueeze(0).to(lut.device)
        ctx = context_full[:, :, y0:y1]
        combined = torch.cat((ctx, rgb), dim=1)
        import quadrilinear4d

        result = quadrilinear4d._sample(lut, combined)
        output[:, y0:y1] = result.squeeze(0).cpu()
    return output.clamp_(0, 1)


def main():
    args = parse_args()
    repo = Path(args.repo).resolve()
    sys.path.insert(0, str(repo))
    from inference_cli import load_salut_from_ckpt

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_salut_from_ckpt(str(Path(args.checkpoint).resolve()), device)
    model.context_extractor.target_resolution = (
        args.network_size,
        args.network_size,
    )

    style, _ = load_tensor(args.style)
    style_small = F.interpolate(
        style.unsqueeze(0),
        size=(args.network_size, args.network_size),
        mode="bilinear",
        align_corners=True,
    ).to(device)

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
        content, source_image = load_tensor(path)
        content_small = F.interpolate(
            content.unsqueeze(0),
            size=(args.network_size, args.network_size),
            mode="bilinear",
            align_corners=True,
        ).to(device)
        _, fused_lut, context = model(style_small, content_small)
        result = apply_tiled(fused_lut, context, content, args.tile_rows)
        destination = output_dir / f"{path.stem}-sa-lut.jpg"
        to_pil_image(result).save(
            destination,
            quality=95,
            subsampling=0,
            icc_profile=source_image.info.get("icc_profile"),
        )
        timings[path.name] = round(time.time() - started, 3)
        print(f"[SA-LUT] {path.name}: {timings[path.name]}s", flush=True)

    report = {
        "engine": "SA-LUT",
        "device": str(device),
        "networkSize": args.network_size,
        "images": len(paths),
        "seconds": timings,
        "license": "S-Lab 1.0, non-commercial evaluation",
    }
    (output_dir / "report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
