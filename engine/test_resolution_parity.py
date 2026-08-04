"""A tool that acts on the file must not be silent on the panel's proxy.

    python test_resolution_parity.py <image> [more images...]

This is the guard docs/BUGS.md BUG-001 asked for and did not have — "render at
preview width, render at full width, assert that a tool which acts in one acts
in the other". Its absence is why five face tools were inert in every preview
the app renders for months without anything on screen saying so.

What is asserted, per tool, per frame:

  1. ACTS.   If the tool changes the photograph, the preview either changes too
             or says `previewTooSmall`. Silence is the failure — the picture on
             screen is then not the picture being delivered, and nothing tells
             the photographer which one they are looking at.
  2. HONEST. A preview may never answer `faceTooSmall` for a face the export
             retouches. That word means "no resolution can help this face", and
             said falsely it sends the photographer to reshoot.
  3. QUIET.  A tool that does nothing at full resolution must not spring to life
             in the preview. Parity runs both ways.

Widths mirror the app: 320 is every grid, 1400 is the workbench well's default
(`SetWorkbench.tsx`). They are held to DIFFERENT promises — see WIDTHS.
"""

import sys

import numpy as np

import common
import render

# (width, is_edit_view). The workbench well renders 900-2600 and defaults to
# 1400 (`SetWorkbench.tsx`), and only THAT path hands the engine the file
# (`server._render`). A 320px grid goes through `/preview`, which deliberately
# does not — docs/BUGS.md BUG-001 settled that: "a 320px grid exists to CHOOSE
# frames, not to judge retouching", and loading a 20MP file per thumbnail is the
# cost the proxy cache exists to avoid.
#
# So the two sizes are held to different promises, and the weaker one is still a
# promise: at thumbnail size a tool may decline, but it may never decline in
# SILENCE. That is the whole defect — not that a tool skipped, but that nothing
# said so.
WIDTHS = [(320, False), (1400, True)]
# The shipped defaults, from src/toolRegistry.ts — the settings a photographer
# actually gets, not maxed-out ones that would hide a weak result.
RECIPE = [
    {"toolId": "face-retouch", "params": {"strength": 70}, "enabled": True},
    {"toolId": "skin-cleanup", "params": {"redness": 90, "spots": 25}, "enabled": True},
    {"toolId": "skin", "params": {"strength": 60}, "enabled": True},
    {"toolId": "contour", "params": {"cheek": 50, "sculpt": 40}, "enabled": True},
    {"toolId": "blush", "params": {"strength": 50}, "enabled": True},
]

def _steps(img, source_scale=1.0, source_img=None):
    _, meta = render.render(img, RECIPE, source_scale, source_img)
    return {s["tool"]: s.get("meta", {}) for s in meta["steps"]}


def _acted(meta) -> bool:
    """Did this step do anything a photographer would see?

    `faceDiameter` is in here because `abpn` reports success by measuring the
    face and says nothing else — its own multi-face loop counts a run the same
    way (`applied += int("faceDiameter" in m)`). Without it this guard called
    every successful full-resolution retouch "does nothing" and then failed the
    preview for doing more, which is a bug in the guard and not in the tool.
    """
    for key in ("spotsRemoved", "correctedPx", "pigmentPx", "applied",
                "blushApplied", "skinCoverage", "sourceChangedPx",
                "faceDiameter"):
        if float(meta.get(key, 0) or 0) > 0:
            return True
    return False


def check(path: str) -> bool:
    full = common.load_image(path)
    long_edge = max(full.size)
    print(f"\n{path}  {full.size[0]}x{full.size[1]}")

    at_full = _steps(full)
    ok = True

    for width, edit_view in WIDTHS:
        if width >= long_edge:
            continue
        s = width / float(long_edge)
        size = (max(1, round(full.size[0] * s)), max(1, round(full.size[1] * s)))
        proxy = full.resize(size, common.Image.LANCZOS)
        scale = long_edge / float(max(size))
        # `source_img` exactly as server._render passes it — and only there.
        at_proxy = _steps(proxy, scale, full if edit_view else None)

        print(f"  @{width} ({'edit view' if edit_view else 'thumbnail'}, "
              f"scale {scale:.1f}x)")
        for tool in [t["toolId"] for t in RECIPE]:
            fm, pm = at_full.get(tool, {}), at_proxy.get(tool, {})
            f_act, p_act = _acted(fm), _acted(pm)
            deferred = float(pm.get("previewTooSmall", 0) or 0) > 0
            lied = float(pm.get("faceTooSmall", 0) or 0) > 0 and f_act
            rescued = int(pm.get("fromSourceFaces", 0) or 0)
            # At thumbnail size the detector itself can fail — MediaPipe finds
            # nothing in a 320px frame that holds two children — and `noFace` is
            # a stated reason, not silence. Measured: 321A4934 and 321A5078 at
            # 320px. It is NOT accepted at edit-view size, where a photograph
            # with faces in it must be reported as having them.
            if not edit_view and float(pm.get("noFace", 0) or 0) > 0:
                deferred = True

            if f_act and not p_act and not deferred:
                print(f"    FAIL {tool:<13} acts on the file, silent in the preview")
                ok = False
            elif lied:
                print(f"    FAIL {tool:<13} preview says faceTooSmall for a face "
                      f"the file retouches")
                ok = False
            elif p_act and not f_act:
                print(f"    FAIL {tool:<13} acts in the preview, does nothing on the file")
                ok = False
            else:
                how = ("acts" if p_act else "defers to the file") + (
                    f", {rescued} face(s) from source" if rescued else "")
                print(f"    ok   {tool:<13} {how}")
    return ok


if __name__ == "__main__":
    paths = sys.argv[1:]
    if not paths:
        print(__doc__)
        sys.exit(2)
    results = [check(p) for p in paths]
    if not results:
        print("\nno frames checked — an empty run is not a pass")
        sys.exit(2)
    bad = results.count(False)
    print(f"\n{len(results)} frames, {bad} with a resolution disagreement")
    sys.exit(1 if bad else 0)
