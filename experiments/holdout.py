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

from engine import common, compare, pixel_color  # noqa: E402


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
    full = pixel_color._apply_compiled(rgb, compiled[0])
    protection = float(model.get("subjectProtection", pixel_color.SUBJECT_PROTECTION))
    if protection <= 0 and not has_skin:
        return full
    protected = pixel_color._apply_compiled(rgb, compiled[1])
    skin_out = pixel_color._apply_compiled(rgb, compiled[2]) if has_skin else None
    skin_protection = (
        float(model.get("skinProtection", pixel_color.SKIN_PROTECTION)) if has_skin else 0.0
    )
    return pixel_color._blend_protected(
        full, protected, subject, protection,
        skin if has_skin else None, skin_out, skin_protection,
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
        oracle_lab = pixel_color._lab(oracle(self.before, self.target, self.clean))
        self.ceiling = closed(self.before_lab, oracle_lab, self.target_lab, self.clean)
        self.skin_ceiling = (
            closed(self.before_lab, oracle_lab, self.target_lab, self.skin_region)
            if self.skin_region.sum() > 300
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
        return closed(self.before_lab, result_lab, self.target_lab, self.clean), vivid, skin


def apply_config(config):
    pixel_color.MAX_ANCHOR_DELTA = config.get("MAX_ANCHOR_DELTA", 46.0)
    pixel_color.LEARN_ONLY_MATCHED = config.get("LEARN_ONLY_MATCHED", True)
    pixel_color._SUPPORT_FLOOR = config.get("SUPPORT_FLOOR", 0.2)
    pixel_color.SKIN_MODEL_ENABLED = config.get("SKIN_MODEL_ENABLED", False)
    pixel_color.MIN_SKIN_SAMPLES = config.get("MIN_SKIN_SAMPLES", 1500)
    pixel_color.SKIN_PROTECTION = config.get("SKIN_PROTECTION", 0.35)
    pixel_color._STRENGTH_TRUST_SCALE = config.get("STRENGTH_TRUST_SCALE", 1e12)
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
        print(f"    oracle ceiling: teach {teach_pair.ceiling:.1%}" + (
            f", holdout {np.nanmean([p.ceiling for p in holdout_pairs]):.1%}"
            if holdout_pairs else "") + (
            f", skin {skin_ceil:.1%}" if not np.isnan(skin_ceil) else ", skin n/a"))
        print(f"    {'config':16} {'teach':>7} {'vivid':>7} {'skin':>7} | "
              f"{'HOLDOUT':>8} {'vivid':>7} {'skin':>7} {'of oracle':>10}")

        for name, config in CONFIGS.items():
            apply_config(config)
            before = teach_pair.before
            model, report, _ = pixel_color.fit(before, teach_pair.target)
            model = pixel_color.deserialize(model)
            t_all, t_vivid, t_skin = teach_pair.score(model)
            skin_flag = "skin*" if report.get("skinModel") else ""
            if holdout_pairs:
                scores = [p.score(model) for p in holdout_pairs]
                h_all = float(np.nanmean([s[0] for s in scores]))
                h_vivid = float(np.nanmean([s[1] for s in scores]))
                h_skin = float(np.nanmean([s[2] for s in scores]))
                ratio = h_all / max(np.nanmean([p.ceiling for p in holdout_pairs]), 1e-6)
                tail = f"| {h_all:8.1%} {h_vivid:7.1%} {h_skin:7.1%} {ratio:10.1%}"
            else:
                tail = "|      n/a"
            print(f"    {name:16} {t_all:7.1%} {t_vivid:7.1%} {t_skin:7.1%} {tail}"
                  f"   (strength {report['selectedStrength']}, sigma {report['selectedSigma']}) {skin_flag}")

    pixel_color._fit_anchors = original


if __name__ == "__main__":
    main()
