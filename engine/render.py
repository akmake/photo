"""Recipe rendering and export — the authoritative pipeline.

A recipe is an ordered stack of tools. This runs the whole stack in one call,
which matters for two reasons:

  * masks are computed ONCE from the original instead of once per tool;
  * it is the same code path used for batch export, so what the photographer
    exports is what the pipeline actually produces.
"""

import os
import time

import numpy as np

import common
import masks

import background
import cleanup
import skin
import globals_py

# toolId -> (callable, pipeline order). Lower order runs first.
# All entries share the (rgb, params) -> (rgb, meta) contract so the frame stays
# a numpy array for the whole chain — no PNG round-trip between steps.
TOOLS = {
    "skin-cleanup": (cleanup.apply, 10),
    "skin": (skin.apply, 20),
    "background-blur": (background.apply, 25),
    "tone-color": (globals_py.tone_color, 30),
    "dimension": (globals_py.dimension, 35),
    "color-grade": (globals_py.color_grade, 40),
    "light-point": (globals_py.light_point, 45),
    "glow": (globals_py.glow, 55),
    "oil-paint": (globals_py.oil_paint, 58),
    "sharpen": (globals_py.sharpen, 60),
}


def render(img, recipe_tools):
    """img: PIL image. recipe_tools: [{toolId, params, enabled}]. -> (PIL, meta)"""
    active = [
        t
        for t in recipe_tools
        if t.get("enabled", True) and t.get("toolId") in TOOLS
    ]
    active.sort(key=lambda t: TOOLS[t["toolId"]][1])

    rgb = common.to_np(img)
    masks.set_source(rgb)  # every tool sees the same, pristine masks
    try:
        steps = []
        for t in active:
            fn = TOOLS[t["toolId"]][0]
            t0 = time.time()
            rgb, meta = fn(rgb, t.get("params", {}))
            steps.append(
                {"tool": t["toolId"], "ms": int((time.time() - t0) * 1000), "meta": meta}
            )
        return common.to_pil(rgb), {"steps": steps}
    finally:
        masks.clear_source()


# Delivery quality is not a place to save bytes. Measured on a 20MP camera
# file: q94 = 47.5 dB PSNR (visible loss), q97 = 51.3 dB, q100 = 56.1 dB.
# 97 with NO chroma subsampling is the professional default; photographers who
# want a master file choose tiff/png and get it lossless.
DEFAULT_QUALITY = 97


def export(
    src_path: str,
    recipe_tools,
    dest_dir: str,
    fmt: str = "jpeg",
    quality: int = DEFAULT_QUALITY,
):
    """Render one file from disk and write the result. -> (path, meta)."""
    img = common.load_image(src_path)
    out, meta = render(img, recipe_tools)

    os.makedirs(dest_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(src_path))[0]
    f = fmt.lower()
    ext = {"jpg": "jpg", "jpeg": "jpg", "png": "png", "tif": "tif", "tiff": "tif"}.get(
        f, "jpg"
    )
    dest = os.path.join(dest_dir, f"{stem}.{ext}")

    if ext == "jpg":
        out.save(
            dest,
            format="JPEG",
            quality=int(quality),
            subsampling=0,  # 4:4:4 — never throw away colour resolution
            optimize=True,
            progressive=True,
            icc_profile=img.info.get("icc_profile"),
        )
    elif ext == "png":
        out.save(dest, format="PNG", compress_level=6)
    else:  # tiff — lossless master
        out.save(dest, format="TIFF", compression="tiff_lzw")

    meta["output"] = dest
    return dest, meta
