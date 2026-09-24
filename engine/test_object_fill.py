"""Contract checks for the removal fill and the brush's remnant catcher.

The quality itself is measured on real frames (docs/OBJECT-REMOVE-TIMELINE.md);
these pin what must never break: only the hole changes, thin and thick holes
take their own paths, and a stroke catches what it left of the object without
running into the background.
"""

import unittest
from unittest.mock import patch

import cv2
import numpy as np

import lama_fill
import object_fill
import object_remove


def _texture(h, w, seed=0):
    rng = np.random.default_rng(seed)
    base = np.dstack([np.linspace(60, 190, w)[None, :].repeat(h, 0)] * 3)
    grain = cv2.GaussianBlur(rng.normal(0, 18, (h, w, 3)).astype(np.float32), (0, 0), 1.2)
    return np.clip(base + grain, 0, 255).astype(np.uint8)


class RoutingTests(unittest.TestCase):
    def test_thin_and_thick_are_told_apart(self):
        thin = np.zeros((600, 900), np.uint8)
        cv2.line(thin, (50, 300), (850, 320), 1, 12)   # half-thickness 6 < 0.9% of 900
        thick = np.zeros((600, 900), np.uint8)
        cv2.circle(thick, (450, 300), 120, 1, -1)
        self.assertTrue(object_fill.is_thin(thin))
        self.assertFalse(object_fill.is_thin(thick))

    def test_each_piece_takes_its_own_path_and_nothing_else_changes(self):
        rgb = _texture(600, 900)
        hole = np.zeros((600, 900), np.uint8)
        cv2.line(hole, (40, 80), (400, 90), 1, 14)          # thin
        cv2.circle(hole, (650, 380), 110, 1, -1)             # thick
        calls = []

        def native(img, part, unknown):
            calls.append(("thin", int(part.sum())))
            out = img.copy(); out[part > 0] = 7
            return out

        def thick(img, part, unknown, avoid=None):
            calls.append(("thick", int(part.sum())))
            out = img.copy(); out[part > 0] = 9
            return out

        with patch.object(object_fill, "_native", side_effect=native), \
             patch.object(object_fill, "_thick", side_effect=thick):
            out = object_fill.fill(rgb, hole)
        self.assertEqual(sorted(k for k, _ in calls), ["thick", "thin"])
        self.assertTrue(np.array_equal(out[hole == 0], rgb[hole == 0]))
        self.assertTrue(np.isin(out[hole > 0], (7, 9)).all())


@unittest.skipUnless(lama_fill.available(), "LaMa model not installed")
class FillTests(unittest.TestCase):
    def test_thick_fill_changes_only_the_hole_and_keeps_the_light(self):
        rgb = _texture(420, 560, seed=1)
        hole = np.zeros((420, 560), np.uint8)
        cv2.ellipse(hole, (280, 210), (70, 110), 0, 0, 360, 1, -1)
        self.assertFalse(object_fill.is_thin(hole))
        out = object_fill.fill(rgb, hole)
        self.assertTrue(np.array_equal(out[hole == 0], rgb[hole == 0]))
        # a left-to-right gradient: the fill must carry it, not a blob of light
        err = np.abs(cv2.GaussianBlur(out, (0, 0), 12).astype(float)
                     - cv2.GaussianBlur(rgb, (0, 0), 12).astype(float))[hole > 0].mean()
        self.assertLess(err, 12.0)


class RemnantTests(unittest.TestCase):
    def setUp(self):
        self.rgb = np.full((300, 400, 3), 200, np.uint8)
        cv2.rectangle(self.rgb, (190, 20), (209, 280), (30, 30, 40), -1)   # a dark pipe, 20px wide

    def test_the_rim_a_stroke_missed_is_caught(self):
        stroke = np.zeros((300, 400), np.uint8)
        cv2.rectangle(stroke, (193, 20), (206, 280), 1, -1)                # 3px short on each side
        out = object_remove.catch_remnants(self.rgb, stroke)
        self.assertEqual(int(out[150, 190]), 1)
        self.assertEqual(int(out[150, 209]), 1)
        # bounded: the background a band away is untouched
        self.assertEqual(int(out[150, 170]), 0)
        self.assertEqual(int(out[150, 230]), 0)

    def test_a_stroke_on_plain_background_stays_as_painted(self):
        stroke = np.zeros((300, 400), np.uint8)
        cv2.circle(stroke, (80, 150), 25, 1, -1)
        out = object_remove.catch_remnants(self.rgb, stroke)
        self.assertTrue(np.array_equal(out, stroke))

    def test_same_answer_every_time(self):
        stroke = np.zeros((300, 400), np.uint8)
        cv2.rectangle(stroke, (194, 30), (205, 270), 1, -1)
        a = object_remove.catch_remnants(self.rgb, stroke)
        b = object_remove.catch_remnants(self.rgb, stroke)
        self.assertTrue(np.array_equal(a, b))


if __name__ == "__main__":
    unittest.main()
