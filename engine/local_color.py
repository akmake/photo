"""The shared primitive behind blush, eye sparkle and hair tones.

All three tools are the same operation: take a mask, push colour and/or tone
INSIDE it, and leave structure alone. Nothing is reconstructed, so unlike
healing there is no way for the result to invent something that was never there
— the worst case is "too much", which a clamp handles.

Everything works in CIELAB, and that is not a stylistic preference. Cutaneous
colorimetry measures skin on exactly these axes because they separate what we
need to control independently (see docs/RESEARCH-blush-eyes-hair.md):

    L*  lightness                  -> eye sparkle, hair shine
    a*  red<->green, ~erythema     -> blush (literally vascularisation)
    b*  yellow<->blue, ~melanin    -> hair warmth

A blush done as an `a*` push looks like blood under skin. The same blush done in
RGB looks like paint on top of it.

Note on ranges: OpenCV's 8-bit Lab packs a* and b* as value+128, so neutral is
128 and one unit is one unit of a*. All the `d_a` / `d_b` arguments here are in
those units, applied around 128.
"""

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# blend modes
# ---------------------------------------------------------------------------

def soft_light(base: np.ndarray, blend: np.ndarray) -> np.ndarray:
    """W3C / ISO 32000 soft-light. Inputs and output are 0..1 float.

    Photoshop's own curve differs slightly from the spec one, but the spec
    version is the one that is continuous at the midpoint — which matters when a
    tool ramps a layer up from zero and the user watches it move.
    """
    b = np.clip(base, 0.0, 1.0)
    s = np.clip(blend, 0.0, 1.0)
    d = np.where(b <= 0.25, ((16.0 * b - 12.0) * b + 4.0) * b, np.sqrt(np.maximum(b, 0.0)))
    return np.where(
        s <= 0.5,
        b - (1.0 - 2.0 * s) * b * (1.0 - b),
        b + (2.0 * s - 1.0) * (d - b),
    )


def to_lab(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(
        np.float32
    )


def to_rgb(lab: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(
        np.float32
    )


# ---------------------------------------------------------------------------
# the primitive
# ---------------------------------------------------------------------------

def push_lab(
    rgb: np.ndarray,
    mask: np.ndarray,
    d_l: np.ndarray | float = 0.0,
    d_a: np.ndarray | float = 0.0,
    d_b: np.ndarray | float = 0.0,
) -> np.ndarray:
    """Add per-channel Lab offsets, weighted by a 0..1 mask. Structure survives.

    `d_*` may be scalars or full-size arrays — an array lets a tool vary the
    push across the region (the iris gradient, the hair split-tone) without
    needing a second pass.
    """
    lab = to_lab(rgb)
    m = mask[..., None] if mask.ndim == 2 else mask
    delta = np.stack(
        [
            np.broadcast_to(np.asarray(d_l, np.float32), lab.shape[:2]),
            np.broadcast_to(np.asarray(d_a, np.float32), lab.shape[:2]),
            np.broadcast_to(np.asarray(d_b, np.float32), lab.shape[:2]),
        ],
        axis=-1,
    )
    return to_rgb(lab + delta * m)


def push_chroma_toward(
    rgb: np.ndarray,
    mask: np.ndarray,
    target_a: float,
    target_b: float,
    amount: float,
) -> np.ndarray:
    """Move a*/b* a fraction of the way to a target, leaving L* untouched.

    This is Photoshop's `Color` blend mode in the space where it is meaningful:
    hue and saturation change, luminance does not, so every pore, strand and
    highlight in the region is preserved exactly.
    """
    lab = to_lab(rgb)
    m = np.clip(mask, 0.0, 1.0) * float(amount)
    lab[..., 1] += (float(target_a) - lab[..., 1]) * m
    lab[..., 2] += (float(target_b) - lab[..., 2]) * m
    return to_rgb(lab)


def desaturate(rgb: np.ndarray, mask: np.ndarray, amount: float) -> np.ndarray:
    """Pull a*/b* toward neutral inside the mask. L* untouched."""
    return push_chroma_toward(rgb, mask, 128.0, 128.0, amount)


def split_tone(
    rgb: np.ndarray,
    mask: np.ndarray,
    shadow_ab: tuple,
    highlight_ab: tuple,
    amount: float,
    pivot: float = 0.5,
) -> np.ndarray:
    """One colour into the shadows, another into the highlights, ADDITIVELY.

    This is how hair is actually toned — reds into shadow, yellows into
    highlight — and it is what keeps hair from flattening into a wig, which is
    what a single global hue shift does to it. The weighting is driven by the
    region's OWN luminance, so strands that already catch light are the ones
    that get the highlight colour.

    `shadow_ab` / `highlight_ab` are OFFSETS, not absolute targets. A literal
    gradient map interpolates toward a fixed colour, which at any useful
    strength also collapses the hair's own a*/b* spread toward that colour —
    measured on the test frame it moved the mean by only 1.0 while flattening
    the variation that reads as separate strands. Adding the tone shifts the
    ramp and leaves the spread intact.
    """
    lab = to_lab(rgb)
    lum = lab[..., 0] / 255.0
    # smooth ramp around the pivot rather than a hard split, or the transition
    # between the two tones shows up as a visible band across the hair
    t = np.clip((lum - pivot) / 0.35 * 0.5 + 0.5, 0.0, 1.0)
    t = t * t * (3.0 - 2.0 * t)

    m = np.clip(mask, 0.0, 1.0) * float(amount)
    lab[..., 1] += (shadow_ab[0] + (highlight_ab[0] - shadow_ab[0]) * t) * m
    lab[..., 2] += (shadow_ab[1] + (highlight_ab[1] - shadow_ab[1]) * t) * m
    return to_rgb(lab)


def shine(
    rgb: np.ndarray,
    mask: np.ndarray,
    amount: float,
    knee: float | None = None,
) -> np.ndarray:
    """Dodge what is already bright, burn what is already dark, inside a mask.

    Retouchers build shine with a low-flow brush along the highlights that exist
    rather than pasting a specular layer on top — so the modulation here is
    driven by the region's own luminance and cannot put a highlight where the
    light never fell.

    `knee` defaults to the region's OWN median luminance, so the split is always
    half dodge and half burn. A fixed knee silently turns into a pure burn on
    dark hair and a pure dodge on blonde — measured on the test frame a knee of
    0.5 against a median of 0.40 darkened the hair overall instead of adding
    shine to it.
    """
    lab = to_lab(rgb)
    lum = lab[..., 0] / 255.0
    sel = mask > 0.35
    if knee is None:
        knee = float(np.median(lum[sel])) if sel.any() else 0.5
    knee = float(np.clip(knee, 0.08, 0.92))
    w = np.where(
        lum >= knee,
        (lum - knee) / max(1e-6, 1.0 - knee),
        (lum - knee) / max(1e-6, knee),
    )
    lab[..., 0] += np.clip(w, -1.0, 1.0) * float(amount) * 255.0 * 0.16 * np.clip(
        mask, 0.0, 1.0
    )
    return to_rgb(lab)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def feather(mask: np.ndarray, radius_px: float) -> np.ndarray:
    k = max(1, int(radius_px)) | 1
    return cv2.GaussianBlur(mask.astype(np.float32), (k, k), 0)


def local_median_ab(lab: np.ndarray, mask: np.ndarray) -> tuple:
    """Median a*/b* inside a mask — the region's own colour.

    Tools push RELATIVE to this instead of toward a fixed colour, because blush
    that ignores the subject's undertone and the scene's light reads as makeup
    applied in post. A warm backlit frame and a cool studio frame need different
    absolute targets to produce the same perceived result.
    """
    sel = mask > 0.35
    if not sel.any():
        return 128.0, 128.0
    return float(np.median(lab[..., 1][sel])), float(np.median(lab[..., 2][sel]))
