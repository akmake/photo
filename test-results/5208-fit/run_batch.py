import json
import os
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "engine"))

import common
import render


SOURCE_DIR = Path(r"C:\Users\yosef dahan\Downloads\22")
OUT_DIR = Path(__file__).resolve().parent
RENDER_DIR = OUT_DIR / "batch"
RENDER_DIR.mkdir(exist_ok=True)

with open(OUT_DIR / "recipe.json", encoding="utf-8") as stream:
    recipe = json.load(stream)["recipe"]

files = sorted(
    path
    for path in SOURCE_DIR.iterdir()
    if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
    and "(1)" not in path.stem
)

rows = []
started = time.time()
for index, path in enumerate(files, 1):
    print(f"[{index}/{len(files)}] {path.name}", flush=True)
    image = common.load_image(str(path))
    output, meta = render.render(image, recipe)
    destination = RENDER_DIR / f"{path.stem}-learned.jpg"
    output.save(
        destination,
        format="JPEG",
        quality=97,
        subsampling=0,
        optimize=True,
        progressive=True,
        icc_profile=image.info.get("icc_profile"),
    )
    rows.append((path, destination))

thumb_width = 620
thumb_height = 414
label_height = 34
sheet = Image.new(
    "RGB",
    (thumb_width * 2, (thumb_height + label_height) * len(rows)),
    "#f4f4f4",
)
draw = ImageDraw.Draw(sheet)

for row, (source_path, output_path) in enumerate(rows):
    for column, (path, label) in enumerate(
        ((source_path, "SOURCE"), (output_path, "LEARNED"))
    ):
        image = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        image.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        x = column * thumb_width + (thumb_width - image.width) // 2
        y0 = row * (thumb_height + label_height)
        y = y0 + label_height + (thumb_height - image.height) // 2
        sheet.paste(image, (x, y))
        draw.text(
            (column * thumb_width + 12, y0 + 10),
            f"{label} - {source_path.name}",
            fill="black",
        )

sheet.save(OUT_DIR / "batch-contact-sheet.jpg", quality=92, subsampling=0)
print(f"Finished {len(rows)} files in {time.time() - started:.1f}s", flush=True)
