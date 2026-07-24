"""Per-face skin appearance model.

The old blemish detector described what a FLAW looks like — "darker than its
surroundings", then "redder than its surroundings". That list is arbitrary and
never finishes: a lighter dry patch, a yellowish mark or a greasy highlight all
slip through. So the logic is inverted here:

    model what THIS person's skin IS, and treat whatever the model cannot
    explain as a flaw — in ANY direction.

The other half of the problem is that a child's face legitimately has strong
colour variation: rosy cheeks, a pale forehead, a red nose tip. A naive model
would call that "deviation" and iron it flat, destroying the thing that makes
a child's face look alive. The separation that saves us is SCALE:

    blush        = large, smooth  -> LOW frequency
    blemish      = small, defined -> MID frequency
    pores/noise  = tiny           -> HIGH frequency

The model is a smooth spatial field, so it BENDS to follow the blush and
absorbs it. What is left in the residual is only what a smooth field cannot
explain. Blush is therefore not "preserved by careful tuning" — the detector
is mathematically incapable of seeing it.
"""

import cv2
import numpy as np


def normalized_smooth(img: np.ndarray, mask: np.ndarray, radius: int) -> np.ndarray:
    """Gaussian smoothing that only ever averages MASKED pixels.

    A plain blur would pull background, hair and lip colour into the skin
    model near the edges of the face. Normalised convolution divides by the
    blurred mask, so only real skin contributes.
    """
    k = int(radius) | 1
    m = mask.astype(np.float32)
    if img.ndim == 3:
        num = cv2.GaussianBlur(img * m[..., None], (k, k), 0)
        den = cv2.GaussianBlur(m, (k, k), 0)[..., None]
    else:
        num = cv2.GaussianBlur(img * m, (k, k), 0)
        den = cv2.GaussianBlur(m, (k, k), 0)
    return num / np.maximum(den, 1e-5)


# Channel weights for the novelty measure.
#
# A CREASE is geometry: the nasolabial fold, an eyelid crease, the line under
# the chin. Geometry changes LIGHTNESS and leaves colour alone. A BLEMISH is
# pigment: irritation, a scratch, a mark. Pigment changes COLOUR.
#
# Weighting L down therefore makes the detector nearly blind to the face's own
# structure while staying fully sensitive to real marks. Without this it flags
# the smile line and the eyelid folds — and healing those flattens the face.
W_L, W_A, W_B = 0.25, 1.0, 0.7


def _robust_sigma(v: np.ndarray) -> float:
    med = float(np.median(v))
    return max(0.35, 1.4826 * float(np.median(np.abs(v - med))))


class SkinModel:
    """low: the skin's own colour field (blush lives here — never touched)
    mid: the band where blemishes live
    high: texture / pores
    novelty: Mahalanobis distance of `mid` from normal skin variation
    """

    def __init__(self, lab, low, mid, high, novelty):
        self.lab = lab
        self.low = low
        self.mid = mid
        self.high = high
        self.novelty = novelty


def build(rgb: np.ndarray, skin_region: np.ndarray, face_d: float) -> SkinModel:
    """skin_region: float 0..1 mask of usable skin (no features, no hair)."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)

    # LOW: the skin's own colour character. Wide enough that a blemish cannot
    # bend it, narrow enough to follow real blush.
    r_low = max(5, int(face_d * 0.12))
    # HIGH cut: just above pore/noise scale.
    r_high = max(1, int(face_d * 0.006))

    low = normalized_smooth(lab, skin_region, r_low)
    fine = normalized_smooth(lab, skin_region, r_high)

    mid = fine - low  # band-pass — this is the only band we judge
    high = lab - fine  # texture; kept so healing never looks like a plaster

    usable = skin_region > 0.5
    if usable.sum() < 64:
        novelty = np.zeros(lab.shape[:2], dtype=np.float32)
    else:
        # robust per-channel scale: what counts as "normal variation" for THIS
        # skin, so the tool behaves the same on clean studio skin and grainy
        # outdoor skin
        weights = (W_L, W_A, W_B)
        acc = np.zeros(lab.shape[:2], dtype=np.float32)
        for c, w in enumerate(weights):
            v = mid[..., c]
            med = float(np.median(v[usable]))
            sigma = _robust_sigma(v[usable])
            z = (v - med) / sigma
            acc += w * (z * z)
        novelty = np.sqrt(acc / sum(weights)).astype(np.float32)

    return SkinModel(lab, low, mid, high, novelty)
