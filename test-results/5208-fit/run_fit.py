import json
import os
import sys
import time

from PIL import Image, ImageDraw, ImageOps


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "engine"))

import common
import recipe_fit


BEFORE_PATH = r"C:\Users\yosef dahan\Downloads\22\321A5208.JPG"
AFTER_PATH = r"C:\Users\yosef dahan\Downloads\22\321A5208 (1).JPG"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))


print("Loading pair...", flush=True)
before_pil = common.load_image(BEFORE_PATH)
after_pil = common.load_image(AFTER_PATH)
before = common.to_np(before_pil)
after = common.to_np(after_pil)

print(f"Fitting at source {before.shape[1]}x{before.shape[0]}...", flush=True)
started = time.time()
params, report, fitted = recipe_fit.fit(before, after)
recipe = recipe_fit.to_recipe(params)
print(f"Fit finished in {time.time() - started:.1f}s", flush=True)
print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)

with open(os.path.join(OUT_DIR, "recipe.json"), "w", encoding="utf-8") as stream:
    json.dump(
        {"recipe": recipe, "params": params, "fit": report},
        stream,
        ensure_ascii=False,
        indent=2,
    )

fitted_pil = common.to_pil(fitted)
fitted_pil.save(
    os.path.join(OUT_DIR, "321A5208-fitted-preview.jpg"),
    quality=97,
    subsampling=0,
)

thumbs = []
for image in (before_pil, fitted_pil, after_pil):
    thumb = ImageOps.exif_transpose(image).convert("RGB")
    thumb.thumbnail((1200, 800), Image.Resampling.LANCZOS)
    thumbs.append(thumb)

width = max(image.width for image in thumbs)
height = max(image.height for image in thumbs)
canvas = Image.new("RGB", (width * 3, height + 46), "white")
draw = ImageDraw.Draw(canvas)
for index, (image, label) in enumerate(
    zip(thumbs, ("SOURCE", "LEARNED", "TARGET"))
):
    canvas.paste(
        image,
        (index * width + (width - image.width) // 2, 46),
    )
    draw.text((index * width + 16, 14), label, fill="black")

canvas.save(
    os.path.join(OUT_DIR, "321A5208-comparison.jpg"),
    quality=95,
    subsampling=0,
)
print("Saved fit artifacts to " + OUT_DIR, flush=True)
