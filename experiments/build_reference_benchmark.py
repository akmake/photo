"""Assemble side-by-side benchmark folders and contact sheets."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
BENCHMARK = ROOT / "test-results" / "reference-benchmark"

SETS = {
    "set-22": {
        "source_dir": Path(r"C:\Users\yosef dahan\Downloads\22"),
        "reference": "321A5208.JPG",
        "target": "321A5208 (1).JPG",
        "ours": ROOT / "test-results" / "pixel-color-engine" / "batch",
    },
    "set-33": {
        "source_dir": Path(r"C:\Users\yosef dahan\Downloads\33"),
        "reference": "321A5078.JPG",
        "target": "321A5078 (2).jpg",
        "ours": ROOT / "test-results" / "pixel-color-engine-33" / "batch",
    },
}

THUMB_SIZE = (420, 280)
LABEL_HEIGHT = 38
BACKGROUND = (28, 29, 32)
TEXT = (244, 244, 244)


def font(size: int = 22) -> ImageFont.ImageFont:
    candidates = [
        Path(r"C:\Windows\Fonts\segoeui.ttf"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def image_tile(path: Path, label: str) -> Image.Image:
    tile = Image.new("RGB", (THUMB_SIZE[0], THUMB_SIZE[1] + LABEL_HEIGHT), BACKGROUND)
    if path.exists():
        with Image.open(path) as opened:
            preview = ImageOps.fit(
                ImageOps.exif_transpose(opened).convert("RGB"),
                THUMB_SIZE,
                method=Image.Resampling.LANCZOS,
            )
        tile.paste(preview, (0, LABEL_HEIGHT))
    else:
        draw = ImageDraw.Draw(tile)
        draw.rectangle(
            (3, LABEL_HEIGHT + 3, THUMB_SIZE[0] - 4, tile.height - 4),
            outline=(175, 65, 65),
            width=4,
        )
        draw.text((20, LABEL_HEIGHT + 110), "UNAVAILABLE", fill=(240, 110, 110), font=font(24))
    ImageDraw.Draw(tile).text((12, 7), label, fill=TEXT, font=font())
    return tile


def save_grid(rows: list[list[tuple[Path, str]]], output: Path) -> None:
    width = max(len(row) for row in rows) * THUMB_SIZE[0]
    row_height = THUMB_SIZE[1] + LABEL_HEIGHT
    canvas = Image.new("RGB", (width, len(rows) * row_height), BACKGROUND)
    for row_index, row in enumerate(rows):
        for column_index, (path, label) in enumerate(row):
            canvas.paste(image_tile(path, label), (column_index * THUMB_SIZE[0], row_index * row_height))
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, quality=92, subsampling=0)


def output_for(folder: Path, stem: str, suffix: str) -> Path:
    return folder / f"{stem}-{suffix}.jpg"


def main() -> None:
    summary = {}
    for set_name, config in SETS.items():
        set_dir = BENCHMARK / set_name
        source_dir = config["source_dir"]
        reference = config["reference"]
        target = config["target"]
        reference_stem = Path(reference).stem

        originals_dir = set_dir / "originals"
        target_dir = set_dir / "edited-reference"
        ours_dir = set_dir / "our-engine"
        neural_dir = set_dir / "neural-preset"
        for directory in (originals_dir, target_dir, ours_dir, neural_dir):
            directory.mkdir(parents=True, exist_ok=True)

        source_files = sorted(
            path for path in source_dir.iterdir()
            if path.suffix.lower() in {".jpg", ".jpeg"} and path.name.lower() != target.lower()
        )
        for source in source_files:
            shutil.copy2(source, originals_dir / source.name)

        shutil.copy2(source_dir / target, target_dir / target)

        for produced in sorted(config["ours"].glob("*-pixel-color.jpg")):
            source_stem = produced.name.removesuffix("-pixel-color.jpg")
            shutil.copy2(produced, output_for(ours_dir, source_stem, "our-engine"))

        neural_status = {
            "status": "unavailable",
            "reason": (
                "The official NeuralPreset repository publishes evaluation metrics only; "
                "it does not publish runnable inference code or a trained checkpoint."
            ),
            "substitution_used": False,
        }
        (neural_dir / "STATUS.json").write_text(
            json.dumps(neural_status, indent=2), encoding="utf-8"
        )

        d_lut_dir = set_dir / "d-lut"
        sa_lut_dir = set_dir / "sa-lut"
        detail = [
            [
                (source_dir / reference, "Original reference"),
                (source_dir / target, "Edited target"),
                (output_for(ours_dir, reference_stem, "our-engine"), "Our engine"),
                (output_for(d_lut_dir, reference_stem, "d-lut"), "D-LUT"),
                (output_for(sa_lut_dir, reference_stem, "sa-lut"), "SA-LUT"),
            ]
        ]
        save_grid(detail, set_dir / f"{set_name}-reference-comparison.jpg")

        overview_rows = []
        for source in source_files:
            stem = source.stem
            overview_rows.append(
                [
                    (source, f"{stem} | Original"),
                    (output_for(ours_dir, stem, "our-engine"), "Our engine"),
                    (output_for(d_lut_dir, stem, "d-lut"), "D-LUT"),
                    (output_for(sa_lut_dir, stem, "sa-lut"), "SA-LUT"),
                ]
            )
        save_grid(overview_rows, set_dir / f"{set_name}-all-images.jpg")

        summary[set_name] = {
            "images": len(source_files),
            "reference": reference,
            "target": target,
            "folders": {
                "our-engine": str(ours_dir),
                "d-lut": str(d_lut_dir),
                "sa-lut": str(sa_lut_dir),
                "neural-preset": str(neural_dir),
            },
        }

    (BENCHMARK / "benchmark-summary.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
