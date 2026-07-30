"""The marking pass must describe the healing pass exactly.

    python test_cleanup_marking.py <image> [more images...]

The lab draws an outline around every candidate and lets a person choose which
ones to treat. That UI is worth nothing — worse than nothing, because it teaches
distrust — unless three things are true of the engine underneath it:

  1. AGREEMENT. Marking every candidate the engine accepted must reproduce the
     automatic result BIT FOR BIT. Not "closely": the automatic mask is defined
     as the union of the accepted candidates (see cleanup._candidates), so any
     difference at all means the two paths have drifted apart, which is the
     failure this module has already had to fix twice.

  2. ROUND TRIP. An outline is a lossless description of a repair blob only
     because every blob is solid (cleanup._fill_holes) — so findContours ->
     normalise to the frame -> back to pixels -> drawContours(FILLED) has to
     return the same pixels. Contours also travel through JSON at preview
     resolution and come back to be applied at full resolution, which is what
     the normalisation is for.

  3. OVERRIDE. A candidate the engine REJECTED must actually get treated when a
     person insists. A veto that cannot be overruled is not a judgement, it is a
     wall, and the person looking at the photograph outranks it.

Nothing here injects marks or measures quality — test_cleanup_recall.py and
test_blush.py own those questions. This file only asks whether the picture the
lab paints is the truth.
"""

import sys

import numpy as np

import cleanup
import common
import masks

PARAMS = {"redness": 90, "spots": 60}


def _selection(items):
    return {"polygons": [{"id": i["id"], "points": c} for i in items for c in i["contours"]]}


def _run(name: str, path: str) -> bool:
    rgb = common.to_np(common.load_image(path))
    masks.set_source(rgb)
    try:
        found = cleanup.detect(rgb, PARAMS)
        items = found["items"]
        healed = [i for i in items if i["verdict"] == "heal"]
        refused = [i for i in items if i["verdict"] != "heal"]
        kinds = sorted({i["kind"] for i in items})
        print(f"\n{name}  {found['width']}x{found['height']}  faces={found['faces']}")
        print(f"  candidates: {len(items)}  accepted {len(healed)}  refused {len(refused)}"
              f"  kinds {kinds or '-'}")
        by_verdict = {}
        for i in refused:
            by_verdict[i["verdict"]] = by_verdict.get(i["verdict"], 0) + 1
        if by_verdict:
            print(f"  refusals: {by_verdict}")
        if not items:
            print("  SKIP — nothing detected on this face, nothing to assert")
            return True

        ok = True

        # --- 2. round trip ---------------------------------------------------
        # Done first, on the geometry alone: if this fails, every other result
        # is unreadable, and the cause is coordinates rather than pipelines.
        rt = cleanup._selection_mask(rgb.shape, _selection(healed)["polygons"])
        again = cleanup._selection_mask(
            rgb.shape,
            [
                c
                for c in cleanup._contours(rt, 0, 0, rgb.shape[1], rgb.shape[0])
            ],
        )
        drift = int(np.count_nonzero(rt != again))
        print(f"  round trip: {int(rt.sum())} px, drift after a second pass {drift} px")
        if drift != 0:
            print("  FAIL — an outline does not describe its own mask")
            ok = False

        # --- 1. agreement ----------------------------------------------------
        auto, auto_meta = cleanup.apply(rgb, PARAMS)
        picked, picked_meta = cleanup.apply(
            rgb, {**PARAMS, "selection": _selection(healed)}
        )
        diff = np.abs(auto.astype(np.int16) - picked.astype(np.int16))
        print(f"  automatic: {auto_meta.get('spotsRemoved')} spots, "
              f"{auto_meta.get('correctedPx')} px")
        print(f"  marked all accepted: {picked_meta.get('spotsRemoved')} spots, "
              f"{picked_meta.get('correctedPx')} px")
        print(f"  agreement: max channel difference {int(diff.max())}, "
              f"{int(np.count_nonzero(diff))} px differ")
        if int(diff.max()) != 0:
            print("  FAIL — marking every accepted candidate did not reproduce the "
                  "automatic result")
            ok = False

        # --- nothing marked is a real answer, not a missing one --------------
        none_out, none_meta = cleanup.apply(rgb, {**PARAMS, "selection": {"polygons": []}})
        spot_px = int(np.count_nonzero(
            np.abs(none_out.astype(np.int16) - auto.astype(np.int16)).max(axis=2)
            * (cleanup._selection_mask(rgb.shape, _selection(healed)["polygons"]) > 0)
        ))
        print(f"  marked none: {none_meta.get('spotsRemoved')} spots — "
              f"{spot_px} px inside the accepted outlines differ from the automatic run")
        if none_meta.get("spotsRemoved"):
            print("  FAIL — an empty selection still healed something")
            ok = False

        # --- 3. override -----------------------------------------------------
        if refused:
            # the largest refusal: the one a person is most likely to argue with
            worst = max(refused, key=lambda i: i["facts"].get("areaPx", 0))
            forced, forced_meta = cleanup.apply(
                rgb, {**PARAMS, "selection": _selection([worst])}
            )
            mask = cleanup._selection_mask(rgb.shape, _selection([worst])["polygons"]) > 0
            base, _ = cleanup.apply(rgb, {**PARAMS, "selection": {"polygons": []}})
            moved = np.abs(forced.astype(np.int16) - base.astype(np.int16)).max(axis=2)
            inside = int(np.count_nonzero(moved * mask))
            outside = int(np.count_nonzero((moved > 2) & ~mask))
            print(f"  override ({worst['verdict']}, {worst['facts'].get('areaPx')} px, "
                  f"{worst['kind']}): {inside} px rebuilt inside the outline, "
                  f"{outside} px changed outside it")
            if inside == 0:
                print("  FAIL — a refused candidate could not be forced")
                ok = False
            if forced_meta.get("spotsRemoved", 0) < 1:
                print("  FAIL — forcing one candidate reported no repair")
                ok = False
        else:
            print("  override: no refusals on this face to test")

        return ok
    finally:
        masks.clear_source()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    results = []
    for path in sys.argv[1:]:
        results.append(_run(path.split("\\")[-1].split("/")[-1], path))
    print()
    print("PASS" if all(results) else "FAIL")
    raise SystemExit(0 if all(results) else 1)
