"""Which face tools are still alive at the widths the app renders previews at.

Every face tool refuses to run below a `MIN_FACE_PX` floor, and `face_d` scales
with the frame. The preview pipeline resizes BEFORE the recipe runs
(server.py `_render_proxy`), so the floor ends up being applied to the screen
size rather than to the photograph. This prints where each tool dies.

    python _diag_resolution_cliff.py [image ...]

Widths are the effective PIPELINE widths, not the requested ones: the proxy
path renders at max(requested, 640), so a 320px grid thumb is a 640px render.
See docs/BUGS.md - BUG-001.
"""

import sys

import numpy as np
from PIL import Image

import abpn
import blush
import cleanup
import common
import contour
import masks
import skin

# Params are deliberately maxed: this asks "can the tool act at all", not
# "how much does it act". A tool that is dead at strength 100 is dead.
TOOLS = [
    ("face-retouch", abpn.apply, {"strength": 100}, abpn.MIN_FACE_PX),
    ("skin-cleanup", cleanup.apply, {"redness": 100, "spots": 100}, cleanup.MIN_FACE_PX),
    ("skin", skin.apply, {"strength": 100, "evenness": 100}, skin.MIN_FACE_PX),
    ("contour", contour.apply, {"cheekbones": 100, "jaw": 100}, contour.MIN_FACE_PX),
    ("blush", blush.apply, {"strength": 100}, blush.MIN_FACE_PX),
]

# 640  - every grid in the app (requested 320/520, floored to 640 by the proxy)
# 1600 - BeforeAfter zoom, the widest preview that exists
# 0    - full resolution, i.e. what export actually renders
WIDTHS = [640, 1600, 0]

DEFAULT_IMAGES = [
    r"c:\Users\yosef dahan\Downloads\jm__yg0J2rjsE-dhAL\321A5327.JPG",
    r"c:\Users\yosef dahan\Downloads\jm__yg0J2rjsE-dhAL\321A5427.JPG",
]


def main(paths):
    for path in paths:
        full = common.load_image(path)
        print(f"\n{path.split(chr(92))[-1]}  {full.size[0]}x{full.size[1]}")
        head = "  ".join(f"{n:>13}" for n, _, _, _ in TOOLS)
        print(f"  {'width':>6} {'face_d':>7}  {head}")
        print(f"  {'':>6} {'floor:':>7}  " + "  ".join(f"{f:>13}" for _, _, _, f in TOOLS))

        for w in WIDTHS:
            im = full
            if w:
                s = w / max(full.size)
                im = full.resize(
                    (round(full.width * s), round(full.height * s)), Image.LANCZOS
                )
            rgb = common.to_np(im)
            face_d = int(np.sqrt(masks.get_mask(rgb, "face-skin").sum()))

            cells = []
            for _, fn, params, _ in TOOLS:
                out, _meta = fn(rgb, params)
                d = int(np.abs(out.astype(np.int16) - rgb.astype(np.int16)).max())
                cells.append(f"{d:>4} levels" if d > 0 else "        DEAD")

            label = f"{w}" if w else "full"
            print(f"  {label:>6} {face_d:>7}  " + "  ".join(f"{c:>13}" for c in cells))

    print(
        "\nface_d printed is the WHOLE-FRAME figure. Tools that dispatch per face\n"
        "(apply() -> face_boxes) test each crop separately, so a frame can read\n"
        "above the floor here and still be DEAD - see the 1600 row."
    )


if __name__ == "__main__":
    main(sys.argv[1:] or DEFAULT_IMAGES)
