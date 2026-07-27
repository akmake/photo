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

    def test_material_serialization_round_trip(self):
        model = {
            "version": 1,
            "base": {"temperature": 0.0, "exposure": 0.0},
            "anchors": np.zeros((2, 3), np.float32),
            "deltas": np.ones((2, 3), np.float32),
            "confidences": np.ones(2, np.float32),
            "supports": np.array([100, 200], np.int32),
            "strength": 1.0,
            "sigma": 8.0,
            "subjectProtection": 0.92,
            "lumaCurve": np.arange(256, dtype=np.float32),
            "lumaStrength": 1.0,
            "materialAnchors": np.zeros((3, 3), np.float32),
            "materialDeltas": np.ones((3, 3), np.float32),
            "materialConfidences": np.ones(3, np.float32),
            "materialSupports": np.array([700, 900, 1200], np.int32),
            "materialTextures": np.array([12.0, 40.0, 5.0], np.float32),
            "materialStrengths": np.array([1.0, 1.2, 0.8], np.float32),
            "materialStrength": 1.0,
            "materialProtection": 0.35,
        }
        restored = pixel_color.deserialize(pixel_color.serialize(model))
        np.testing.assert_allclose(restored["materialAnchors"], model["materialAnchors"])
        np.testing.assert_allclose(restored["materialDeltas"], model["materialDeltas"])
        self.assertEqual(restored["materialSupports"].dtype, np.int32)

    def test_material_zero_protection_is_a_noop(self):
        """MATERIAL_PROTECTION == 0 (or an all-zero confidence map) must
        reproduce the pre-material-model blend bit-for-bit -- material only
        ever ADDS correction on top of the existing full/skin/protected
        result, the same guarantee already established for the skin model
        (docs/opo.md section 12) after the blend-formula bug it once caught.
        """
        rng = np.random.default_rng(3)
        shape = (10, 10, 3)
        full = rng.integers(0, 255, size=shape, dtype=np.uint8)
        protected = rng.integers(0, 255, size=shape, dtype=np.uint8)
        skin_out = rng.integers(0, 255, size=shape, dtype=np.uint8)
        material = rng.integers(0, 255, size=shape, dtype=np.uint8)
        subject = rng.random((10, 10)).astype(np.float32)
        skin = rng.random((10, 10)).astype(np.float32)
        confidence = rng.random((10, 10)).astype(np.float32)

        baseline = pixel_color._blend_protected(
            full, protected, subject, 0.92, skin, skin_out, 0.35,
        )
        with_material_at_zero = pixel_color._blend_protected(
            full, protected, subject, 0.92, skin, skin_out, 0.35,
            material, confidence, 0.0,
        )
        np.testing.assert_array_equal(baseline, with_material_at_zero)

    def test_local_slope_disabled_is_a_noop(self):
        """LOCAL_SLOPE_ENABLED == False (the default) must reproduce
        constant-per-anchor delta blending bit-for-bit, even when a model
        happens to carry a "slopes" array -- e.g. a model fit while the flag
        was on, later applied while it is off. Slope only ever ADDS a
        colour-conditioned adjustment on top of the existing constant delta,
        never replaces the blend mechanism itself.
        """
        rng = np.random.default_rng(11)
        lab_values = rng.uniform(20, 235, size=(50, 3)).astype(np.float32)
        model = {
            "anchors": rng.uniform(-60, 60, size=(4, 3)).astype(np.float32),
            "deltas": rng.uniform(-20, 20, size=(4, 3)).astype(np.float32),
            "confidences": rng.uniform(0.2, 1.0, size=4).astype(np.float32),
        }
        strengths = np.full(4, 1.2, np.float32)
        baseline = pixel_color._palette_delta(lab_values, model, strengths, 8.0)

        model_with_slopes = dict(model)
        model_with_slopes["slopes"] = rng.uniform(-1, 1, size=(4, 3, 3)).astype(np.float32)
        pixel_color.LOCAL_SLOPE_ENABLED = False
        disabled = pixel_color._palette_delta(lab_values, model_with_slopes, strengths, 8.0)
        np.testing.assert_array_equal(baseline, disabled)

        pixel_color.LOCAL_SLOPE_ENABLED = True
        try:
            enabled = pixel_color._palette_delta(lab_values, model_with_slopes, strengths, 8.0)
            self.assertFalse(np.array_equal(baseline, enabled))
        finally:
            pixel_color.LOCAL_SLOPE_ENABLED = False

    def test_protected_mode_without_subject_base_uses_shared_base(self):
        """A model with no "subjectBase" key (every model fit before
        SUBJECT_BASE_ENABLED existed, and every model fit with it off) must
        keep using the shared `base` for the "protected" path -- exactly
        today's behaviour. Only a model that actually carries a fitted
        subjectBase should diverge.
        """
        rng = np.random.default_rng(13)
        grid = rng.integers(0, 255, size=(6, 6, 3), dtype=np.uint8)
        base_model = {
            "base": {"temperature": 15.0, "exposure": -6.0},
            "anchors": np.zeros((1, 3), np.float32),
            "deltas": np.zeros((1, 3), np.float32),
            "confidences": np.ones(1, np.float32),
            "strength": 1.0,
            "sigma": 8.0,
            "lumaCurve": np.arange(256, dtype=np.float32),
            "lumaStrength": 0.0,
        }
        full_path = pixel_color._apply_model_samples(grid, base_model, mode="full")
        protected_no_subject_base = pixel_color._apply_model_samples(
            grid, base_model, mode="protected",
        )
        np.testing.assert_array_equal(full_path, protected_no_subject_base)

        with_subject_base = dict(base_model)
        with_subject_base["subjectBase"] = {"temperature": -40.0, "exposure": 20.0}
        protected_with_subject_base = pixel_color._apply_model_samples(
            grid, with_subject_base, mode="protected",
        )
        self.assertFalse(
            np.array_equal(protected_no_subject_base, protected_with_subject_base)
        )


if __name__ == "__main__":
    unittest.main()
