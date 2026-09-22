"""The filler's working size: a speck goes through untouched, a person does not.

Removing a person from a 24MP frame asked the network to rebuild a hole far
wider than it can hold in view, and it returned a grey column. These pin the
rule that fixed it, without needing the weights on disk.
"""

import unittest
from unittest.mock import patch

import numpy as np

import lama_fill


def _span(mask):
    ys, xs = np.nonzero(mask)
    return max(int(xs.max() - xs.min()), int(ys.max() - ys.min())) + 1


class LamaFillWorkingSizeTests(unittest.TestCase):
    def setUp(self):
        self.seen = []

    def _infer(self, net, win, m):
        self.seen.append(_span(m))
        out = win.copy()
        out[m > 0] = 9
        return out

    def _run(self, rgb, mask):
        with patch.object(lama_fill, "_model", return_value=None), \
             patch.object(lama_fill, "_infer", side_effect=self._infer):
            return lama_fill.fill(rgb, mask, context=1.0)

    def test_a_small_mark_is_rebuilt_at_its_own_size(self):
        rgb = np.full((300, 400, 3), 120, np.uint8)
        mask = np.zeros((300, 400), np.uint8)
        mask[150:170, 200:220] = 1
        out = self._run(rgb, mask)
        self.assertEqual(self.seen, [_span(mask)])
        self.assertTrue(np.all(out[mask > 0] == 9))

    def test_a_person_sized_hole_is_brought_down_to_the_working_size(self):
        rgb = np.full((2200, 1600, 3), 120, np.uint8)
        mask = np.zeros((2200, 1600), np.uint8)
        mask[300:1800, 600:1000] = 1  # 1500px tall, far past WORK_HOLE
        out = self._run(rgb, mask)
        self.assertEqual(len(self.seen), 1)
        self.assertLessEqual(self.seen[0], lama_fill.WORK_HOLE + 2)
        self.assertGreater(self.seen[0], lama_fill.WORK_HOLE - 20)
        # whatever the working size, nothing outside the mark may move
        self.assertTrue(np.array_equal(out[mask == 0], rgb[mask == 0]))

    def test_regrain_borrows_frequencies_without_moving_tone(self):
        rng = np.random.default_rng(3)
        win = rng.integers(60, 200, (400, 600, 3), dtype=np.uint8)
        mask = np.zeros((400, 600), np.uint8)
        mask[100:300, 250:350] = 1
        coarse = np.full_like(win, 128)
        grained = lama_fill._regrain(win, coarse, mask, 4.0)
        inside = mask > 0
        self.assertGreater(float(grained[inside].std()), float(coarse[inside].std()))
        self.assertAlmostEqual(float(grained[inside].mean()), 128.0, delta=2.0)

    def test_regrain_declines_when_there_is_nothing_beside_the_hole(self):
        win = np.full((200, 200, 3), 100, np.uint8)
        mask = np.zeros((200, 200), np.uint8)
        mask[:, 10:190] = 1  # spans the frame — no clean column to borrow from
        coarse = np.full_like(win, 128)
        self.assertTrue(np.array_equal(lama_fill._regrain(win, coarse, mask, 4.0), coarse))


if __name__ == "__main__":
    unittest.main()
