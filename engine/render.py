"""Recipe rendering and export — the authoritative pipeline.

A recipe is an ordered stack of tools. This runs the whole stack in one call,
which matters for two reasons:

  * masks are computed ONCE from the original instead of once per tool;
  * it is the same code path used for batch export, so what the photographer
    exports is what the pipeline actually produces.
"""

import os
import time

import cv2
import numpy as np

import common
import masks

import abpn
import background
import blush
import cleanup
import eyes
import glow
import hairtone
import skin
import globals_py
import hsl
import pixel_color
import grade_zones
import dehaze
import contour
import tonal_contrast

# toolId -> (callable, pipeline order). Lower order runs first.
# All entries share the (rgb, params) -> (rgb, meta) contract so the frame stays
# a numpy array for the whole chain — no PNG round-trip between steps.
TOOLS = {
    # sensor noise goes first, before any tool sharpens or stretches it —
    # the same place a raw pipeline runs its denoise
    "noise-reduction": (globals_py.noise_reduction, 5),
    "face-retouch": (abpn.apply, 8),  # learned model — the primary skin tool
    "skin-cleanup": (cleanup.apply, 10),
    "skin": (skin.apply, 20),
    # sculpting comes AFTER smoothing — smoothing an added highlight would
    # flatten it straight back out — and before any colour work
    "contour": (contour.apply, 21),
    # Colour work on the retouched face: after smoothing, which would otherwise
    # wash a blush straight back out, and before any global grade.
    "blush": (blush.apply, 22),
    "eye-sparkle": (eyes.apply, 23),
    "hair-tones": (hairtone.apply, 24),
    "background-blur": (background.apply, 25),
    # A LOOK LEARNED FROM A PAIR, carried as a step like any other.
    #
    # It sits here — after the face work, before tone-color — because the model
    # was fitted against a finished edit, so it carries the whole grade: it has
    # to see retouched skin (or it transfers the look onto blemishes that will
    # not be there), and everything a photographer turns afterwards has to land
    # ON TOP of it rather than be swallowed by it.
    #
    # `pixel_color.apply(rgb, model)` already satisfies the (rgb, x) ->
    # (rgb, meta) contract every entry here shares, so nothing about it is
    # special-cased in the loop — only the second argument is a fitted model
    # instead of sliders, which is why a step carries `model` (see render()).
    "pixel-color": (pixel_color.apply, 28),
    "tone-color": (globals_py.tone_color, 30),
    # parametric curves sit between the basic tone panel and the local tools,
    # exactly where a raw pipeline runs its tone curve
    "curves": (globals_py.curves, 32),
    # the photographer's "3D": zonal structure contrast on clothes (and skin,
    # when a recipe enables it — always after smoothing at 20, her ordering)
    "tonal-contrast": (tonal_contrast.apply, 33),
    # haze sits in front of the scene, so it comes off before anything shapes
    # the tone that is behind it. Depth-driven, hence engine-side only.
    "dehaze": (dehaze.apply, 34),
    "dimension": (globals_py.dimension, 35),
    # split out of dimension at 36 — the same place in the chain it always ran
    "vignette": (globals_py.vignette, 36),
    # RETIRED, merged into grade-zones. Still dispatched so recipes saved before
    # the merge render exactly as they did; nothing new is fitted into it.
    "color-grade": (globals_py.color_grade, 40),
    # Per-hue control sits BEFORE the zone grade: decide what each colour is,
    # then tint the tonal zones on top of it.
    "hsl": (hsl.apply, 41),
    "grade-zones": (grade_zones.apply, 42),
    "light-point": (globals_py.light_point, 45),
    # frame-wide `amount` is unchanged; the people/skin/fabric sliders are
    # mask-driven and live engine-side only (see glow.py)
    "glow": (glow.apply, 55),
    "oil-paint": (globals_py.oil_paint, 58),
    "sharpen": (globals_py.sharpen, 60),
}


# Tools defined RELATIVE TO THE FRAME cannot be masked to a region. A vignette
# is a radial gradient centred on the picture; multiplying it by a person-shaped
# mask produces arcs and blotches across the background, which is exactly what
# happened when the fitter was free to put `vignette` in a subject slot. The
# same holds for a placed light and for glow, which spreads across the frame.
# `dimension` came off this list when the vignette moved out of it: clarity and
# texture are defined relative to the CONTENT, and texture on a dress but not on
# a face is an ordinary retouching move that used to be impossible.
FRAME_ONLY = {"light-point", "glow", "vignette"}


# The smallest face each tool can still do something with, declared once where
# the pipeline can see it. These are the tools docs/BUGS.md BUG-001 measured as
# inert in every preview the app renders; the numbers are the tools' own.
#
# `skin-cleanup` is NOT its MIN_FACE_PX, and using that was a bug worth stating.
# 180 is the size it needs the frame it WORKS on to be, and `_apply_upscaled`
# is how it gets there — so the smallest face it can actually treat is
# MIN_FACE_PX / UPSCALE_MAX = 90. Asking the file for 180 meant a face of 149px
# was declared beyond help and skipped, while a full-resolution render retouched
# it happily. Measured on 321A5078, whose five faces are 149-227 in the file:
# three of them were being refused, so the tool reported real work on two faces
# and the photographer saw almost nothing.
FACE_FLOOR = {
    "face-retouch": abpn.MIN_FACE_PX,
    "skin-cleanup": cleanup.MIN_WORK_PX,
    "skin": skin.MIN_FACE_PX,
    "contour": contour.MIN_FACE_PX,
    "blush": blush.MIN_FACE_PX,
}


def _source_face_boxes(rgb, floor_px):
    """Face crops worth taking from the FILE instead of from this proxy.

    -> [(box in the working frame, box in the photograph)], empty when there is
    nothing to rescue: no file in hand, no shrink, or a face that already clears
    the floor here (the tool runs normally) or clears nothing anywhere (the tool
    is right to refuse, at any resolution).
    """
    src = common.source_frame()
    scale = common.source_scale()
    if src is None or scale <= 1.01:
        return []

    faces = masks._face_landmarks(rgb) or []
    if not faces:
        return []

    sh, sw = src.shape[:2]
    h, w = rgb.shape[:2]
    out = []
    for lm in faces:
        xs = np.array([p.x * w for p in lm])
        ys = np.array([p.y * h for p in lm])
        # This face, alone — a group frame is N small faces, and cropping their
        # union out of a 20MP file would be the whole 20MP file.
        fw = float(max(1.0, xs.max() - xs.min()))
        pad = fw * 0.45
        x0 = max(0, int(xs.min() - pad));  x1 = min(w, int(xs.max() + pad))
        y0 = max(0, int(ys.min() - pad));  y1 = min(h, int(ys.max() + pad * 1.6))
        if x1 - x0 < 8 or y1 - y0 < 8:
            continue

        # MEASURED, not estimated from the landmark box. And measured BOTH ways
        # the tools measure, because they are not consistent with each other:
        # the outer gates read sqrt(face-skin area) while `blush._cheek_band`
        # and `contour._bands` read landmark width against the same constant.
        # Taking the smaller means a face any gate would drop here gets its
        # pixels from the file, which is the point. The mask is cached by
        # content and the crop is small.
        face_d = float(np.sqrt(masks.get_mask(rgb[y0:y1, x0:x1], "face-skin").sum()))
        # The two tests take OPPOSITE ends, and using one end for both was a
        # bug: `min` for both meant a face blush itself called rescuable was
        # skipped here (measured on 321A4934 at 320px — blush acted on the file
        # and stayed silent in the panel). Rescue when ANY gate would block this
        # face here, and ANY gate would pass it there. Anything narrower leaves
        # a face stranded between two tools that measure it differently.
        blocked_here = min(face_d, fw) if face_d > 0 else fw
        passes_there = max(face_d, fw) * scale
        if blocked_here <= 0 or blocked_here >= floor_px:
            continue                      # every gate in the tool clears it
        if passes_there < floor_px:
            continue                      # too small in the file too — refuse honestly
        sx0 = max(0, min(sw - 1, int(round(x0 * scale))))
        sx1 = max(sx0 + 1, min(sw, int(round(x1 * scale))))
        sy0 = max(0, min(sh - 1, int(round(y0 * scale))))
        sy1 = max(sy0 + 1, min(sh, int(round(y1 * scale))))
        out.append(((x0, y0, x1, y1), (sx0, sy0, sx1, sy1)))
    return out


def _run_on_source_faces(fn, rgb, params, floor_px):
    """Run a face tool at the FILE's resolution and composite the result down.

    THE FIX FOR BUG-001. A panel renders a proxy so the sliders answer, and on
    that proxy every face tool measured itself out of a job: five of five dead
    at 640px, four of five at 1600, all of them alive on export. Lowering the
    floors was rejected (they protect the result) and rendering previews at
    file size was rejected (it is the cost the proxy exists to avoid). This is
    the third option: the pixels the tool needs are read from the photograph,
    for the faces that need them, and the edit is brought back down.

    Only the CHANGED pixels come back, through the same alpha trick cleanup's
    own resample uses, so untouched skin stays bit-identical to the proxy and
    the composite can never soften the frame it is previewing.

    -> (rgb, meta) or None when there was nothing to rescue.
    """
    pairs = _source_face_boxes(rgb, floor_px)
    if not pairs:
        return None

    src = common.source_frame()
    out = rgb.copy()
    metas, touched_total, done = [], 0, 0
    for (x0, y0, x1, y1), (sx0, sy0, sx1, sy1) in pairs:
        crop = src[sy0:sy1, sx0:sx1]
        if crop.size == 0:
            continue
        # Inside here the crop IS the photograph — see common.at_source_scale.
        with common.at_source_scale():
            edited, meta = fn(crop, params)
        metas.append(meta)
        changed = (np.abs(edited.astype(np.int16) - crop.astype(np.int16))
                   .max(axis=2) > 0)
        if not changed.any():
            continue
        bw, bh = x1 - x0, y1 - y0
        back = cv2.resize(edited, (bw, bh), interpolation=cv2.INTER_AREA)
        alpha = cv2.resize(changed.astype(np.float32), (bw, bh),
                           interpolation=cv2.INTER_AREA)
        r = max(3, int(min(bh, bw) * 0.01)) | 1
        alpha = cv2.GaussianBlur(alpha, (r, r), 0)[..., None]
        window = out[y0:y1, x0:x1].astype(np.float32)
        out[y0:y1, x0:x1] = np.clip(
            np.rint(window * (1.0 - alpha) + back.astype(np.float32) * alpha),
            0, 255,
        ).astype(np.uint8)
        touched_total += int(changed.sum())
        done += 1

    if not metas:
        return None

    merged = {}
    for m in metas:
        for k, v in m.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                merged[k] = merged.get(k, 0) + v
            else:
                merged.setdefault(k, v)
    # The refusals belong to a frame that is no longer the one being reported.
    merged.pop("faceTooSmall", None)
    merged.pop("previewTooSmall", None)
    merged["fromSourceFaces"] = done
    merged["sourceChangedPx"] = touched_total
    return out, merged


def _region_mask(rgb, spec):
    """Build the 0..1 map a masked tool is blended through.

    spec: {region, invert, feather, strength, paint?}. `region` is any kind
    masks.py knows — subject, hair, face-skin, body-skin, face-features — plus
    `background` (the subject inverted) and `painted`: a hand-drawn alpha the
    UI ships as a base64 image in `paint`, at whatever resolution it was drawn.
    Painted masks are per-photo state — they live with the photo, never inside
    a style, because a brush stroke cannot transfer to the next frame.
    """
    region = spec.get("region", "subject")
    invert = bool(spec.get("invert", False))
    if region == "background":
        region, invert = "subject", not invert

    if region == "painted":
        paint = spec.get("paint")
        if not paint:
            return np.zeros(rgb.shape[:2], np.float32)
        pm = common.to_np(common.b64_to_image(paint)).astype(np.float32)
        if pm.ndim == 3:
            pm = pm[..., :3].max(axis=2)
        m = cv2.resize(pm / 255.0, (rgb.shape[1], rgb.shape[0]),
                       interpolation=cv2.INTER_LINEAR)
    else:
        m = masks.get_mask(rgb, region).astype(np.float32)
    if invert:
        m = 1.0 - m

    feather = float(spec.get("feather", 0) or 0)
    if feather > 0:
        # relative to the frame, so a recipe behaves the same at any resolution
        sigma = max(0.5, feather / 100.0 * 0.02 * max(rgb.shape[:2]))
        m = cv2.GaussianBlur(m, (0, 0), sigma)

    strength = float(spec.get("strength", 100) or 100) / 100.0
    return np.clip(m * strength, 0.0, 1.0)


def render(img, recipe_tools, source_scale: float = 1.0, source_img=None, key=None):
    """img: PIL image. recipe_tools: [{toolId, params, enabled, mask?, model?}].

    A tool carrying `mask` is applied through it instead of over the whole
    frame, which is what lets one recipe hold the SAME tool twice with opposite
    settings — cool and dark on the background, warm and bright on the subject.
    A single global grade cannot express that, and measuring a real edit showed
    it is exactly what retouchers do: the fitted temperature pinned at +100
    trying to satisfy the subject and the field at once.

    `source_scale` is how much `img` was shrunk from the photograph on disk —
    1.0 for a delivery, ~5 for a 5472px file previewed in an 1100px panel. It
    exists so that "is this face big enough to treat" gets the SAME answer in
    the panel and in the export; see common.source_px for what it cost not to
    have it. A caller that omits it is holding the real file.

    `source_img` is that file, when the caller still has it. With it, a face
    the proxy is too small to serve is worked from the real pixels and composited
    down (`_run_on_source_faces`); without it, the tool says so and stops. Pass
    it for the frame being EDITED and not for a wall of thumbnails — that
    distinction is the whole reason the proxy cache exists.
    """
    active = [
        t
        for t in recipe_tools
        if t.get("enabled", True) and t.get("toolId") in TOOLS
    ]
    active.sort(key=lambda t: TOOLS[t["toolId"]][1])

    rgb = common.to_np(img)
    # `key` names the photograph so its masks outlive this particular width.
    masks.set_source(rgb, key)  # every tool sees the same, pristine masks
    # ...and the same idea of "big enough", plus the file itself when we have it
    common.set_source_scale(
        source_scale, common.to_np(source_img) if source_img is not None else None
    )
    try:
        steps = []
        for t in active:
            fn = TOOLS[t["toolId"]][0]
            t0 = time.time()
            spec = t.get("mask")
            if spec and t["toolId"] in FRAME_ONLY:
                spec = None  # frame-relative tool: a region mask makes artefacts
            params = t.get("params", {})
            # Per-photo state that is not a slider: the outlines a person marked
            # in the lab's detection view. It rides the recipe entry rather than
            # `params` because params are numbers by contract (see types.ts), and
            # it must reach the EXPORT — a selection that only worked in the
            # preview would be a control that lies about what gets delivered.
            if t.get("selection") is not None:
                params = {**params, "selection": t["selection"]}
            # A FITTED MODEL, not sliders. `pixel-color` is calibrated from a
            # before/after pair and arrives as anchors, deltas and confidences —
            # it cannot travel in `params`, which is numbers by contract
            # (types.ts). It rides its own field for the same reason `selection`
            # does, and for the same reason it must reach the export: a look
            # that only existed in the preview would be a lie about delivery.
            if t.get("model") is not None:
                params = t["model"]
            out, meta = fn(rgb, params)
            # A face too small in THIS frame but not in the file gets its own
            # pixels rather than an apology.
            #
            # Triggered by the tool's OWN verdict, not by this file's guess at
            # what the tool's floor means. The two disagreed: `blush` and
            # `contour` each carry a second, per-face gate measured on landmark
            # WIDTH while the outer one reads sqrt(skin area), so a face that
            # cleared the estimate here was still dropped in there — measured as
            # "acts on the file, silent in the preview" on 321A4934 and 321A5078.
            # Asking the tool costs one cheap failed run and cannot drift.
            if meta.get("previewTooSmall") and t["toolId"] in FACE_FLOOR:
                rescued = _run_on_source_faces(
                    fn, rgb, params, FACE_FLOOR[t["toolId"]]
                )
                if rescued is not None:
                    out, meta = rescued
            if spec:
                m = _region_mask(rgb, spec)[..., None]
                out = (rgb.astype(np.float32) * (1.0 - m)
                       + out.astype(np.float32) * m)
                # rint, not a bare cast: astype truncates, so a mask weight of
                # 1e-4 pulling downward would drop a full level (measured 0.10
                # mean inside a fully-protected brush core)
                out = np.clip(np.rint(out), 0, 255).astype(np.uint8)
                meta = {**meta, "mask": spec.get("region", "subject"),
                        "maskCoverage": round(float(m.mean()), 4)}
            rgb = out
            steps.append(
                {"tool": t["toolId"], "ms": int((time.time() - t0) * 1000), "meta": meta}
            )
        return common.to_pil(rgb), {"steps": steps}
    finally:
        masks.clear_source()
        common.clear_source_scale()


def detect_cleanup(img, params, recipe_tools=(), source_scale: float = 1.0, key=None):
    """What `skin-cleanup` would find in this frame, outlined — for the lab.

    The frame it measures is the frame the tool will actually RECEIVE, not the
    file: `face-retouch` runs at order 8 and `skin-cleanup` at 10, so with both
    enabled the outlines have to be measured on the retouched frame or they
    describe a picture that no longer exists by the time the healer runs.

    Masks still come from the pristine original, exactly as in `render` — the
    tool being marked and the tool being applied must agree about where the face
    is, and that is the whole reason `set_source` exists.
    """
    order = TOOLS["skin-cleanup"][1]
    prefix = [
        t
        for t in recipe_tools
        if t.get("enabled", True)
        and t.get("toolId") in TOOLS
        and TOOLS[t["toolId"]][1] < order
    ]
    frame = (common.to_np(render(img, prefix, source_scale, key=key)[0]) if prefix
             else common.to_np(img))

    masks.set_source(common.to_np(img), key)
    # Marking and applying must agree about which candidates EXIST, and the size
    # gates decide that. A detect pass that forgot the scale would offer the
    # photographer a different set of outlines than the render would treat.
    common.set_source_scale(source_scale)
    try:
        return cleanup.detect(frame, params)
    finally:
        masks.clear_source()
        common.clear_source_scale()


# Delivery quality is not a place to save bytes. Measured on a 20MP camera
# file: q94 = 47.5 dB PSNR (visible loss), q97 = 51.3 dB, q100 = 56.1 dB.
# 97 with NO chroma subsampling is the professional default; photographers who
# want a master file choose tiff/png and get it lossless.
DEFAULT_QUALITY = 97


def export(
    src_path: str,
    recipe_tools,
    dest_dir: str,
    fmt: str = "jpeg",
    quality: int = DEFAULT_QUALITY,
):
    """Render one file from disk and write the result. -> (path, meta)."""
    img = common.load_image(src_path)
    out, meta = render(img, recipe_tools)

    os.makedirs(dest_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(src_path))[0]
    f = fmt.lower()
    ext = {"jpg": "jpg", "jpeg": "jpg", "png": "png", "tif": "tif", "tiff": "tif"}.get(
        f, "jpg"
    )
    dest = os.path.join(dest_dir, f"{stem}.{ext}")

    if ext == "jpg":
        out.save(
            dest,
            format="JPEG",
            quality=int(quality),
            subsampling=0,  # 4:4:4 — never throw away colour resolution
            optimize=True,
            progressive=True,
            icc_profile=img.info.get("icc_profile"),
        )
    elif ext == "png":
        out.save(dest, format="PNG", compress_level=6)
    else:  # tiff — lossless master
        out.save(dest, format="TIFF", compression="tiff_lzw")

    meta["output"] = dest
    return dest, meta
