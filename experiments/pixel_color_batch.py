"""Learn a color look from one pair and render a visual batch regression."""

import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT))

from engine import common, pixel_color  # noqa: E402


def main():
    source_dir = Path(sys.argv[1])
    before_path = Path(sys.argv[2])
    after_path = Path(sys.argv[3])
    output_dir = Path(sys.argv[4])
    output_dir.mkdir(parents=True, exist_ok=True)
    batch_dir = output_dir / "batch"
    batch_dir.mkdir(exist_ok=True)

    before = common.to_np(common.load_image(str(before_path)))
    after = common.to_np(common.load_image(str(after_path)))
    model, report, preview = pixel_color.fit(before, after)
    common.to_pil(preview).save(output_dir / "reference-preview.jpg", quality=95)
    (output_dir / "model.json").write_text(
        json.dumps(model, ensure_ascii=False), encoding="utf-8"
    )
    (output_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    rendered = []
    for path in sorted(source_dir.glob("*.JPG")):
        if path.name == after_path.name:
            continue
        image = common.to_np(common.load_image(str(path)))
        result, _ = pixel_color.apply(image, model)
        destination = batch_dir / f"{path.stem}-pixel-color.jpg"
        common.to_pil(result).save(destination, quality=94, subsampling=0)
        rendered.append((path.stem, destination))

    thumb_size = (360, 240)
    label_height = 28
    columns = 3
    rows = (len(rendered) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * thumb_size[0], rows * (thumb_size[1] + label_height)),
        "white",
    )
    draw = ImageDraw.Draw(sheet)
    for index, (label, path) in enumerate(rendered):
        x = (index % columns) * thumb_size[0]
        y = (index // columns) * (thumb_size[1] + label_height)
        image = Image.open(path).convert("RGB")
        thumb = ImageOps.fit(image, thumb_size, method=Image.Resampling.LANCZOS)
        sheet.paste(thumb, (x, y))
        draw.text((x + 8, y + thumb_size[1] + 6), label, fill="black")
    sheet.save(output_dir / "batch-contact-sheet.jpg", quality=92)
    print(json.dumps({"report": report, "images": len(rendered)}, indent=2))


if __name__ == "__main__":
    main()
