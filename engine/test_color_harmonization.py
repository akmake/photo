"""Deterministic tests for direct local skin-colour correspondence."""

from __future__ import annotations

import unittest

import cv2
import numpy as np

import color_harmonization as harmony


def _rgb_from_lab(lab: np.ndarray) -> np.ndarray:
    rgb = cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_LAB2RGB)
    return np.clip(np.rint(rgb * 255.0), 0, 255).astype(np.uint8)


def _lab(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)


class DirectColourMatchTests(unittest.TestCase):
    def setUp(self):
        height, width = 96, 128
        yy, xx = np.mgrid[:height, :width].astype(np.float32)
        self.clean_lab = np.empty((height, width, 3), np.float32)
        self.clean_lab[..., 0] = 61.0 + xx * 0.055 + yy * 0.025
        self.clean_lab[..., 1] = 12.0 + yy * 0.012
        self.clean_lab[..., 2] = 18.0 - xx * 0.010
        self.clean = _rgb_from_lab(self.clean_lab)

        self.core = np.zeros((height, width), np.uint8)
        cv2.ellipse(self.core, (65, 48), (11, 7), 18, 0, 360, 1, -1)
        halo_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
        self.halo = cv2.dilate(self.core, halo_kernel)

        original_lab = self.clean_lab.copy()
        contaminated = self.halo > 0
        original_lab[contaminated, 0] -= 3.8
        original_lab[contaminated, 1] += 1.4
        self.original = _rgb_from_lab(original_lab)

        healed_lab = original_lab.copy()
        repaired = self.core > 0
        healed_lab[repaired] = self.clean_lab[repaired]
        # A plausible reconstruction with the exact failure seen in the real
        # image: internally coherent, but too dark/red at its join.
        healed_lab[repaired, 0] -= 2.6
        healed_lab[repaired, 1] += 1.1
        self.healed = _rgb_from_lab(healed_lab)

        self.allowed = np.ones((height, width), np.uint8)
        self.suspicion = np.zeros((height, width), np.float32)
        self.suspicion[self.halo > 0] = 1.0
        self.config = harmony.HarmonizationConfig(
            search_radius_ratio=0.16,
            healthy_confidence=0.05,
            healthy_run=3,
            minimum_coverage=0.40,
            boundary_smooth_radius=2,
            texture_feather_ratio=0.002,
        )

    def test_corrects_core_and_contaminated_halo(self):
        result = harmony.harmonize(
            self.original,
            self.healed,
            self.core,
            self.allowed,
            self.suspicion,
            100.0,
            self.config,
        )
        selected = self.halo > 0
        before = np.mean(np.abs(_lab(self.healed)[selected] - self.clean_lab[selected]))
        after = np.mean(np.abs(_lab(result.image)[selected] - self.clean_lab[selected]))
        self.assertGreater(result.metadata["componentsMatched"], 0)
        self.assertLess(after, before * 0.72)
        self.assertGreater(int(result.tone_mask.sum()), int(self.core.sum()))

    def test_preserves_spatial_gradient_instead_of_one_average(self):
        result = harmony.harmonize(
            self.original,
            self.healed,
            self.core,
            self.allowed,
            self.suspicion,
            100.0,
            self.config,
        )
        output_lab = _lab(result.image)
        ys, xs = np.where(self.core > 0)
        left = self.core.astype(bool) & (np.indices(self.core.shape)[1] < np.median(xs))
        right = self.core.astype(bool) & ~left
        expected_change = float(
            self.clean_lab[right, 0].mean() - self.clean_lab[left, 0].mean()
        )
        actual_change = float(output_lab[right, 0].mean() - output_lab[left, 0].mean())
        self.assertAlmostEqual(actual_change, expected_change, delta=0.55)

    def test_never_changes_pixels_outside_its_measured_domain(self):
        result = harmony.harmonize(
            self.original,
            self.healed,
            self.core,
            self.allowed,
            self.suspicion,
            100.0,
            self.config,
        )
        affected = (result.tone_mask > 0) | (self.core > 0)
        self.assertTrue(np.array_equal(result.image[~affected], self.original[~affected]))

    def test_refuses_colour_matching_without_healthy_skin(self):
        suspicion = np.ones_like(self.suspicion)
        result = harmony.harmonize(
            self.original,
            self.healed,
            self.core,
            self.allowed,
            suspicion,
            100.0,
            self.config,
        )
        self.assertEqual(result.metadata["componentsMatched"], 0)
        self.assertEqual(int(result.tone_mask.sum()), 0)
        outside = self.core == 0
        self.assertTrue(np.array_equal(result.image[outside], self.original[outside]))


if __name__ == "__main__":
    unittest.main()
