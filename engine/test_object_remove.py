"""Contract checks for the saved object selection and its render-size mask."""

import unittest
from unittest.mock import patch

import cv2
import numpy as np

import object_remove


class ObjectRemoveTests(unittest.TestCase):
    def setUp(self):
        self.rgb = np.full((80, 120, 3), 180, np.uint8)
        self.small = np.zeros((40, 60), np.uint8)
        cv2.rectangle(self.small, (22, 12), (37, 28), 1, -1)
        self.selection = {"maskPng": object_remove._mask_data(self.small), "margin": 0}

    def test_selection_scales_and_corrections_survive_render_size(self):
        initial = object_remove.repair_mask(self.rgb.shape, self.selection)
        self.assertEqual(initial[40, 60], 1)
        self.assertEqual(initial[0, 0], 0)
        adjusted = {**self.selection,
                    "add": [{"points": [[0.1, 0.1]], "r": 0.04}],
                    "subtract": [{"points": [[0.5, 0.5]], "r": 0.04}]}
        mask = object_remove.repair_mask(self.rgb.shape, adjusted)
        self.assertEqual(mask[8, 12], 1)
        self.assertEqual(mask[40, 60], 0)

    def test_hand_added_pixels_receive_the_same_margin(self):
        empty = np.zeros((40, 60), np.uint8)
        selection = {"maskPng": object_remove._mask_data(empty), "margin": 0.025,
                     "add": [{"points": [[0.1, 0.1]], "r": 0.02}]}
        raw = object_remove.repair_mask(self.rgb.shape, {**selection, "margin": 0})
        grown = object_remove.repair_mask(self.rgb.shape, selection)
        self.assertGreater(int(grown.sum()), int(raw.sum()))
        # the stroke reaches x=14 on its own; the margin has to carry it further
        self.assertEqual(raw[8, 17], 0)
        self.assertEqual(grown[8, 17], 1)

    def test_enclosing_object_beats_higher_scoring_part(self):
        candidates = np.zeros((3, 80, 120), np.uint8)
        candidates[0, 20:50, 20:40] = 1  # shirt
        candidates[1, 5:70, 5:60] = 1    # too uncertain
        candidates[2, 10:70, 15:48] = 1  # person, enclosing shirt
        scores = np.array([0.99, 0.90, 0.975])
        self.assertEqual(object_remove._choose_candidate(candidates, scores), 2)
        # A large scene mask must not win merely because it contains the shirt.
        candidates[2, :, :] = 1
        self.assertEqual(object_remove._choose_candidate(candidates, scores), 0)

    def test_only_saved_mask_pixels_change(self):
        def fill(rgb, mask, context):
            output = rgb.copy()
            output[mask > 0] = 17
            return output

        with patch.object(object_remove.lama_fill, "available", return_value=True), \
             patch.object(object_remove.lama_fill, "fill", side_effect=fill):
            result, meta = object_remove.apply(self.rgb, {"objectSelection": self.selection})
        mask = object_remove.repair_mask(self.rgb.shape, self.selection) > 0
        self.assertTrue(np.array_equal(result[~mask], self.rgb[~mask]))
        self.assertTrue(np.all(result[mask] == 17))
        self.assertEqual(meta["removedPx"], int(mask.sum()))

    def test_invalid_mask_and_missing_model_fail_visibly(self):
        with self.assertRaises(ValueError):
            object_remove.apply(self.rgb, {"objectSelection": {"maskPng": "invalid"}})
        with patch.object(object_remove.lama_fill, "available", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "LaMa model is unavailable"):
                object_remove.apply(self.rgb, {"objectSelection": self.selection})


if __name__ == "__main__":
    unittest.main()
