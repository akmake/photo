import unittest
from unittest.mock import patch

import cv2
import numpy as np

import globals_py
import pixel_color


class PixelColorTests(unittest.TestCase):
    def test_model_serialization_round_trip(self):
        model = {
            "version": 1,
            "base": {"temperature": -20.0, "exposure": 2.5},
            "anchors": np.zeros((2, 3), np.float32),
            "deltas": np.ones((2, 3), np.float32),
            "confidences": np.ones(2, np.float32),
            "supports": np.array([100, 200], np.int32),
            "strength": 1.2,
            "sigma": 8.0,
            "subjectProtection": 0.92,
            "lumaCurve": np.arange(256, dtype=np.float32),
            "lumaStrength": 1.0,
        }
        restored = pixel_color.deserialize(pixel_color.serialize(model))
        np.testing.assert_allclose(restored["anchors"], model["anchors"])
        np.testing.assert_allclose(restored["lumaCurve"], model["lumaCurve"])
        self.assertEqual(restored["supports"].dtype, np.int32)

    def test_fit_recovers_a_synthetic_colour_law(self):
        rng = np.random.default_rng(7)
        before = rng.integers(20, 235, size=(120, 180, 3), dtype=np.uint8)
        before = cv2.GaussianBlur(before, (0, 0), 1.0)

        after, _ = globals_py.tone_color(
            before,
            {"temperature": -30.0, "exposure": 5.0},
        )
        lab = cv2.cvtColor(after, cv2.COLOR_RGB2LAB).astype(np.float32)
        chroma = np.hypot(lab[..., 1] - 128.0, lab[..., 2] - 128.0)
        amount = np.clip((chroma - 5.0) / 15.0, 0.0, 1.0)
        lab[..., 0] += 5.0 * amount
        lab[..., 1] -= 12.0 * amount
        lab[..., 2] += 8.0 * amount
        after = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)

        no_subject = np.zeros(before.shape[:2], np.float32)
        with patch.object(pixel_color, "_subject_mask", return_value=no_subject):
            model, report, preview = pixel_color.fit(before, after)

        self.assertEqual(preview.shape, before.shape)
        self.assertTrue(report["safe"])
        self.assertGreater(report["gapClosed"], 0.25)
        self.assertGreater(report["validationGapClosed"], 0.2)
        self.assertGreater(len(model["anchors"]), 0)


if __name__ == "__main__":
    unittest.main()
