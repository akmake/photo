"""Compositing contract tests; these do not certify automatic mask accuracy."""
import unittest

import numpy as np

from cleanup_guard import compose


class CleanupGuardTests(unittest.TestCase):
    def setUp(self):
        self.source = np.random.default_rng(13).integers(0, 256, (80, 100, 3), dtype=np.uint8)
        self.prediction = 255 - self.source
        self.repair = np.zeros((80, 100), dtype=bool)
        self.repair[10:70, 10:90] = True
        self.protected = np.zeros_like(self.repair)
        # Intersecting narrow filaments and a solid eye-like region: the
        # candidate overwrites both, regardless of its own detection quality.
        self.protected[20:30, 20:70] = True
        self.protected[40:65, 35] = True
        self.protected[45, 15:80] = True

    def test_protected_and_unrequested_pixels_are_bit_exact(self):
        out, meta = compose(self.source, self.prediction, self.repair, self.protected)
        fixed = self.protected | ~self.repair
        np.testing.assert_array_equal(out[fixed], self.source[fixed])
        self.assertGreater(meta['changedPx'], 1000)  # no-op cannot pass
        self.assertEqual(meta['protectedChangedPx'], 0)
        self.assertEqual(meta['outsideRepairChangedPx'], 0)
        np.testing.assert_array_equal(out[55, 60], self.prediction[55, 60])

    def test_no_support_is_identity(self):
        for repair, protected in ((np.zeros_like(self.repair), self.protected),
                                  (self.repair, np.ones_like(self.protected))):
            out, meta = compose(self.source, self.prediction, repair, protected)
            np.testing.assert_array_equal(out, self.source)
            self.assertEqual(meta['changedPx'], 0)

    def test_feather_never_spreads_to_neighboring_skin(self):
        repair = np.zeros_like(self.repair)
        repair[0:20, 0:20] = True
        out, _ = compose(self.source, self.prediction, repair, self.protected, feather_px=8)
        np.testing.assert_array_equal(out[~repair], self.source[~repair])
        self.assertFalse(np.array_equal(out[0, 0], self.prediction[0, 0]))

    def test_rejects_silent_resizing_or_ambiguous_masks(self):
        with self.assertRaises(ValueError):
            compose(self.source, self.prediction[::2], self.repair, self.protected)
        with self.assertRaises(ValueError):
            compose(self.source, self.prediction, self.repair.astype(float), self.protected)
        with self.assertRaises(ValueError):
            compose(self.source, self.prediction, self.repair, self.protected, feather_px=float('nan'))

    def test_inputs_not_mutated_and_zero_feather_is_exact_replacement(self):
        original = self.source.copy()
        prediction = self.prediction.copy()
        out, _ = compose(self.source, self.prediction, self.repair, self.protected, feather_px=0)
        permitted = self.repair & ~self.protected
        np.testing.assert_array_equal(out[permitted], prediction[permitted])
        np.testing.assert_array_equal(self.source, original)
        np.testing.assert_array_equal(self.prediction, prediction)


if __name__ == '__main__':
    unittest.main()
