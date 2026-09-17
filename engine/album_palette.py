"""The colours a photograph offers the page it will sit on.

An album page's background is chosen from its photographs, so the album needs
each frame's palette as a measured FACT rather than a guess: the colours that
actually cover area, measured where the frame is NOT skin, and the skin tone
itself kept separately.

Skin is separated on purpose. A background that lands on the same warmth and
the same lightness as a face flattens the face — the page and the person stop
being two things. So the colour rule needs to know what to stay away from as
much as it needs to know what to lean towards, and those are two different
measurements.

Colours are reported in Lab as lightness / chroma / hue, because that is how
the rule reasons: "keep the designed lightness, lean the hue towards the
photographs, keep the chroma quiet" is one clamp per axis in Lab and guesswork
in RGB.

CPU only, on a 160px copy of a frame the analysis already opened — a few
milliseconds beside the segmentation running next to it.
"""

import cv2
import numpy as np

# Big enough that a colour covering a tenth of the frame is hundreds of pixels,
# small enough that clustering is free.
MEASURE_MAX_DIM = 160
# How many colours are reported. Beyond five they stop being "the colours of
# this photograph" and start being its gradients.
CLUSTERS = 5
# Below this chroma a colour carries no usable hue: it is grey, and a hue read
# off it is noise.
NEUTRAL_CHROMA = 6.0
# A cluster covering less than this share of the frame is a detail, not a
# colour the page should answer to.
MIN_WEIGHT = 0.04


def _lab(rgb: np.ndarray) -> np.ndarray:
    """Lab with L in 0..100 and a/b in -127..127 — not OpenCV's 8-bit packing."""
    return cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)


def _hex_of_lab(lab: np.ndarray) -> str:
    rgb = cv2.cvtColor(lab.reshape(1, 1, 3).astype(np.float32), cv2.COLOR_LAB2RGB)
    r, g, b = (int(round(float(v) * 255)) for v in np.clip(rgb.reshape(3), 0.0, 1.0))
    return f"#{r:02x}{g:02x}{b:02x}"


def _described(lab: np.ndarray) -> dict:
    lightness, a, b = (float(v) for v in lab)
    chroma = float(np.hypot(a, b))
    hue = float(np.degrees(np.arctan2(b, a)) % 360.0)
    return {
        "hex": _hex_of_lab(np.asarray([lightness, a, b], dtype=np.float32)),
        "l": round(lightness, 2),
        "c": round(chroma, 2),
        "h": round(hue, 2),
    }


def _face_mask(shape, faces) -> np.ndarray:
    """True where a face is. Only the inner part of each reported box, because
    the box deliberately includes hair and breathing room, and neither is skin."""
    height, width = shape[:2]
    mask = np.zeros((height, width), dtype=bool)
    for box in faces or []:
        x = float(box["x"]) + float(box["width"]) * 0.2
        y = float(box["y"]) + float(box["height"]) * 0.2
        w = float(box["width"]) * 0.6
        h = float(box["height"]) * 0.6
        x0 = max(0, int(round(x * width)))
        y0 = max(0, int(round(y * height)))
        x1 = min(width, int(round((x + w) * width)))
        y1 = min(height, int(round((y + h) * height)))
        if x1 > x0 and y1 > y0:
            mask[y0:y1, x0:x1] = True
    return mask


def _skin(lab: np.ndarray, face_mask: np.ndarray) -> dict | None:
    """The skin tone inside the faces. The middle band of lightness only: the
    same box holds hair, a catchlight and a shadow, and their median is nobody's
    skin."""
    pixels = lab[face_mask]
    if pixels.shape[0] < 40:
        return None
    lightness = pixels[:, 0]
    low, high = np.percentile(lightness, [30.0, 80.0])
    band = pixels[(lightness >= low) & (lightness <= high)]
    if band.shape[0] < 20:
        band = pixels
    return _described(np.median(band, axis=0))


def _colors(pixels: np.ndarray) -> list[dict]:
    count = pixels.shape[0]
    if count < 16:
        return []
    clusters = int(min(CLUSTERS, max(1, count // 8)))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 8, 1.0)
    _, labels, centers = cv2.kmeans(
        pixels.astype(np.float32), clusters, None, criteria, 3, cv2.KMEANS_PP_CENTERS,
    )
    labels = labels.reshape(-1)
    out = []
    for index in range(clusters):
        weight = float(np.count_nonzero(labels == index)) / count
        if weight < MIN_WEIGHT:
            continue
        described = _described(centers[index])
        described["weight"] = round(weight, 4)
        out.append(described)
    out.sort(key=lambda color: -color["weight"])
    return out


def measure(rgb: np.ndarray, faces=None) -> dict:
    """The palette of one frame: its area-weighted colours away from skin, the
    skin tone itself, and how bright and how colourful the frame is overall.

    `faces` are the normalised boxes the analysis already found. With no faces
    the whole frame is measured, which is correct — a frame with no person in it
    has no skin to protect."""
    small = rgb
    height, width = rgb.shape[:2]
    longest = max(height, width)
    if longest > MEASURE_MAX_DIM:
        scale = MEASURE_MAX_DIM / float(longest)
        small = cv2.resize(
            rgb,
            (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
            interpolation=cv2.INTER_AREA,
        )

    lab = _lab(small)
    face_mask = _face_mask(small.shape, faces)
    skin = _skin(lab, face_mask)

    away_from_skin = lab[~face_mask]
    # A tight portrait is nearly all face. Measuring the few remaining pixels
    # would describe its corners, not the photograph, so the whole frame is used
    # and the separation from skin is left to the rule that reads `skin`.
    if away_from_skin.shape[0] < 200:
        away_from_skin = lab.reshape(-1, 3)

    colors = _colors(away_from_skin)
    chromatic = [color for color in colors if color["c"] >= NEUTRAL_CHROMA]
    flat = lab.reshape(-1, 3)
    return {
        "colors": colors,
        "chromaticCount": len(chromatic),
        "skin": skin,
        "meanL": round(float(flat[:, 0].mean()), 2),
        "meanC": round(float(np.hypot(flat[:, 1], flat[:, 2]).mean()), 2),
        "measuredBy": "album-palette-lab-v1",
    }
