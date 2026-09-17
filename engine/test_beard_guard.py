"""Spot cleanup must not touch a beard — docs/BUGS.md BUG-006.

    python test_beard_guard.py <image> [more images...]

For every image: find the facial hair (`face-hair`), run skin-cleanup at the
edit screen's defaults, and count the beard pixels it changed. Run twice — once
as shipped and once with the facial-hair mask switched off, which is the tool
as it was before the fix — so the report shows the damage and its removal side
by side, not just a number that happens to be small.

Fails when any image's beard still has more than BEARD_CHANGED_MAX of its
pixels moved by more than LEVELS.
"""

import os
import sys
import tempfile

import cv2
import numpy as np

import masks
import previews
import render

LEVELS = 8
BEARD_CHANGED_MAX = 0.002  # 0.2% of the beard: a stray feathered edge, not a patch
PARAMS = {"redness": 90, "spots": 25}

failures = 0


def changed_in_beard(path, guard: bool):
    source, img, scale = previews.working_frame(path, int(os.environ.get("BEARD_TEST_WIDTH", "1400")))
    key = previews.photo_key(path)
    rgb = np.asarray(img)
    masks.set_source(rgb, key)
    beard = masks.get_mask(rgb, "face-hair") > 0.5
    masks.clear_source()
    # The beard's INTERIOR. Its outermost pixel ring is shared with the cheek it
    # grows from, and a soft edge of a legitimate cheek repair may graze it
    # (measured on 321A5078: all 5 of the remaining moved pixels, none deeper).
    beard = cv2.erode(beard.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    # Each run gets caches of its own. The masks disk cache is keyed on the
    # picture, not on this switch, so a run with facial hair turned off would
    # otherwise leave empty beard masks behind for the next run to read.
    os.environ["TEZA_HOME"] = tempfile.mkdtemp(prefix=f"beard-guard-{guard}-")
    masks._CACHE.clear()
    masks._CAT_CACHE.clear()
    original = masks._compute_mask
    if not guard:
        def no_beard(frame, kind):
            if kind == "face-hair":
                return np.zeros(frame.shape[:2], np.float32)
            return original(frame, kind)
        masks._compute_mask = no_beard
        masks._CACHE.clear()
    try:
        render.clear_stage_cache()
        out, _ = render.render(img, [{"toolId": "skin-cleanup", "params": PARAMS, "enabled": True}],
                               scale, source, key=key)
    finally:
        masks._compute_mask = original
        masks._CACHE.clear()
    d = np.abs(np.asarray(out).astype(np.int16) - rgb.astype(np.int16)).max(axis=2)
    area = int(beard.sum())
    moved = int(((d > LEVELS) & beard).sum())
    return area, moved, int(d[beard].max()) if area else 0


def main(paths):
    global failures
    for p in paths:
        area, before, peak_b = changed_in_beard(p, guard=False)
        _, after, peak_a = changed_in_beard(p, guard=True)
        if area == 0:
            print(f"  --   {p}: no facial hair found")
            continue
        ok = after <= area * BEARD_CHANGED_MAX
        failures += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {p}: beard {area}px — changed by >{LEVELS}: "
              f"{before}px (peak {peak_b}) without the guard, {after}px (peak {peak_a}) with it")
    print("\nPASS" if not failures else f"\n{failures} FAILED")
    return failures


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1:]) else 0)
