"""Does an engine change generalise, or does it just flatter the set it was tuned on?

Teach the colour model on ONE pair, then score it on pairs it never saw.
Every candidate change is run against every dataset, so a change that only
helps the set it was invented on is visible immediately.

Scoring ignores pixels where the two frames are not the same scene (retouchers
remove people, and warping a crop back to the source frame smears the border),
and reports against a per-pair oracle: the best possible per-pixel map, fitted
on that image itself. Nothing in this family can beat the oracle, so
"% of oracle" says how much of the reachable look we actually captured.

    python experiments/holdout.py
"""

import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT))

from engine import common, compare, pixel_color, regions  # noqa: E402


DOWNLOADS = Path.home() / "Downloads"
DATASETS = [
    ("33", DOWNLOADS / "33", DOWNLOADS / "33", "321A5078", "321A5078 (2)"),
    # `22_graded` is corrupted -- every file in it has posterisation/black-blotch
    # artifacts (verified against the untouched raw in `22`, which is clean),
    # almost certainly from a broken upscaler/style-transfer pass, not a human
    # retouch. The model was dutifully learning to reproduce that corruption,
    # which is what pushed strength to the rail and produced real, separate
    # visible bugs (see MAX_ANCHOR_DELTA / _palette_delta safety-cap history).
    # `321A5208 (1).JPG` / `321A5208.JPG` inside the RAW `22` folder is a real,
    # clean before/after pair (someone graded it by hand, in place) -- teach-only
    # like `33`, since no other clean graded pair exists for `22` to hold out.
    ("22", DOWNLOADS / "22", DOWNLOADS / "22", "321A5208 (1)", "321A5208"),
    ("jm", DOWNLOADS / "jm__yg0J2rjsE-dhAL", DOWNLOADS / "jm_graded", None, None),
    # Girl in a poppy field, well-aligned (inlierRatio 0.865 per the plan doc's
    # problem 3): retoucher crushed/desaturated the field but WARMED AND
    # LIFTED the subject (+22.3 L) -- opposite directions on the same photo.
    # Teach-only (single pair, no siblings), same as `33`/`22`. This is the
    # set that should show whether SUBJECT_BASE_ENABLED actually fixes a
    # directional failure (engine measured -14.9 L on the subject, i.e.
    # backwards, not just under-corrected) rather than a mere precision gap.
    ("poppy", DOWNLOADS, DOWNLOADS, "IMG_2034ב", "IMG_2034 (1) copy"),
]
MAX_HOLDOUT = 10
EVAL_MAX = 900
VIVID_CHROMA = 55.0

CONFIGS = {
    "uncapped": {"MAX_ANCHOR_DELTA": 110.0, "LEARN_ONLY_MATCHED": False},
    "uncapped+matched": {"MAX_ANCHOR_DELTA": 110.0, "LEARN_ONLY_MATCHED": True},
    "uncapped+skin": {
        "MAX_ANCHOR_DELTA": 110.0,
        "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True,
    },
    "uncapped+skin+strength": {
        "MAX_ANCHOR_DELTA": 110.0,
        "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True,
        "STRENGTH_TRUST_SCALE": 6000.0,
    },
    "uncapped+skin+strength+material": {
        "MAX_ANCHOR_DELTA": 110.0,
        "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True,
        "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True,
    },
    # LOCAL_SLOPE_ENABLED: each anchor's delta becomes deltas[i] + slope[i] @
    # (colour offset from its own centre) instead of one constant vector --
    # still LUT-compatible (colour-only), see LOCAL_SLOPE_ENABLED in
    # pixel_color.py. Targets the "43% of the flower gap closed" ceiling from
    # docs/opo.md section 13, which is a capacity limit (24 fixed anchors),
    # not an alignment or identity problem -- should show up on ALL sets,
    # including holdout, not just the set with a saturated-colour complaint.
    "uncapped+skin+strength+material+slope": {
        "MAX_ANCHOR_DELTA": 110.0,
        "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True,
        "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True,
        "LOCAL_SLOPE_ENABLED": True,
    },
    # Same as +slope, but requiring far more of an anchor's OWN evidence
    # before trusting a 9-parameter (3x3) regression on it at all -- tests
    # whether the jm-holdout skin regression (-1.8pt) was small-sample noise
    # in the slope fit itself, isolated from the calibration-inconsistency
    # bug that was also just fixed (see _calibrate_anchor_strengths).
    "uncapped+skin+strength+material+slope+minsamples200": {
        "MAX_ANCHOR_DELTA": 110.0,
        "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True,
        "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True,
        "LOCAL_SLOPE_ENABLED": True,
        "MIN_SLOPE_SAMPLES": 200,
    },
    # Plan-doc problem 3: give the subject its own base (temperature/exposure)
    # instead of sharing the whole-frame grid search. Built on top of the
    # current-best chain (not +slope) to isolate this one variable. Watch
    # the new `subject` column, especially on `poppy` -- that is the pair
    # with a documented DIRECTIONAL failure (subject moved -14.9 L when the
    # retoucher moved it +22.3 L), not just a precision gap.
    "uncapped+skin+strength+material+subjectbase": {
        "MAX_ANCHOR_DELTA": 110.0,
        "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True,
        "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True,
        "SUBJECT_BASE_ENABLED": True,
    },
    # `33` still shows a small residual regression (-2 to -3pt) even with
    # validation-shrinkage at the initial guess (scale=6.0) -- these two
    # raise the bar for how much held-out improvement earns full trust, to
    # see if that closes `33`'s gap further without costing `poppy` (whose
    # own validated improvement was large) or `22`.
    "uncapped+skin+strength+material+subjectbase+scale10": {
        "MAX_ANCHOR_DELTA": 110.0,
        "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True,
        "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True,
        "SUBJECT_BASE_ENABLED": True,
        "SUBJECT_BASE_VALIDATION_SCALE": 10.0,
    },
    "uncapped+skin+strength+material+subjectbase+scale15": {
        "MAX_ANCHOR_DELTA": 110.0,
        "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True,
        "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True,
        "SUBJECT_BASE_ENABLED": True,
        "SUBJECT_BASE_VALIDATION_SCALE": 15.0,
    },
    # User's ask: when subjectBase isn't confident, prefer leaving the
    # subject close to the ORIGINAL (identity) over giving it the same shift
    # as the background -- "no change" can never be the wrong direction,
    # unlike the whole-frame base. Built on the validated scale=15.
    "uncapped+skin+strength+material+subjectbase+scale15+identityfallback": {
        "MAX_ANCHOR_DELTA": 110.0,
        "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True,
        "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True,
        "SUBJECT_BASE_ENABLED": True,
        "SUBJECT_BASE_VALIDATION_SCALE": 15.0,
        "SUBJECT_BASE_SHRINK_TO_IDENTITY": True,
    },
    # One-at-a-time sweep of constants that were chosen once, by inspection,
    # and never swept against an alternative (see pixel_color.py's comment
    # above _FEATURE_L_WEIGHT). Each config changes exactly one value away
    # from today's production default, on top of the current-best chain, so
    # any change in score is attributable to that one constant.
    "uncapped+skin+strength+material+Lweight0.15": {
        "MAX_ANCHOR_DELTA": 110.0, "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True, "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True, "FEATURE_L_WEIGHT": 0.15,
    },
    "uncapped+skin+strength+material+chromaSpan20": {
        "MAX_ANCHOR_DELTA": 110.0, "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True, "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True, "CHROMA_GATE_SPAN": 20.0,
    },
    "uncapped+skin+strength+material+familiarity48": {
        "MAX_ANCHOR_DELTA": 110.0, "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True, "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True, "FAMILIARITY_RADIUS": 48.0,
    },
    "uncapped+skin+strength+material+confSupport4000": {
        "MAX_ANCHOR_DELTA": 110.0, "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True, "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True, "CONFIDENCE_SUPPORT_SCALE": 4000.0,
    },
    # chroma95 safety margin -- docs/opo.md section 13 flagged this ceiling
    # as "still there, never revisited" after finding it was NOT the active
    # constraint in the one case checked. Testing whether relaxing it lets
    # demanding regions (saturated flowers/foliage) close more of their
    # colour gap without letting anything run away unsafe.
    "uncapped+skin+strength+material+chroma95margin12": {
        "MAX_ANCHOR_DELTA": 110.0, "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True, "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True, "CHROMA95_MARGIN": 12.0,
    },
    "uncapped+skin+strength+material+chroma95margin20": {
        "MAX_ANCHOR_DELTA": 110.0, "LEARN_ONLY_MATCHED": False,
        "SKIN_MODEL_ENABLED": True, "STRENGTH_TRUST_SCALE": 6000.0,
        "MATERIAL_MODEL_ENABLED": True, "CHROMA95_MARGIN": 20.0,
    },
}


def _stems(directory):
    return {
        path.stem: path
        for path in sorted(directory.iterdir())
        if path.suffix.lower() in (".jpg", ".jpeg", ".png", ".tif", ".tiff")
    }


def discover(raw_dir, graded_dir, teach_raw, teach_graded):
    raws, grades = _stems(raw_dir), _stems(graded_dir)
    if teach_raw is not None:
        return (raws[teach_raw], grades[teach_graded]), []
    shared = sorted(set(raws) & set(grades))
    if not shared:
        return None, []
    teach = shared[0]
    holdout = [(raws[s], grades[s]) for s in shared[1:][:MAX_HOLDOUT]]
    return (raws[teach], grades[teach]), holdout


def load(path):
    return pixel_color._resize(common.to_np(common.load_image(str(path))), EVAL_MAX)


def changed_mask(before, after):
    """True where the two frames no longer show the same scene."""

    def grad(rgb):
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
        return np.hypot(
            cv2.Sobel(gray, cv2.CV_32F, 1, 0, 3),
            cv2.Sobel(gray, cv2.CV_32F, 0, 1, 3),
        )

    gb, ga = grad(before), grad(after)
    k = (31, 31)
    mb, ma = cv2.blur(gb, k), cv2.blur(ga, k)
    sb = np.sqrt(np.maximum(cv2.blur(gb * gb, k) - mb * mb, 1e-6))
    sa = np.sqrt(np.maximum(cv2.blur(ga * ga, k) - ma * ma, 1e-6))
    ncc = (cv2.blur(gb * ga, k) - mb * ma) / (sb * sa)
    return cv2.blur((ncc < 0.25).astype(np.float32), (41, 41)) > 0.20


def clean_region(before, after):
    height, width = before.shape[:2]
    margin = round(min(height, width) * 0.14)
    frame = np.zeros((height, width), bool)
    frame[margin:height - margin, margin:width - margin] = True
    return frame & ~changed_mask(before, after)


def oracle(before, target, clean, size=33):
    """Best possible per-pixel map, fitted on this very image. An upper bound."""
    index = np.clip(
        np.floor(before.astype(np.float32) / 255.0 * (size - 1)).astype(np.int32),
        0,
        size - 1,
    )
    flat = ((index[..., 0] * size + index[..., 1]) * size + index[..., 2]).reshape(-1)
    keep = clean.reshape(-1)
    flat, values = flat[keep], target.reshape(-1, 3)[keep].astype(np.float64)

    cells = size ** 3
    count = np.bincount(flat, minlength=cells).astype(np.float64)
    total = np.stack(
        [np.bincount(flat, weights=values[:, c], minlength=cells) for c in range(3)],
        axis=1,
    )
    levels = np.linspace(0, 255, size)
    red, green, blue = np.meshgrid(levels, levels, levels, indexing="ij")
    identity = np.stack((red, green, blue), -1).reshape(-1, 3)

    seen = count > 8
    cube = identity.copy()
    cube[seen] = total[seen] / count[seen, None]
    cube = cube.reshape(size, size, size, 3)

    weight = seen.astype(np.float64).reshape(size, size, size)
    num, den = cube * weight[..., None], weight.copy()
    for axis in range(3):
        num = num + 0.5 * (np.roll(num, 1, axis) + np.roll(num, -1, axis))
        den = den + 0.5 * (np.roll(den, 1, axis) + np.roll(den, -1, axis))
    spread = np.where(
        den[..., None] > 1e-9,
        num / np.maximum(den[..., None], 1e-9),
        identity.reshape(size, size, size, 3),
    )
    cube = np.where(weight[..., None] > 0, cube, spread)
    return pixel_color._apply_cube(before, np.clip(cube, 0, 255).astype(np.uint8))


def render(rgb, model, subject, skin):
    """pixel_color.apply()'s exact blend, with masks supplied (config-independent)."""
    compiled = pixel_color._compile_processors(model)
    has_skin = len(compiled) > 2
    has_material = "materialAnchors" in model
    full = pixel_color._apply_compiled(rgb, compiled[0])
    protection = float(model.get("subjectProtection", pixel_color.SUBJECT_PROTECTION))
    material_protection = (
        float(model.get("materialProtection", pixel_color.MATERIAL_PROTECTION))
        if has_material else 0.0
    )
    if protection <= 0 and not has_skin and material_protection <= 0:
        return full
    protected = pixel_color._apply_compiled(rgb, compiled[1])
    skin_out = pixel_color._apply_compiled(rgb, compiled[2]) if has_skin else None
    skin_protection = (
        float(model.get("skinProtection", pixel_color.SKIN_PROTECTION)) if has_skin else 0.0
    )
    material_out, material_confidence = (
        pixel_color._apply_material(full, rgb, model, subject)
        if has_material and material_protection > 0
        else (None, None)
    )
    return pixel_color._blend_protected(
        full, protected, subject, protection,
        skin if has_skin else None, skin_out, skin_protection,
        material_out, material_confidence, material_protection,
    )


def closed(before_lab, result_lab, target_lab, selection):
    gap = float(np.linalg.norm(before_lab[selection] - target_lab[selection], axis=1).mean())
    left = float(np.linalg.norm(result_lab[selection] - target_lab[selection], axis=1).mean())
    return 1.0 - left / max(gap, 1e-6)


class Pair:
    """One raw/graded pair, with everything config-independent computed once."""

    def __init__(self, raw_path, graded_path):
        self.name = raw_path.stem
        self.before = load(raw_path)
        self.target, self.geometry = compare.align(self.before, load(graded_path))
        self.clean = clean_region(self.before, self.target)
        self.subject = pixel_color._fast_subject_mask(self.before)
        self.skin = pixel_color._fast_skin_mask(self.before)
        self.before_lab = pixel_color._lab(self.before)
        self.target_lab = pixel_color._lab(self.target)

        chroma = np.hypot(
            self.before_lab[..., 1] - 128.0, self.before_lab[..., 2] - 128.0
        )
        self.vivid = self.clean & (chroma > VIVID_CHROMA)
        self.skin_region = self.clean & (self.skin > 0.5)
        # Distinct from skin_region: ALL subject pixels (clothes, hair,
        # background-of-a-person -- whatever masks.py's "subject" covers),
        # not just skin. Needed to see whether SUBJECT_BASE_ENABLED actually
        # moves the needle -- "overall" on a wide landscape-with-a-person
        # shot is background-dominated and would hide a subject-only fix.
        self.subject_region = self.clean & (self.subject > 0.5)

        # Model-independent proxy for "pixels a material anchor could plausibly
        # cover": any class-agnostic region big enough to have qualified during
        # fit (MIN_MATERIAL_REGION_PX), outside skin. Doesn't require a specific
        # fitted model, so it's comparable the same way `vivid`/`skin_region` are
        # -- defined once from the photo, not from any one config's anchors.
        labels, region_stats = regions.get_regions(self.before)
        material_mask = np.zeros(self.before.shape[:2], bool)
        for stat in region_stats:
            if stat["area"] >= pixel_color.MIN_MATERIAL_REGION_PX:
                material_mask |= labels == stat["id"]
        self.material_region = self.clean & material_mask & (self.skin < 0.5)

        oracle_lab = pixel_color._lab(oracle(self.before, self.target, self.clean))
        self.ceiling = closed(self.before_lab, oracle_lab, self.target_lab, self.clean)
        self.skin_ceiling = (
            closed(self.before_lab, oracle_lab, self.target_lab, self.skin_region)
            if self.skin_region.sum() > 300
            else float("nan")
        )
        self.material_ceiling = (
            closed(self.before_lab, oracle_lab, self.target_lab, self.material_region)
            if self.material_region.sum() > 300
            else float("nan")
        )
        self.subject_ceiling = (
            closed(self.before_lab, oracle_lab, self.target_lab, self.subject_region)
            if self.subject_region.sum() > 300
            else float("nan")
        )

    def score(self, model):
        result = render(self.before, model, self.subject, self.skin)
        result_lab = pixel_color._lab(result)
        vivid = (
            closed(self.before_lab, result_lab, self.target_lab, self.vivid)
            if self.vivid.sum() > 500
            else float("nan")
        )
        skin = (
            closed(self.before_lab, result_lab, self.target_lab, self.skin_region)
            if self.skin_region.sum() > 300
            else float("nan")
        )
        material = (
            closed(self.before_lab, result_lab, self.target_lab, self.material_region)
            if self.material_region.sum() > 300
            else float("nan")
        )
        subject = (
            closed(self.before_lab, result_lab, self.target_lab, self.subject_region)
            if self.subject_region.sum() > 300
            else float("nan")
        )
        return (
            closed(self.before_lab, result_lab, self.target_lab, self.clean),
            vivid,
            skin,
            material,
            subject,
        )


def apply_config(config):
    pixel_color.MAX_ANCHOR_DELTA = config.get("MAX_ANCHOR_DELTA", 46.0)
    pixel_color.LEARN_ONLY_MATCHED = config.get("LEARN_ONLY_MATCHED", True)
    pixel_color._SUPPORT_FLOOR = config.get("SUPPORT_FLOOR", 0.2)
    pixel_color.SKIN_MODEL_ENABLED = config.get("SKIN_MODEL_ENABLED", False)
    pixel_color.MIN_SKIN_SAMPLES = config.get("MIN_SKIN_SAMPLES", 1500)
    pixel_color.SKIN_PROTECTION = config.get("SKIN_PROTECTION", 0.35)
    pixel_color._STRENGTH_TRUST_SCALE = config.get("STRENGTH_TRUST_SCALE", 1e12)
    pixel_color.MATERIAL_MODEL_ENABLED = config.get("MATERIAL_MODEL_ENABLED", False)
    pixel_color.MIN_MATERIAL_REGION_PX = config.get("MIN_MATERIAL_REGION_PX", 600)
    pixel_color.MATERIAL_PROTECTION = config.get("MATERIAL_PROTECTION", 0.35)
    pixel_color.LOCAL_SLOPE_ENABLED = config.get("LOCAL_SLOPE_ENABLED", False)
    pixel_color._MIN_SLOPE_SAMPLES = config.get("MIN_SLOPE_SAMPLES", 40)
    pixel_color._SLOPE_TRUST_SCALE = config.get("SLOPE_TRUST_SCALE", 6000.0)
    pixel_color.SUBJECT_BASE_ENABLED = config.get("SUBJECT_BASE_ENABLED", False)
    pixel_color._SUBJECT_BASE_VALIDATION_SCALE = config.get("SUBJECT_BASE_VALIDATION_SCALE", 6.0)
    pixel_color.SUBJECT_BASE_SHRINK_TO_IDENTITY = config.get(
        "SUBJECT_BASE_SHRINK_TO_IDENTITY", False
    )
    # The five "never swept" decision constants from pixel_color.py -- see
    # their docstring there. Defaults here match the values already live in
    # production, so a config that omits them measures exactly today's
    # behaviour.
    pixel_color._FEATURE_L_WEIGHT = config.get("FEATURE_L_WEIGHT", 0.28)
    pixel_color._CONFIDENCE_SPREAD_SCALE = config.get("CONFIDENCE_SPREAD_SCALE", 28.0)
    pixel_color._CONFIDENCE_SUPPORT_SCALE = config.get("CONFIDENCE_SUPPORT_SCALE", 2200.0)
    pixel_color._CHROMA_GATE_FLOOR = config.get("CHROMA_GATE_FLOOR", 5.0)
    pixel_color._CHROMA_GATE_SPAN = config.get("CHROMA_GATE_SPAN", 13.0)
    pixel_color._FAMILIARITY_RADIUS = config.get("FAMILIARITY_RADIUS", 34.0)
    pixel_color._CHROMA95_MARGIN = config.get("CHROMA95_MARGIN", 5.0)
    pixel_color._CUBE_CACHE.clear()


def main():
    # Route the rare-colour penalty through a patchable floor.
    original = pixel_color._fit_anchors

    def patched(source_lab, target_lab, valid):
        model, positions, count = original(source_lab, target_lab, valid)
        floor = getattr(pixel_color, "_SUPPORT_FLOOR", 0.2)
        if floor > 0.2:
            support = model["supports"].astype(np.float32)
            was = np.clip(support / 2200.0, 0.2, 1.0)
            now = np.clip(support / 2200.0, floor, 1.0)
            model["confidences"] = (model["confidences"] / np.maximum(was, 1e-6) * now).astype(np.float32)
        return model, positions, count

    pixel_color._fit_anchors = patched

    for label, raw_dir, graded_dir, teach_raw, teach_graded in DATASETS:
        if not raw_dir.exists() or not graded_dir.exists():
            print(f"\n[{label}] missing folders, skipped")
            continue
        teach, holdout = discover(raw_dir, graded_dir, teach_raw, teach_graded)
        if teach is None:
            print(f"\n[{label}] no matching pairs, skipped")
            continue

        started = time.time()
        teach_pair = Pair(*teach)
        holdout_pairs = [Pair(r, g) for r, g in holdout]
        print(f"\n=== {label} — teach on {teach_pair.name}, "
              f"holdout {[p.name for p in holdout_pairs] or 'none (single graded frame)'} "
              f"({time.time()-started:.0f}s to prepare) ===")
        skin_ceil = np.nanmean([teach_pair.skin_ceiling] + [p.skin_ceiling for p in holdout_pairs])
        material_ceil = np.nanmean(
            [teach_pair.material_ceiling] + [p.material_ceiling for p in holdout_pairs]
        )
        subject_ceil = np.nanmean(
            [teach_pair.subject_ceiling] + [p.subject_ceiling for p in holdout_pairs]
        )
        print(f"    oracle ceiling: teach {teach_pair.ceiling:.1%}" + (
            f", holdout {np.nanmean([p.ceiling for p in holdout_pairs]):.1%}"
            if holdout_pairs else "") + (
            f", skin {skin_ceil:.1%}" if not np.isnan(skin_ceil) else ", skin n/a") + (
            f", material {material_ceil:.1%}" if not np.isnan(material_ceil) else ", material n/a") + (
            f", subject {subject_ceil:.1%}" if not np.isnan(subject_ceil) else ", subject n/a"))
        print(f"    {'config':46} {'teach':>7} {'vivid':>7} {'skin':>7} {'material':>8} {'subject':>8} | "
              f"{'HOLDOUT':>8} {'vivid':>7} {'skin':>7} {'material':>8} {'subject':>8} {'of oracle':>10}")

        for name, config in CONFIGS.items():
            apply_config(config)
            before = teach_pair.before
            model, report, _ = pixel_color.fit(before, teach_pair.target)
            model = pixel_color.deserialize(model)
            t_all, t_vivid, t_skin, t_material, t_subject = teach_pair.score(model)
            skin_flag = "skin*" if report.get("skinModel") else ""
            material_flag = "material*" if report.get("materialModel") else ""
            subject_flag = "subjectBase*" if report.get("subjectBaseModel") else ""
            if holdout_pairs:
                scores = [p.score(model) for p in holdout_pairs]
                h_all = float(np.nanmean([s[0] for s in scores]))
                h_vivid = float(np.nanmean([s[1] for s in scores]))
                h_skin = float(np.nanmean([s[2] for s in scores]))
                h_material = float(np.nanmean([s[3] for s in scores]))
                h_subject = float(np.nanmean([s[4] for s in scores]))
                ratio = h_all / max(np.nanmean([p.ceiling for p in holdout_pairs]), 1e-6)
                tail = (
                    f"| {h_all:8.1%} {h_vivid:7.1%} {h_skin:7.1%} {h_material:8.1%} "
                    f"{h_subject:8.1%} {ratio:10.1%}"
                )
            else:
                tail = "|      n/a"
            print(f"    {name:46} {t_all:7.1%} {t_vivid:7.1%} {t_skin:7.1%} {t_material:8.1%} "
                  f"{t_subject:8.1%} {tail}"
                  f"   (strength {report['selectedStrength']}, sigma {report['selectedSigma']})"
                  f" {skin_flag} {material_flag} {subject_flag}")

    pixel_color._fit_anchors = original


if __name__ == "__main__":
    main()
