r"""Rendering the album desk's spreads to print-ready files.

Why this lives in the engine and not in the browser
---------------------------------------------------
The renderer only ever sees thumbnails: the whole product rests on the
originals staying where the photographer put them, and the browser cannot
read D:\Shoots\... . Exporting from the screen would therefore write an
album built from 1200px proxies — a file that looks right on a monitor and
falls apart at 30cm on paper. That is the worst kind of bug, because it is
invisible until the print arrives.

The engine has the originals. So the engine exports.

The geometry contract
---------------------
The screen owns templates; this module knows nothing about them. What
arrives is plain geometry: for each spread, a list of rectangles in
fractions of the WHOLE SPREAD (0..1), each with the file to draw and how
the photographer framed it inside that rectangle.

That keeps every layout decision in the UI and leaves this file with one
job: put these pixels in that rectangle, correctly, at print resolution.

Bleed
-----
The exported canvas is larger than the finished album: `bleedMm` of extra
paper on all four outer sides, which the guillotine removes. A rectangle
that touches an outer trim edge is extended into that margin, because a
photograph printed exactly to the trim line shows a white sliver wherever
the cut drifts. The fold in the middle is not an outer edge and is never
extended.

Framing
-------
`zoom`/`fx`/`fy` mirror what the screen does, so what the photographer saw
is what gets printed:

    cover the rectangle, multiply that scale by `zoom`, then align the
    image's (fx%, fy%) point with the rectangle's (fx%, fy%) point.

This is the CSS background-position percentage rule. It is reproduced here
deliberately rather than approximated — a crop that differs from the
preview by a few percent puts the eyes somewhere else.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from PIL import Image, ImageOps

MM_PER_INCH = 25.4
DEFAULT_DPI = 300
JPEG_QUALITY = 94


class ExportError(Exception):
    """Something the photographer must be told about, not swallowed."""


@dataclass(frozen=True)
class Spec:
    wcm: float
    hcm: float
    bleed_mm: float

    @property
    def page_w_mm(self) -> float:
        return self.wcm * 10.0

    @property
    def page_h_mm(self) -> float:
        return self.hcm * 10.0


def _mm_to_px(mm: float, dpi: int) -> float:
    return mm / MM_PER_INCH * dpi


def _spec_of(raw: dict[str, Any]) -> Spec:
    try:
        spec = Spec(
            wcm=float(raw.get("wcm", 30)),
            hcm=float(raw.get("hcm", 30)),
            bleed_mm=float(raw.get("bleedMm", 3)),
        )
    except (TypeError, ValueError) as e:
        raise ExportError(f"bad album spec: {e}") from e
    if spec.wcm <= 0 or spec.hcm <= 0:
        raise ExportError("album page size must be positive")
    if spec.bleed_mm < 0:
        raise ExportError("bleed cannot be negative")
    return spec


def canvas_size(spec: Spec, dpi: int) -> tuple[int, int]:
    """The sheet, bleed included. A spread is two pages wide."""
    w_mm = spec.page_w_mm * 2 + spec.bleed_mm * 2
    h_mm = spec.page_h_mm + spec.bleed_mm * 2
    return (max(1, round(_mm_to_px(w_mm, dpi))), max(1, round(_mm_to_px(h_mm, dpi))))


def _load(path: str) -> Image.Image:
    """The original, upright. RAW goes through the raw decoder.

    No draft-mode downscaling here: this is the one place in the product
    that must read the file at full size.
    """
    if not path or not os.path.isfile(path):
        raise ExportError(f"file not found: {path}")
    ext = os.path.splitext(path)[1].lower()
    if ext in {".cr2", ".cr3", ".nef", ".arw", ".raf", ".rw2", ".orf", ".dng", ".pef"}:
        try:
            import raw  # engine-local

            return ImageOps.exif_transpose(raw.decode_path(path)).convert("RGB")
        except ExportError:
            raise
        except Exception as e:  # noqa: BLE001
            raise ExportError(f"cannot decode raw {os.path.basename(path)}: {e}") from e
    try:
        im = Image.open(path)
        return ImageOps.exif_transpose(im).convert("RGB")
    except Exception as e:  # noqa: BLE001
        raise ExportError(f"cannot read {os.path.basename(path)}: {e}") from e


def _framed(im: Image.Image, box_w: int, box_h: int, zoom: float, fx: float, fy: float) -> Image.Image:
    """The source, cropped exactly as the screen framed it.

    Mirrors `background-size: cover` + `background-position: fx% fy%` with the
    scale multiplied by `zoom`. Returns an image of exactly (box_w, box_h).
    """
    src_w, src_h = im.size
    if src_w <= 0 or src_h <= 0:
        raise ExportError("empty image")

    zoom = max(1.0, float(zoom or 1.0))
    scale = max(box_w / src_w, box_h / src_h) * zoom
    scaled_w = src_w * scale
    scaled_h = src_h * scale

    # CSS percentage positioning: offset = (container - image) * pct.
    # Both are <= 0 because a covered image is never smaller than its box.
    off_x = (box_w - scaled_w) * (max(0.0, min(100.0, fx)) / 100.0)
    off_y = (box_h - scaled_h) * (max(0.0, min(100.0, fy)) / 100.0)

    # The window on the ORIGINAL that ends up inside the box.
    crop_x = -off_x / scale
    crop_y = -off_y / scale
    crop_w = box_w / scale
    crop_h = box_h / scale

    left = max(0, int(round(crop_x)))
    top = max(0, int(round(crop_y)))
    right = min(src_w, int(round(crop_x + crop_w)))
    bottom = min(src_h, int(round(crop_y + crop_h)))
    if right - left < 1 or bottom - top < 1:
        raise ExportError("crop fell outside the image")

    return im.crop((left, top, right, bottom)).resize((box_w, box_h), Image.LANCZOS)


def _slot_pixels(
    slot: dict[str, Any],
    spec: Spec,
    dpi: int,
    canvas_w: int,
    canvas_h: int,
) -> tuple[int, int, int, int]:
    """A slot's rectangle on the sheet, in pixels, bleed applied.

    `x/y/w/h` arrive as fractions of the TRIMMED spread. The trimmed spread
    sits inside the sheet, inset by the bleed on every side.
    """
    bleed = _mm_to_px(spec.bleed_mm, dpi)
    trim_w = canvas_w - bleed * 2
    trim_h = canvas_h - bleed * 2

    fx = float(slot.get("x", 0.0))
    fy = float(slot.get("y", 0.0))
    fw = float(slot.get("w", 0.0))
    fh = float(slot.get("h", 0.0))
    if fw <= 0 or fh <= 0:
        raise ExportError("slot has no size")

    left = bleed + fx * trim_w
    top = bleed + fy * trim_h
    right = left + fw * trim_w
    bottom = top + fh * trim_h

    # A photograph that stops exactly on the trim line shows a white sliver
    # wherever the cut drifts. Outer edges only — the fold is not a cut.
    eps = 1e-4
    if fx <= eps:
        left -= bleed
    if fy <= eps:
        top -= bleed
    if fx + fw >= 1 - eps:
        right += bleed
    if fy + fh >= 1 - eps:
        bottom += bleed

    l, t = int(round(left)), int(round(top))
    r, b = int(round(right)), int(round(bottom))
    if r - l < 1 or b - t < 1:
        raise ExportError("slot rounds to nothing at this size")
    return l, t, r, b


def render_spread(spread: dict[str, Any], spec: Spec, dpi: int) -> tuple[Image.Image, list[str]]:
    """One sheet. Returns the image and any per-slot notes worth reporting."""
    cw, ch = canvas_size(spec, dpi)
    sheet = Image.new("RGB", (cw, ch), "white")
    notes: list[str] = []

    for slot in spread.get("slots") or []:
        path = slot.get("path") or ""
        if not path:
            continue
        try:
            l, t, r, b = _slot_pixels(slot, spec, dpi, cw, ch)
            src = _load(path)
            box_w, box_h = r - l, b - t
            # What the photographer will actually get, in dots per inch, for
            # THIS rectangle. Reported, never silently accepted.
            used_long = max(box_w, box_h)
            src_long = max(src.size)
            piece = _framed(src, box_w, box_h, slot.get("zoom", 1), slot.get("fx", 50), slot.get("fy", 50))
            sheet.paste(piece, (l, t))
            src.close()
            if src_long < used_long:
                effective = round(dpi * src_long / used_long)
                notes.append(
                    f"{os.path.basename(path)}: המקור קטן מהשטח המודפס — כ-{effective} DPI בפועל"
                )
        except ExportError as e:
            notes.append(f"{os.path.basename(path)}: {e}")
        except Exception as e:  # noqa: BLE001
            notes.append(f"{os.path.basename(path)}: {e}")

    return sheet, notes


def export_album(
    payload: dict[str, Any],
    progress: Callable[[int, int], None] | None = None,
) -> dict[str, Any]:
    """Write every spread of an album to `out`.

    Raises ExportError for anything that makes the whole job impossible; a
    single bad frame is reported in `notes` and does not abandon the album.
    """
    out = payload.get("out") or ""
    if not out:
        raise ExportError("no output folder given")
    try:
        os.makedirs(out, exist_ok=True)
    except OSError as e:
        raise ExportError(f"cannot create {out}: {e}") from e

    spec = _spec_of(payload.get("spec") or {})
    try:
        dpi = int(payload.get("dpi") or DEFAULT_DPI)
    except (TypeError, ValueError):
        dpi = DEFAULT_DPI
    dpi = max(72, min(600, dpi))

    spreads: Iterable[dict[str, Any]] = payload.get("spreads") or []
    spreads = list(spreads)
    if not spreads:
        raise ExportError("the album has no spreads")

    cw, ch = canvas_size(spec, dpi)
    # 3 bytes per pixel, and the crop of a 50MP source alongside it. Refusing
    # here is kinder than an out-of-memory part way through spread 34.
    if cw * ch > 500_000_000:
        raise ExportError(f"sheet would be {cw}x{ch}px — lower the DPI or the album size")

    files: list[str] = []
    notes: list[str] = []
    total = len(spreads)

    for i, spread in enumerate(spreads):
        sheet, spread_notes = render_spread(spread, spec, dpi)
        name = f"spread-{i + 1:03d}.jpg"
        target = os.path.join(out, name)
        try:
            sheet.save(target, "JPEG", quality=JPEG_QUALITY, dpi=(dpi, dpi), subsampling=0)
        except OSError as e:
            raise ExportError(f"cannot write {name}: {e}") from e
        finally:
            sheet.close()
        files.append(target)
        notes.extend(f"כפולה {i + 1} · {n}" for n in spread_notes)
        if progress:
            progress(i + 1, total)

    return {
        "ok": True,
        "folder": out,
        "files": files,
        "dpi": dpi,
        "size": [cw, ch],
        "notes": notes,
    }
