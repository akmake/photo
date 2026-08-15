"""רינדור לדפוס — spreads composited from the ORIGINAL files, in the engine.

Why here and not in the browser, where `src/album/exportEngine.ts` already
renders spreads: that path draws from `/thumb`, which serves a q82 JPEG capped
at the requested width. It is exactly right for a proof — small, fast, and
watermarked — and exactly wrong for print. A print file made that way would
carry a resize and a lossy encode BEFORE the frame ever reaches the canvas, and
then a second encode on the way out. The photographer asked for the highest
quality there is; that means the original pixels, resampled once, encoded once.

So the engine — the only process that can read the disk — opens each source
file, crops it around its focal point, resamples it straight to its printed
size, and writes a finished sRGB JPEG. Nothing is copied to a cache, nothing is
uploaded, and the source files are never modified.

Geometry: slot coordinates arrive as fractions of the TRIM spread (x across the
open spread, y down the page), the same numbers the layout engine produced and
the screen drew, so what was approved is what is printed. Bleed is added around
the trim; a frame that does not reach the edge leaves clean paper there.
"""

import hashlib
import io
import json
import os

from PIL import Image, ImageCms

import common

MM_PER_INCH = 25.4

# The lab gets one file per spread at this quality. 4:4:4 and q97 are not
# negotiable for print: chroma subsampling is visible on a skin edge at A3.
JPEG_QUALITY = 97


def _mm_to_px(mm, ppi):
    return int(round(mm / MM_PER_INCH * ppi))


def _srgb_profile():
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def _cover_crop(img, target_w, target_h, focal):
    """Fill target_w×target_h from `img`, keeping the focal point in view.

    This mirrors the browser's `object-fit: cover` with `object-position` set to
    the focal point, so the printed frame is the frame that was approved on
    screen — not a re-centred version of it."""
    src_w, src_h = img.size
    if src_w <= 0 or src_h <= 0 or target_w <= 0 or target_h <= 0:
        return None

    target_aspect = target_w / target_h
    src_aspect = src_w / src_h

    if src_aspect > target_aspect:
        crop_h = src_h
        crop_w = crop_h * target_aspect
    else:
        crop_w = src_w
        crop_h = crop_w / target_aspect

    fx = min(max(float(focal.get("x", 0.5)), 0.0), 1.0)
    fy = min(max(float(focal.get("y", 0.5)), 0.0), 1.0)

    left = fx * src_w - crop_w / 2
    top = fy * src_h - crop_h / 2
    # Clamp so the window stays inside the frame — a focal point near an edge
    # must slide the crop, never introduce a transparent margin.
    left = min(max(left, 0.0), max(0.0, src_w - crop_w))
    top = min(max(top, 0.0), max(0.0, src_h - crop_h))

    box = (int(round(left)), int(round(top)),
           int(round(left + crop_w)), int(round(top + crop_h)))
    cropped = img.crop(box)
    # One resample, from the source pixels straight to the printed size.
    return cropped.resize((target_w, target_h), Image.LANCZOS), (box[2] - box[0], box[3] - box[1])


def _render_spread(spread, spec, ppi, background):
    trim_w = _mm_to_px(spec["pageWidthMm"] * 2, ppi)
    trim_h = _mm_to_px(spec["pageHeightMm"], ppi)
    bleed = _mm_to_px(spec.get("bleedMm", 0), ppi)

    canvas = Image.new("RGB", (trim_w + bleed * 2, trim_h + bleed * 2), background)
    frames_meta = []

    for frame in spread.get("frames", []):
        path = frame["path"]
        slot = frame["slot"]
        slot_w = max(1, int(round(float(slot["width"]) * trim_w)))
        slot_h = max(1, int(round(float(slot["height"]) * trim_h)))
        x = bleed + int(round(float(slot["x"]) * trim_w))
        y = bleed + int(round(float(slot["y"]) * trim_h))

        src = common.load_image(path).convert("RGB")
        placed = _cover_crop(src, slot_w, slot_h, frame.get("focalPoint") or {})
        if placed is None:
            continue
        image, used = placed
        canvas.paste(image, (x, y))

        # The effective resolution is measured from what was actually used, not
        # from the file's dimensions — the crop threw pixels away and the
        # photographer is entitled to the honest number.
        printed_mm = float(slot["width"]) * spec["pageWidthMm"] * 2
        effective_ppi = used[0] / (printed_mm / MM_PER_INCH) if printed_mm > 0 else 0
        frames_meta.append({
            "path": path,
            "slotPx": [slot_w, slot_h],
            "usedSourcePx": [used[0], used[1]],
            "effectivePpi": round(effective_ppi),
            "upscaled": bool(used[0] < slot_w),
        })

    return canvas, frames_meta


"""A viewing PDF is a different product from the print package, and conflating
them is how a lab ends up with the wrong file.

The JPEGs above are the deliverable: one file per spread, 300 PPI, sRGB, no
subsampling, checksummed. A PDF built here embeds those same rendered spreads as
pages at the album's true physical size — it is for FLIPPING THROUGH: showing a
client, checking the flow, mailing a proof. It carries no trim marks, no
separate bleed box and no PDF/X intent, so it is not a print master unless a
particular lab has said it wants exactly this. Hence its own default PPI: a
40-spread album at 300 PPI is a file nobody can open twice."""

PDF_VIEW_PPI = 150


def render_pdf(spec, spreads, out_path, ppi=None, background="#ffffff"):
    """Every spread as one page of a single PDF, at the album's real page size.

    Returns the same shape of report the JPEG path returns, minus the per-file
    checksums, so the screen can read one summary either way."""
    ppi = int(ppi or PDF_VIEW_PPI)
    parent = os.path.dirname(out_path)
    if parent and not os.path.isdir(parent):
        raise ValueError(f"תיקיית היעד לא קיימת: {parent}")
    if not spreads:
        raise ValueError("אין כפולות לייצא")

    pages = []
    frames_all = []
    for spread in spreads:
        canvas, frames_meta = _render_spread(spread, spec, ppi, background)
        pages.append(canvas)
        frames_all.extend(frames_meta)

    # `resolution` is what tells a reader the page is 606mm wide and not merely
    # 3578 pixels — without it the PDF opens at an arbitrary physical size.
    pages[0].save(
        out_path,
        format="PDF",
        save_all=True,
        append_images=pages[1:],
        resolution=float(ppi),
    )

    return {
        "path": out_path,
        "pages": len(pages),
        "ppi": ppi,
        "pagePx": [pages[0].width, pages[0].height],
        "bytes": os.path.getsize(out_path),
        "softFrames": sum(
            1 for fr in frames_all if fr["effectivePpi"] < spec.get("minPpi", 0)
        ),
        "upscaledFrames": sum(1 for fr in frames_all if fr["upscaled"]),
    }


def _sha256(data):
    digest = hashlib.sha256()
    digest.update(data)
    return digest.hexdigest()


def render_album(spec, spreads, out_dir, ppi=None, background="#ffffff",
                 naming="spread-{index}.jpg", start_index=1, manifest_files=None,
                 write_manifest=True):
    """Write print-ready JPEGs for `spreads` into `out_dir`.

    Called a CHUNK of spreads at a time — a 40-spread album is minutes of work
    and a progress counter in items is worth the round trips. `start_index`
    keeps the numbering continuous across chunks, and the manifest is written
    only on the final call, with the accumulated `manifest_files` folded in.

    That ordering is deliberate: an interrupted run leaves the spreads it
    finished and NO manifest, so an incomplete package can never be mistaken for
    a complete one. Every file is listed with its pixel size, its sha256 and the
    frames inside it — including any frame that had to be upscaled, so a soft
    print is on record before it is a surprise from the lab."""
    ppi = int(ppi or spec.get("targetPpi") or 300)
    if not os.path.isdir(out_dir):
        raise ValueError(f"תיקיית היעד לא קיימת: {out_dir}")
    if "{index}" not in naming:
        raise ValueError("תבנית השמות חייבת לכלול {index}")

    icc = _srgb_profile()
    written = []

    for index, spread in enumerate(spreads, start=int(start_index)):
        canvas, frames_meta = _render_spread(spread, spec, ppi, background)

        buf = io.BytesIO()
        canvas.save(
            buf,
            format="JPEG",
            quality=JPEG_QUALITY,
            subsampling=0,
            optimize=True,
            dpi=(ppi, ppi),
            icc_profile=icc,
        )
        data = buf.getvalue()

        name = naming.replace("{index}", f"{index:03d}")
        with open(os.path.join(out_dir, name), "wb") as fh:
            fh.write(data)

        written.append({
            "name": name,
            "widthPx": canvas.width,
            "heightPx": canvas.height,
            "bytes": len(data),
            "sha256": _sha256(data),
            "frames": frames_meta,
        })

    files = list(manifest_files or []) + written
    manifest = {
        "spreads": len(files),
        "ppi": ppi,
        "quality": JPEG_QUALITY,
        "subsampling": "4:4:4",
        "colorProfile": "sRGB",
        "spec": spec,
        "files": files,
        "softFrames": sum(
            1 for f in files for fr in f["frames"] if fr["effectivePpi"] < spec.get("minPpi", 0)
        ),
        "upscaledFrames": sum(1 for f in files for fr in f["frames"] if fr["upscaled"]),
    }
    if write_manifest:
        with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)

    return manifest
