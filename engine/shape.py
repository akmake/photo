"""Shape descriptors for detection gates — one correct implementation.

Every gate in this pipeline eventually asks the same two questions: *how thick
is this thing* and *how long is it*. Those questions have been answered
ad hoc at five separate call sites, three different ways, and the wrong answer
has now killed a real detection four times:

  · the lesion size gate measured a BOUNDING BOX and rejected a 38x50 scratch
    whose actual area was 396px  ("length is not evidence of innocence")
  · the anti-hair shape gate made the same error earlier
  · the crease veto needed elongation and had to invent its own
  · the fluid gate used `area / max(bbox_w, bbox_h)` and rejected the only
    validated drool in the project at 8.28 against a 7.77 bar

The bounding box is the root cause, and it is not a tuning problem:

    A DIAGONAL OR CURVED OBJECT DOES NOT FIT ITS BOX.
    A drool strand runs down and sideways, so max(box_w, box_h) is far SHORTER
    than the strand. `area / that` therefore reports a strand as much WIDER
    than it is — and the gate that rejects wide things fires on the thinnest
    object on the face. Curvature makes it worse the more strand-like the
    strand is.

So thickness is measured where thickness actually lives: the distance
transform, which is the radius of the largest circle centred on each pixel that
fits inside the shape. It knows nothing about orientation, curvature, or the
axes of the image, which is exactly the property the box lacks.

    thickness_typ = 4 * median(DT)   typical width
    thickness_max = 2 * max(DT)      widest point
    length        = area / thickness_typ
    elongation    = length / thickness_typ

`4 * median` is not a fudge: for a long rod of width w the distance transform is
uniform on [0, w/2], so its median is exactly w/4. `run_self_test()` asserts this
against synthetic rods, discs and a CURVED strand, because an estimator nobody
checked is how we got here.

Use `thickness_typ` to ask "is this thin?" — a hanging fluid ENDS IN A DROPLET,
and a median ignores the droplet while a max is dominated by it. Use
`thickness_max` to ask "does this contain anything fat?".
"""

from __future__ import annotations

import cv2
import numpy as np


class Descriptors:
    """Scale-free shape measurements of one connected component."""

    __slots__ = ("area", "thickness_typ", "thickness_max", "length", "elongation",
                 "solidity")

    def __init__(self, area, thickness_typ, thickness_max, length, elongation,
                 solidity):
        self.area = area
        self.thickness_typ = thickness_typ
        self.thickness_max = thickness_max
        self.length = length
        self.elongation = elongation
        self.solidity = solidity

    def __repr__(self):  # diagnostics print these constantly
        return (f"area={self.area} thick~{self.thickness_typ:.1f} "
                f"max{self.thickness_max:.1f} len={self.length:.1f} "
                f"elong={self.elongation:.1f} solid={self.solidity:.2f}")


def describe(component: np.ndarray) -> Descriptors:
    """Measure one binary component. `component` may be bool or uint8."""
    comp = (component > 0).astype(np.uint8)
    area = int(comp.sum())
    if area == 0:
        return Descriptors(0, 0.0, 0.0, 0.0, 0.0, 0.0)

    # Pad by one pixel: without it a component touching the crop edge is treated
    # as continuing past it and its distance transform is overstated there.
    padded = cv2.copyMakeBorder(comp, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    dt = cv2.distanceTransform(padded, cv2.DIST_L2, 5)[1:-1, 1:-1]
    inside = dt[comp > 0]

    thickness_typ = max(1.0, 4.0 * float(np.median(inside)))
    thickness_max = max(1.0, 2.0 * float(inside.max()))
    length = area / thickness_typ
    elongation = length / thickness_typ

    contours, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull_area = 0.0
    for c in contours:
        hull_area += float(cv2.contourArea(cv2.convexHull(c)))
    solidity = area / hull_area if hull_area > 1 else 1.0

    return Descriptors(area, thickness_typ, thickness_max, length, elongation,
                       solidity)


def describe_all(mask: np.ndarray, connectivity: int = 8):
    """Yield (index, component_bool, Descriptors) for every component in `mask`."""
    binary = (mask > 0).astype(np.uint8)
    count, labels, _, _ = cv2.connectedComponentsWithStats(binary, connectivity)
    for index in range(1, count):
        comp = labels == index
        yield index, comp, describe(comp)


# ---------------------------------------------------------------------------


def run_self_test() -> None:
    """Assert the estimators against shapes whose true dimensions are known.

    Includes a CURVED strand specifically, because the bug this module replaces
    was invisible on straight test shapes and only appeared on a real one.
    """
    canvas = lambda: np.zeros((240, 240), np.uint8)

    # 1. straight rod, width 8, length 160 -> thickness_typ must be ~8
    rod = canvas()
    rod[100:108, 40:200] = 1
    d = describe(rod)
    assert abs(d.thickness_typ - 8) <= 1.5, f"rod thickness {d.thickness_typ}"
    assert abs(d.length - 160) <= 25, f"rod length {d.length}"
    assert d.elongation > 12, f"rod elongation {d.elongation}"

    # 2. DIAGONAL rod: the SAME rod, rotated. Built by rotation rather than by
    #    cv2.line, because a thick diagonal line is rasterised ~sqrt(2) wider
    #    than its nominal thickness (measured 11.2 for thickness=8) — that would
    #    have tested the fixture, not the estimator.
    matrix = cv2.getRotationMatrix2D((120.0, 120.0), 40.0, 1.0)
    diag = cv2.warpAffine(rod, matrix, (240, 240), flags=cv2.INTER_NEAREST)
    d = describe(diag)
    assert abs(d.thickness_typ - 8) <= 2.0, f"diagonal thickness {d.thickness_typ}"
    # and the point of the whole module: the box estimator breaks here
    ys, xs = np.nonzero(diag)
    box_side = max(xs.max() - xs.min(), ys.max() - ys.min()) + 1
    assert d.area / box_side > d.thickness_typ + 1.0, (
        f"box estimator {d.area / box_side:.1f} should overstate width vs "
        f"{d.thickness_typ:.1f} on a diagonal"
    )

    # 3. CURVED strand — the real failure case. A bounding box under-measures
    #    its length badly, which inflates area/length into a "wide" verdict.
    #    Drawn as a 1px path then dilated by a disc, so its perpendicular width
    #    is exactly known regardless of the local slope (see the note above).
    curve = canvas()
    pts = np.array([[[120 + int(30 * np.sin(t / 22.0)), 40 + t]
                     for t in range(0, 160)]], np.int32)
    cv2.polylines(curve, pts, False, 1, thickness=1)
    curve = cv2.dilate(curve, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    d = describe(curve)
    box_w = int(pts[..., 0].max() - pts[..., 0].min()) + 7
    box_h = int(pts[..., 1].max() - pts[..., 1].min()) + 7
    box_width_estimate = d.area / max(box_w, box_h)
    assert abs(d.thickness_typ - 7) <= 2.0, f"curve thickness {d.thickness_typ}"
    assert box_width_estimate > d.thickness_typ, (
        "the bounding-box estimator is supposed to OVERSTATE width on a curve; "
        f"box said {box_width_estimate:.1f}, truth ~7"
    )

    # 4. disc, radius 30 -> not elongated, and thickness in the right ballpark
    disc = canvas()
    cv2.circle(disc, (120, 120), 30, 1, -1)
    d = describe(disc)
    assert d.elongation < 4, f"disc elongation {d.elongation}"
    assert d.thickness_max > 50, f"disc max thickness {d.thickness_max}"

    # 5. a strand ENDING IN A DROPLET: the droplet must not make it "wide"
    drop = canvas()
    cv2.line(drop, (120, 40), (120, 170), 1, thickness=6)
    cv2.circle(drop, (120, 178), 11, 1, -1)
    d = describe(drop)
    assert d.thickness_typ < 11, (
        f"a droplet head dragged typical thickness to {d.thickness_typ}; the "
        "median is supposed to ignore it"
    )
    assert d.thickness_max > 18, f"droplet not seen at all: {d.thickness_max}"

    print("shape.py self-test: PASS")
    print(f"  rod      {describe(rod)}")
    print(f"  diagonal {describe(diag)}")
    print(f"  curve    {describe(curve)}   (box estimator said "
          f"{box_width_estimate:.1f} wide)")
    print(f"  disc     {describe(disc)}")
    print(f"  droplet  {describe(drop)}")


if __name__ == "__main__":
    run_self_test()
