"""Manual cleaning: rebuild exactly what the photographer painted over.

WHY IT EXISTS. Automatic spot cleanup does two jobs — find what to clean, and
clean it well. The second is solved (LaMa, see lama_fill.py); the first is not,
and cannot be for everything: drool is transparent, a crumb in a beard looks
like beard, a shadow under a nostril looks like a mark. Every professional
retoucher's tool answers this the same way — the person points, the software
rebuilds — and so does every tool measured against ours (Lightroom's Remove,
Capture One's heal layer, Evoto's remove brush, Retouch4me's eraser).

So this tool has NO detector. It takes strokes and rebuilds under them. What it
refuses to do is decide; what it must never do is touch a pixel outside them.

WHY IT IS A STEP OF ITS OWN rather than more of `skin-cleanup`:
  - `selection` there means "of the marks you found, fix these" — a verdict on
    the detector's list. A hand-drawn stroke is not a verdict on anything, and
    one field cannot hold both answers.
  - it runs where nothing before it has to run again: the stage cache keeps
    every earlier step, so a new stroke costs the fill and the steps after it,
    not the retouch and the grade from the top.
  - it works with no face in the frame. `skin-cleanup` is a face tool by
    construction (its thresholds are fractions of the face), so dirt on a shirt
    or on a hand was unreachable; a person pointing at it is reason enough.

CONTEXT, AND WHY IT IS NOT lama_fill's DEFAULT. The filler hands the network a
window of skin around the mark. Cost grows with the window: measured on
chayamushka-103 at full resolution, a smear across a cheek took 35s with the
default (3.0 -> window = mark x 7). Two ways to cut it were measured side by
side on the same smear:

  shrink the window before the network sees it   35s -> 0.8s, and VISIBLY soft:
      every pore inside is resampled twice. Rejected on sight at 100%.
  give it less skin to look at (this)            35s -> 6.9s at 1.0, 2.9s at
      0.5, with no difference I can find at 100% — the pixels are never
      resampled at all.

1.0 is the setting here: 5x faster than the default with the texture intact,
and still a whole mark's width of skin on every side to read the tone from.
`skin-cleanup` keeps the old default — changing what the automatic tool
produces is a separate decision, not a side effect of adding a brush.
"""

import cv2
import numpy as np

import lama_fill

# Window = mark size x (1 + 2 x CONTEXT). See the note above.
CONTEXT = 1.0
# A stroke narrower than this is still given a real brush: a single-pixel line
# tells the network almost nothing to replace and reads as a scratch.
MIN_RADIUS_PX = 2


def _mask(shape, strokes) -> np.ndarray:
    """(H, W) uint8 0/1 — the union of the strokes, in THIS frame's pixels."""
    h, w = shape[:2]
    m = np.zeros((h, w), np.uint8)
    for s in strokes or []:
        pts = s.get("points") or []
        if not pts:
            continue
        # The radius is a fraction of the WIDTH, so a stroke keeps its size
        # relative to the photograph at every resolution this runs at.
        r = max(MIN_RADIUS_PX, int(round(float(s.get("r", 0.0)) * w)))
        xy = [(int(round(float(p[0]) * w)), int(round(float(p[1]) * h))) for p in pts]
        if len(xy) == 1:
            cv2.circle(m, xy[0], r, 1, -1)
            continue
        # A polyline with round joints, not a chain of discs: the gaps between
        # sampled points would otherwise show as scallops along a fast stroke.
        cv2.polylines(m, [np.array(xy, np.int32)], False, 1, r * 2, cv2.LINE_8)
        cv2.circle(m, xy[0], r, 1, -1)
        cv2.circle(m, xy[-1], r, 1, -1)
    return m


def apply(rgb: np.ndarray, params: dict):
    """rgb uint8 HxWx3, params {"strokes": [...]} -> (rgb, meta)."""
    strokes = params.get("strokes") or []
    if not strokes:
        return rgb, {"strokes": 0, "cleanedPx": 0}

    repair = _mask(rgb.shape, strokes)
    if not repair.any():
        return rgb, {"strokes": len(strokes), "cleanedPx": 0}

    if not lama_fill.available():
        # Honest fallback, not a silent no-op: the weights are optional and a
        # tool that does nothing without saying so is the most expensive kind
        # of bug (CLAUDE.md section 6). Telea is visibly worse than LaMa on
        # skin; it is here so the brush still removes something, and so the
        # panel can say which filler did it.
        out = cv2.inpaint(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), repair, 3, cv2.INPAINT_TELEA)
        out = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)
    else:
        out = lama_fill.fill(rgb, repair, context=CONTEXT)

    return out, {
        "strokes": len(strokes),
        "cleanedPx": int(repair.sum()),
        "filler": "lama" if lama_fill.available() else "telea",
    }
