"""Soft proof: the spread as the lab's paper will show it.

A lab's ICC profile describes what its printer and paper can actually make.
Converting the screen's sRGB through it and back shows the photographer, on
the monitor, the colours the paper will give — before paying for a print.

The recipe is the one every print guide gives (docs/RESEARCH-album-print-export.md §4.2):
relative colorimetric with black-point compensation by default, perceptual as
the alternative for saturated images, and "simulate paper" off by default —
it flattens contrast and is shown only on request.

Colours the paper cannot reach are found by LittleCMS's own gamut check
(the gamut warning of every colour-managed editor). A plain round trip
sRGB → paper → sRGB was tried first and rejected: on a LUT printer profile the
two directions do not invert exactly, so even mid-grey came back ΔE 5 away and
the "warning" covered the whole photograph (measured 16.10.2026 on SWOP).
The deepest shadows are left out: black-point compensation maps the screen's
black onto the paper's, so a lab prints them — flagging them would mark every
photograph. Out-of-gamut areas come back as a HAIRLINE contour, never a fill:
the photograph under the warning stays fully visible.
"""

import base64
import io

import numpy as np
from PIL import Image, ImageCms, ImageFilter

_SRGB = ImageCms.createProfile("sRGB")
_LAB = ImageCms.createProfile("LAB")
# Below this lightness, black-point compensation carries the shadow onto the
# paper's black — not a colour the lab fails to print.
_SHADOW_L = 12.0

_INTENTS = {
    "relative": ImageCms.Intent.RELATIVE_COLORIMETRIC,
    "perceptual": ImageCms.Intent.PERCEPTUAL,
}


def _profile(icc: bytes):
    return ImageCms.ImageCmsProfile(io.BytesIO(icc))


def describe(icc: bytes) -> dict:
    """What the file is — refused early if it is not a printer profile."""
    profile = _profile(icc)
    description = ImageCms.getProfileDescription(profile).strip()
    space = profile.profile.xcolor_space.strip()
    device_class = profile.profile.device_class.strip()
    return {"description": description, "colorSpace": space, "deviceClass": device_class}


def _to_lab(image: Image.Image) -> np.ndarray:
    transform = ImageCms.buildTransform(_SRGB, _LAB, "RGB", "LAB")
    lab = np.asarray(ImageCms.applyTransform(image, transform)).astype(np.float32)
    # Pillow's LAB: L 0..255 → 0..100, a/b stored as signed bytes.
    L = lab[..., 0] * (100.0 / 255.0)
    a = lab[..., 1].astype(np.uint8).view(np.int8).astype(np.float32)
    b = lab[..., 2].astype(np.uint8).view(np.int8).astype(np.float32)
    return np.stack([L, a, b], axis=-1)


def _regions(mask: np.ndarray) -> np.ndarray:
    """Out-of-gamut AREAS, not pixels.

    The per-pixel answer is right and unreadable: in foliage, hair or lace
    every other pixel flips, and its outline became thousands of specks laid
    over the photograph — on a child's face included (measured 16.10.2026,
    six shoots). So the mask is read at a coarser grain: a cell counts when
    most of it is out of gamut, specks are opened away, gaps closed, and the
    edge is smoothed back up to full size.
    """
    h, w = mask.shape
    cell = max(4, round(max(h, w) / 300))
    small = Image.fromarray((mask * 255).astype(np.uint8), "L").resize(
        (max(1, w // cell), max(1, h // cell)), Image.BOX,
    )
    small = small.point(lambda v: 255 if v >= 128 else 0)
    small = small.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))  # specks out
    small = small.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))  # gaps closed
    big = small.resize((w, h), Image.BILINEAR)
    return np.asarray(big) >= 128


def _contour(mask: np.ndarray) -> Image.Image:
    """A 1px outline round every out-of-gamut region, dark and light in turn
    so it reads on any colour. Transparent everywhere else."""
    edge = np.zeros_like(mask)
    edge[1:, :] |= mask[1:, :] != mask[:-1, :]
    edge[:, 1:] |= mask[:, 1:] != mask[:, :-1]
    edge &= mask
    h, w = mask.shape
    rgba = np.zeros((h, w, 4), np.uint8)
    checker = ((np.arange(h)[:, None] // 3 + np.arange(w)[None, :] // 3) % 2).astype(bool)
    rgba[edge & checker] = (20, 20, 20, 255)
    rgba[edge & ~checker] = (255, 255, 255, 255)
    return Image.fromarray(rgba, "RGBA")


def soft_proof(image_bytes: bytes, icc: bytes, intent: str = "relative",
               simulate_paper: bool = False) -> dict:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    paper = _profile(icc)
    chosen = _INTENTS.get(intent, ImageCms.Intent.RELATIVE_COLORIMETRIC)
    flags = ImageCms.Flags.SOFTPROOFING | ImageCms.Flags.BLACKPOINTCOMPENSATION
    # Absolute colorimetric on the proof leg shows the paper's own white.
    proof_intent = (ImageCms.Intent.ABSOLUTE_COLORIMETRIC if simulate_paper
                    else ImageCms.Intent.RELATIVE_COLORIMETRIC)

    def proof_transform(extra=0):
        return ImageCms.buildProofTransform(
            _SRGB, _SRGB, paper, "RGB", "RGB",
            renderingIntent=chosen, proofRenderingIntent=proof_intent,
            flags=flags | extra,
        )

    proofed = ImageCms.applyTransform(image, proof_transform())
    alarmed = ImageCms.applyTransform(image, proof_transform(ImageCms.Flags.GAMUTCHECK))
    # LittleCMS paints out-of-gamut pixels in its alarm colour; where the two
    # proofs differ, the pixel was out of gamut.
    mask = np.any(np.asarray(proofed) != np.asarray(alarmed), axis=-1)
    mask &= _to_lab(image)[..., 0] > _SHADOW_L
    pixel_share = float(mask.mean())
    mask = _regions(mask)

    proof_buffer = io.BytesIO()
    proofed.save(proof_buffer, "JPEG", quality=92, subsampling=0)
    contour_buffer = io.BytesIO()
    _contour(mask).save(contour_buffer, "PNG", optimize=True)
    return {
        "image": "data:image/jpeg;base64," + base64.b64encode(proof_buffer.getvalue()).decode("ascii"),
        "gamut": "data:image/png;base64," + base64.b64encode(contour_buffer.getvalue()).decode("ascii"),
        # What is outlined, and — for the record — what the pixels said.
        "outOfGamutPercent": round(float(mask.mean()) * 100.0, 2),
        "outOfGamutPixelPercent": round(pixel_share * 100.0, 2),
        "profile": describe(icc),
    }
