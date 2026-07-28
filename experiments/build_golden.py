"""Snapshot today's production scores (true module defaults, no patching)
across the 4 real datasets, so test_regression.py has something to compare
against. Re-run this deliberately when a change is meant to move the
numbers -- never to silence a failing regression test.

    python experiments/build_golden.py
"""

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT))

from experiments import holdout  # noqa: E402

# Use holdout's own pixel_color reference (engine.pixel_color), not a
# separate `import pixel_color` -- two different module objects for the
# same file caused a real bug tonight (setting a flag on one silently did
# nothing to the other).
pixel_color = holdout.pixel_color

GOLDEN_PATH = Path(__file__).resolve().parent / "golden_scores.json"


def main():
    golden = {}
    for label, raw_dir, graded_dir, teach_raw, teach_graded in holdout.DATASETS:
        if not raw_dir.exists() or not graded_dir.exists():
            print(f"[{label}] missing folders, skipped")
            continue
        teach, holdout_pairs_raw = holdout.discover(raw_dir, graded_dir, teach_raw, teach_graded)
        if teach is None:
            print(f"[{label}] no matching pairs, skipped")
            continue

        teach_pair = holdout.Pair(*teach)
        holdout_pairs = [holdout.Pair(r, g) for r, g in holdout_pairs_raw]

        # True current defaults -- deliberately NOT routed through
        # holdout.apply_config, whose own fallback defaults (e.g.
        # MAX_ANCHOR_DELTA=46.0) are historical baselines for comparison,
        # not what fit() actually does today with zero patching.
        model, report, _ = pixel_color.fit(teach_pair.before, teach_pair.target)
        model = pixel_color.deserialize(model)
        names = ("overall", "vivid", "skin", "material", "subject")
        teach_scores = dict(zip(names, teach_pair.score(model)))

        entry = {"teach": teach_scores}
        if holdout_pairs:
            scores = [p.score(model) for p in holdout_pairs]
            entry["holdout"] = {
                name: float(np.nanmean([s[i] for s in scores]))
                for i, name in enumerate(names)
            }
        golden[label] = entry
        print(f"[{label}] teach={teach_scores} holdout={entry.get('holdout')}")

    GOLDEN_PATH.write_text(json.dumps(golden, indent=2, allow_nan=True), encoding="utf-8")
    print(f"\nwrote {GOLDEN_PATH}")


if __name__ == "__main__":
    main()
