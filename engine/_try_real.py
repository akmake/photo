"""Run tools on a real photo and write results for visual inspection."""

import sys
import time

from PIL import Image

import common
import masks
import background

SRC = sys.argv[1]
OUT_DIR = sys.argv[2]
MAXDIM = int(sys.argv[3]) if len(sys.argv) > 3 else 1200

img = Image.open(SRC).convert("RGB")
scale = min(1.0, MAXDIM / max(img.size))
img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
print("working size:", img.size)

rgb = common.to_np(img)

t0 = time.time()
m = masks.get_mask(rgb, "subject")
print(f"subject mask: coverage={m.mean()*100:.1f}%  ({(time.time()-t0)*1000:.0f}ms)")

# visualise the mask so we can judge the cutout quality
common.to_pil(m * 255).save(f"{OUT_DIR}/02-mask.png")

b64 = common.image_to_b64(img)
t0 = time.time()
out_b64, meta = background.process(b64, {"amount": 70, "feather": 40})
print(f"background-blur: {meta}  ({(time.time()-t0)*1000:.0f}ms)")

common.b64_to_image(out_b64).save(f"{OUT_DIR}/03-background-blur.jpg", quality=95)
img.save(f"{OUT_DIR}/01-original.jpg", quality=95)
print("saved to", OUT_DIR)
