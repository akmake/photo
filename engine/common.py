"""Shared image I/O for engine tools."""

import io
import base64
import threading

import numpy as np
from PIL import Image, ImageOps


# --------------------------------------------------------------- source scale
#
# THE FRAME A TOOL IS HANDED IS NOT ALWAYS THE PHOTOGRAPH.
#
# A panel renders a proxy so that a slider answers while it is being dragged —
# `server._render` caps the long edge, `_render_proxy` decodes small. Every
# tool then asks "are these pixels enough to work on" with an absolute count
# (MIN_FACE_PX, MIN_IRIS_PX, the 40px face-width floor), and asked about the
# proxy that question answers about the SCREEN instead of about the picture.
#
# Measured across the 8-frame set at panel width: five frames had three or four
# tools return the image untouched, flagged `faceTooSmall`, while the delivered
# file — same recipe, full resolution — retouched every one of them. The gate
# reads 80-178 on the proxy against 290-886 on the file. On 321A5078 the crop
# loop ran ZERO times at 1100px and the tool still reported "5 faces".
#
# So the pipeline carries one number: how much the frame in hand was shrunk
# from the file on disk. A tool converts its own floor with `source_px` and
# gets the same verdict in the panel and in the export.
#
# Thread-local for the reason `masks.set_source` is: image work runs on one
# worker thread, one frame at a time. Default 1.0 — a caller that says nothing
# is holding the real thing, which is what every script and test does.
_source = threading.local()


def set_source_scale(scale: float, frame=None) -> None:
    """Declare that this frame is 1/scale of the photograph's long edge.

    `frame` is the photograph itself when the caller still has it in memory.
    Holding it lets a face tool that cannot work at proxy size take its crop
    from the real pixels instead — the option docs/BUGS.md BUG-001 settled on,
    because the cost is bounded by the face and not by the frame. A caller that
    passes no frame (a 320px grid thumbnail, where the point is to CHOOSE a
    photograph rather than judge retouching) simply gets the honest refusal.
    """
    _source.scale = max(1.0, float(scale))
    _source.frame = frame


def clear_source_scale() -> None:
    _source.scale = 1.0
    _source.frame = None


def source_scale() -> float:
    return float(getattr(_source, "scale", 1.0) or 1.0)


def source_frame():
    return getattr(_source, "frame", None)


class at_source_scale:
    """Inside this block the frame in hand IS the photograph.

    A tool running on a crop taken from the file must not go on multiplying its
    measurements by a scale that describes the proxy it came from — it would
    conclude the face is twice the size the camera saw.
    """

    def __enter__(self):
        self._prev = (source_scale(), source_frame())
        _source.scale, _source.frame = 1.0, None
        return self

    def __exit__(self, *exc):
        _source.scale, _source.frame = self._prev
        return False


def source_px(px: float) -> float:
    """A length measured on the frame in hand, in pixels OF THE PHOTOGRAPH.

    This is the number every "is it big enough to treat" test wants. What the
    working copy can physically resolve is a different question, asked with the
    raw length — see cleanup's upscale path, which is about kernel geometry.
    """
    return float(px) * source_scale()


def face_verdict(work_px: float, floor_px: float, work_floor_px=None):
    """May a face tool run on this face? -> None to run, else the reason.

    ONE rule, in ONE place, because the five facial tools each carried their own
    copy of it and every copy asked the wrong frame. Two questions, deliberately
    separated:

      "faceTooSmall"     the PHOTOGRAPH does not contain enough face. A real
                         refusal, and identical in the panel and in the export —
                         which is the property that was missing.
      "previewTooSmall"  the photograph does, this copy does not. The delivered
                         file will get this. Saying nothing here is what made a
                         panel of untouched skin look like a verdict of clean
                         skin.

    `work_floor_px` defaults to the same number: a tool that has measured no
    separate working floor should not invent one.
    """
    if source_px(work_px) < floor_px:
        return "faceTooSmall"
    if work_px < (floor_px if work_floor_px is None else work_floor_px):
        return "previewTooSmall"
    return None


def _upright(img: Image.Image) -> Image.Image:
    """Apply the EXIF orientation tag.

    Camera JPEGs store portrait shots as landscape plus an orientation tag.
    Browsers apply it automatically; PIL does not. Without this the engine
    would analyse a sideways image (MediaPipe finds no faces) and return a
    result rotated 90 degrees from what the UI is showing.
    """
    try:
        return ImageOps.exif_transpose(img)
    except Exception:  # noqa: BLE001 - a broken EXIF block must not kill the load
        return img


def b64_to_image(data: str) -> Image.Image:
    if "," in data:  # strip a data: URL prefix if present
        data = data.split(",", 1)[1]
    return _upright(Image.open(io.BytesIO(base64.b64decode(data)))).convert("RGB")


def load_image(path: str) -> Image.Image:
    """Open a file from disk, EXIF-corrected."""
    return _upright(Image.open(path)).convert("RGB")


def image_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def image_to_jpeg_b64(img: Image.Image, quality: int = 90, subsampling: int = 2) -> str:
    """Smaller than PNG — used for previews sent to the UI.

    `subsampling` defaults to 4:2:0, which is fine for a preview and wrong for
    anything the photographer keeps: it throws away half the colour resolution.
    Saving a file must pass subsampling=0 (see render.DEFAULT_QUALITY).
    """
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, subsampling=subsampling)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def to_np(img: Image.Image) -> np.ndarray:
    return np.asarray(img).astype(np.uint8)


def to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


# Working resolution for masks and low-frequency work.
# Masks and tone layers carry no fine detail, so computing them on a 20MP frame
# is pure waste — we compute at this size and composite at full resolution.
PROC_MAX_DIM = 1600


def proc_scale(shape, max_dim: int = PROC_MAX_DIM) -> float:
    h, w = shape[:2]
    s = max_dim / max(h, w)
    return s if s < 1.0 else 1.0


def downscale(arr: np.ndarray, max_dim: int = PROC_MAX_DIM) -> np.ndarray:
    import cv2

    s = proc_scale(arr.shape, max_dim)
    if s >= 1.0:
        return arr
    h, w = arr.shape[:2]
    return cv2.resize(
        arr, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA
    )


def upscale_to(arr: np.ndarray, shape) -> np.ndarray:
    """Resize a low-frequency layer or mask back up to the full frame."""
    import cv2

    h, w = shape[:2]
    if arr.shape[0] == h and arr.shape[1] == w:
        return arr
    return cv2.resize(arr, (w, h), interpolation=cv2.INTER_LINEAR)


def region_box(mask: np.ndarray, pad: int, shape) -> tuple:
    """Bounding box of a mask, padded and clipped. None if the mask is empty.

    Facial tools only need the face, not the whole 20MP frame. Cropping to this
    box lets them run at FULL resolution (which blemish detection needs) while
    doing a fraction of the work.
    """
    ys, xs = np.where(mask > 0.01)
    if xs.size == 0:
        return None
    h, w = shape[:2]
    return (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(w, int(xs.max()) + pad + 1),
        min(h, int(ys.max()) + pad + 1),
    )


def clamp01(v, default=0.0) -> float:
    try:
        return max(0.0, min(1.0, float(v) / 100.0))
    except (TypeError, ValueError):
        return default
