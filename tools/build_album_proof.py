"""Build a chronological album proof from a folder of selected JPEGs.

The script is intentionally a thin orchestration layer around engine/album_render.py:
the production renderer still owns crop, colour profile, JPEG encoding and PDF
geometry. This file only groups the selected photographs into calm editorial
layouts and creates a contact sheet for quick review.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "engine"))

import album_render  # noqa: E402


GROUP_SIZES = (1, 2, 3, 3, 4, 3, 3, 4, 3, 4, 2)


def focal_point(path: Path) -> dict[str, float]:
    """Find a conservative face-aware focal point, falling back to centre."""
    try:
        import cv2
        import numpy as np

        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1100, 1100), Image.Resampling.LANCZOS)
            gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
        cascade = cv2.CascadeClassifier(
            str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
        )
        faces = cascade.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5, minSize=(28, 28))
        if len(faces):
            weights = [max(1, int(w) * int(h)) for _, _, w, h in faces]
            total = sum(weights)
            x = sum((int(fx) + int(fw) / 2) * weight for (fx, _, fw, _), weight in zip(faces, weights)) / total
            y = sum((int(fy) + int(fh) / 2) * weight for (_, fy, _, fh), weight in zip(faces, weights)) / total
            return {
                "x": round(max(0.25, min(0.75, x / gray.shape[1])), 4),
                "y": round(max(0.25, min(0.68, y / gray.shape[0])), 4),
            }
    except Exception:
        pass
    return {"x": 0.5, "y": 0.46}


def frame(path: Path, x: float, y: float, width: float, height: float) -> dict:
    return {
        "path": str(path),
        "slot": {"x": x, "y": y, "width": width, "height": height},
        "focalPoint": focal_point(path),
    }


def layout(paths: list[Path], spread_index: int) -> dict:
    count = len(paths)
    if count == 1:
        geometry = [(0.0, 0.0, 1.0, 1.0)]
    elif count == 2 and spread_index % 3 == 0:
        geometry = [(0.025, 0.045, 0.615, 0.91), (0.655, 0.18, 0.32, 0.64)]
    elif count == 2:
        geometry = [(0.025, 0.045, 0.467, 0.91), (0.508, 0.045, 0.467, 0.91)]
    elif count == 3 and spread_index % 2:
        geometry = [(0.0, 0.0, 0.635, 1.0), (0.65, 0.04, 0.35, 0.452), (0.65, 0.508, 0.35, 0.452)]
    elif count == 3:
        geometry = [(0.0, 0.04, 0.35, 0.452), (0.0, 0.508, 0.35, 0.452), (0.365, 0.0, 0.635, 1.0)]
    else:
        margin = 0.025
        gap = 0.012
        width = (1.0 - margin * 2 - gap) / 2
        height = (1.0 - margin * 2 - gap) / 2
        geometry = [
            (margin, margin, width, height),
            (margin + width + gap, margin, width, height),
            (margin, margin + height + gap, width, height),
            (margin + width + gap, margin + height + gap, width, height),
        ]
    return {"frames": [frame(path, *box) for path, box in zip(paths, geometry)]}


def group_photos(paths: list[Path]) -> list[list[Path]]:
    groups: list[list[Path]] = []
    cursor = 0
    for size in GROUP_SIZES:
        if cursor >= len(paths):
            break
        groups.append(paths[cursor: cursor + size])
        cursor += size
    while cursor < len(paths):
        groups.append(paths[cursor: cursor + 4])
        cursor += 4
    return groups


def contact_sheet(spread_paths: list[Path], out_path: Path) -> None:
    thumb_width = 920
    thumb_height = 460
    gap = 34
    label_height = 34
    columns = 2
    rows = (len(spread_paths) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * thumb_width + (columns + 1) * gap, rows * (thumb_height + label_height) + (rows + 1) * gap),
        "#17191b",
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=18)
    for index, path in enumerate(spread_paths):
        with Image.open(path) as source:
            preview = source.convert("RGB")
            preview.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        column = index % columns
        row = index // columns
        x = gap + column * (thumb_width + gap)
        y = gap + row * (thumb_height + label_height + gap)
        sheet.paste(preview, (x, y + label_height))
        draw.text((x, y), f"SPREAD {index + 1:02d}", fill="#e9e5de", font=font)
    sheet.save(out_path, format="JPEG", quality=92, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    photos = sorted(
        (item for item in source.iterdir() if item.is_file() and item.suffix.lower() in {".jpg", ".jpeg"}),
        key=lambda item: item.name.casefold(),
    )
    if not photos:
        raise SystemExit(f"No JPEG files found in {source}")

    output.mkdir(parents=True, exist_ok=True)
    groups = group_photos(photos)
    spreads = [layout(group, index) for index, group in enumerate(groups)]
    spec = {
        "pageWidthMm": 300,
        "pageHeightMm": 300,
        "bleedMm": 3,
        "targetPpi": 150,
        "minPpi": 120,
    }

    manifest = album_render.render_album(
        spec,
        spreads,
        str(output),
        ppi=150,
        background="#f8f6f1",
        naming="proof-spread-{index}.jpg",
    )
    pdf_report = album_render.render_pdf(
        spec,
        spreads,
        str(output / "jm-album-proof.pdf"),
        ppi=120,
        background="#f8f6f1",
    )
    spread_paths = [output / item["name"] for item in manifest["files"]]
    contact_sheet(spread_paths, output / "jm-album-contact-sheet.jpg")
    with (output / "proof-summary.json").open("w", encoding="utf-8") as handle:
        json.dump(
            {
                "source": str(source),
                "photos": len(photos),
                "spreads": len(spreads),
                "purpose": "proof-only-not-for-print",
                "pdf": pdf_report,
            },
            handle,
            ensure_ascii=False,
            indent=2,
        )
    print(json.dumps({"photos": len(photos), "spreads": len(spreads), "output": str(output), "pdf": pdf_report}, ensure_ascii=False))


if __name__ == "__main__":
    main()
