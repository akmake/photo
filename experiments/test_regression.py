"""Regression gate: today's production scores must not silently drop below
the last known-good snapshot (experiments/golden_scores.json).

Runs fit() with the TRUE current module defaults (no experiments/holdout.py
patching) on the same 4 real datasets, and compares against the snapshot.
As more layers accumulate here (skin, material, subjectBase, whatever comes
next) the chance of an unnoticed regression only grows -- this is the
difference between "someone remembers to run holdout.py by hand" and
"nothing ships without it".

    python -m unittest experiments.test_regression

Re-run experiments/build_golden.py to update the snapshot deliberately when
a change is MEANT to move the numbers -- never to silence a failure you
have not understood.
"""

import json
import math
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT))

from experiments import holdout  # noqa: E402

pixel_color = holdout.pixel_color
GOLDEN_PATH = Path(__file__).resolve().parent / "golden_scores.json"
# Percentage points of "closed" allowed below the snapshot before this
# counts as a real regression rather than measurement noise.
TOLERANCE = 0.015


class RegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not GOLDEN_PATH.exists():
            raise unittest.SkipTest(
                f"{GOLDEN_PATH} missing -- run `python experiments/build_golden.py` once first"
            )
        cls.golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))

    def test_no_regression_on_any_dataset(self):
        names = ("overall", "vivid", "skin", "material", "subject")
        failures = []

        for label, raw_dir, graded_dir, teach_raw, teach_graded in holdout.DATASETS:
            if label not in self.golden or not raw_dir.exists() or not graded_dir.exists():
                continue
            teach, holdout_pairs_raw = holdout.discover(raw_dir, graded_dir, teach_raw, teach_graded)
            if teach is None:
                continue

            teach_pair = holdout.Pair(*teach)
            holdout_pairs = [holdout.Pair(r, g) for r, g in holdout_pairs_raw]
            model, report, _ = pixel_color.fit(teach_pair.before, teach_pair.target)
            model = pixel_color.deserialize(model)

            current = {"teach": dict(zip(names, teach_pair.score(model)))}
            if holdout_pairs:
                scores = [p.score(model) for p in holdout_pairs]
                current["holdout"] = {
                    name: float(np.nanmean([s[i] for s in scores]))
                    for i, name in enumerate(names)
                }

            for split, golden_split in self.golden[label].items():
                current_split = current.get(split, {})
                for metric, golden_value in golden_split.items():
                    if metric not in current_split or math.isnan(golden_value):
                        continue
                    current_value = current_split[metric]
                    if math.isnan(current_value):
                        failures.append(
                            f"{label}/{split}/{metric}: was {golden_value:.1%}, now n/a (nan)"
                        )
                    elif current_value < golden_value - TOLERANCE:
                        failures.append(
                            f"{label}/{split}/{metric}: {golden_value:.1%} -> {current_value:.1%} "
                            f"(dropped {golden_value - current_value:.1%})"
                        )

        self.assertEqual(
            failures, [],
            "Regression vs experiments/golden_scores.json:\n" + "\n".join(failures),
        )


if __name__ == "__main__":
    unittest.main()
