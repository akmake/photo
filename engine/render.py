"""Recipe rendering and export — the authoritative pipeline.

A recipe is an ordered stack of tools. This runs the whole stack in one call,
which matters for two reasons:

  * masks are computed ONCE from the original instead of once per tool;
  * it is the same code path used for batch export, so what the photographer
    exports is what the pipeline actually produces.
"""

import os
import time

import cv2
import numpy as np

import common
import masks

import abpn
import background
import blush
import cleanup
import eyes
import hairtone
import skin
import globals_py
import hsl
import grade_zones

# toolId -> (callable, pipeline order). Lower order runs first.
# All entries share the (rgb, params) -> (rgb, meta) contract so the frame stays
# a numpy array for the whole chain — no PNG round-trip between steps.
TOOLS = {
    "face-retouch": (abpn.apply, 8),  # learned model — the primary skin tool
    "skin-cleanup": (cleanup.apply, 10),
    "skin": (skin.apply, 20),
    # Colour work on the retouched face: after smoothing, which would otherwise
    # wash a blush straight back out, and before any global grade.
    "blush": (blush.apply, 22),
    "eye-sparkle": (eyes.apply, 23),
    "hair-tones": (hairtone.apply, 24),
    "background-blur": (background.apply, 25),
    "tone-color": (globals_py.tone_color, 30),
    "dimension": (globals_py.dimension, 35),
    "color-grade": (globals_py.color_grade, 40),
    # Per-hue control sits BEFORE the zone grade: decide what each colour is,
    # then tint the tonal zones on top of it.
    "hsl": (hsl.apply, 41),
    "grade-zones": (grade_zones.apply, 42),
    "light-point": (globals_py.light_point, 45),
    "glow": (globals_py.glow, 55),
    "oil-paint": (globals_py.oil_paint, 58),
    "sharpen": (globals_py.sharpen, 60),
}


# Tools defined RELATIVE TO THE FRAME cannot be masked to a region. A vignette
# is a radial gradient centred on the picture; multiplying it by a person-shaped
# mask produces arcs and blotches across the background, which is exactly what
# happened when the fitter was free to put `vignette` in a subject slot. The
# same holds for a placed light and for glow, which spreads across the frame.
FRAME_ONLY = {"dimension", "light-point", "glow", "vignette"}


def _region_mask(rgb, spec):
    """Build the 0..1 map a masked tool is blended through.

    spec: {region, invert, feather, strength}. `region` is any kind masks.py
    knows — subject, hair, face-skin, body-skin, face-features — plus
    `background`, which is simply the subject inverted.
    """
    region = spec.get("region", "subject")
    invert = bool(spec.get("invert", False))
    if region == "background":
        region, invert = "subject", not invert

    m = masks.get_mask(rgb, region).astype(np.float32)
    if invert:
        m = 1.0 - m

    feather = float(spec.get("feather", 0) or 0)
    if feather > 0:
        # relative to the frame, so a recipe behaves the same at any resolution
        sigma = max(0.5, feather / 100.0 * 0.02 * max(rgb.shape[:2]))
        m = cv2.GaussianBlur(m, (0, 0), sigma)

    strength = float(spec.get("strength", 100) or 100) / 100.0
    return np.clip(m * strength, 0.0, 1.0)


def render(img, recipe_tools):
    """img: PIL image. recipe_tools: [{toolId, params, enabled, mask?}].

    A tool carrying `mask` is applied through it instead of over the whole
    frame, which is what lets one recipe hold the SAME tool twice with opposite
    settings — cool and dark on the background, warm and bright on the subject.
    A single global grade cannot express that, and measuring a real edit showed
    it is exactly what retouchers do: the fitted temperature pinned at +100
    trying to satisfy the subject and the field at once.
    """
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
            spec = t.get("mask")
            if spec and t["toolId"] in FRAME_ONLY:
                spec = None  # frame-relative tool: a region mask makes artefacts
            out, meta = fn(rgb, t.get("params", {}))
            if spec:
                m = _region_mask(rgb, spec)[..., None]
                out = (rgb.astype(np.float32) * (1.0 - m)
                       + out.astype(np.float32) * m)
                out = np.clip(out, 0, 255).astype(np.uint8)
                meta = {**meta, "mask": spec.get("region", "subject"),
                        "maskCoverage": round(float(m.mean()), 4)}
            rgb = out
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
