"""Independent synthetic safety/repair checks for automatic cleanup.

Synthetic checks expose regressions; they do not establish real-photo quality.
Run: python -m unittest discover -s engine -p test_automatic_cleanup.py
"""
import unittest

import cv2
import numpy as np

import automatic_cleanup as auto


class AutomaticCleanupTests(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(314)
        y, x = np.mgrid[:256, :256].astype(np.float32)
        lab = np.empty((256, 256, 3), np.float32)
        lab[..., 0] = 170 + 8*x/256 + 3*y/256 + rng.normal(0, 1.1, x.shape)
        lab[..., 1] = 143 + rng.normal(0, .25, x.shape)
        lab[..., 2] = 146 + rng.normal(0, .25, x.shape)
        self.clean = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB)
        self.allowed = np.zeros((256, 256), np.float32)
        self.allowed[20:-20, 20:-20] = 1
        self.x, self.y = x, y

    def test_outside_unchanged(self):
        got = auto.even(self.clean, self.allowed, 210)
        np.testing.assert_array_equal(got[self.allowed == 0], self.clean[self.allowed == 0])

    def test_clean_texture_preserved(self):
        got = auto.even(self.clean, self.allowed, 210)
        self.assertLess(np.abs(got.astype(float)-self.clean).mean(), .6)
        before = self.clean.astype(float)-cv2.GaussianBlur(self.clean.astype(float), (0, 0), 1)
        after = got.astype(float)-cv2.GaussianBlur(got.astype(float), (0, 0), 1)
        ratio = np.std(after[40:-40, 40:-40])/np.std(before[40:-40, 40:-40])
        self.assertGreater(ratio, .9)
        self.assertLess(ratio, 1.1)

    def test_inflamed_mark_recovered(self):
        alpha = np.exp(-((self.x-128)**2+(self.y-128)**2)/(2*4**2))
        lab = cv2.cvtColor(self.clean, cv2.COLOR_RGB2LAB).astype(np.float32)
        lab += alpha[..., None]*np.array([-18, 15, 3])
        dirty = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
        got = auto.even(dirty, self.allowed, 210)
        mark = alpha > .3
        before = np.abs(dirty.astype(float)-self.clean)[mark].mean()
        after = np.abs(got.astype(float)-self.clean)[mark].mean()
        self.assertLess(after, before*.45)

    def test_coloured_crease_preserved(self):
        line = np.exp(-((self.x-128)/2)**2) * np.exp(-((self.y-128)/65)**8)
        lab = cv2.cvtColor(self.clean, cv2.COLOR_RGB2LAB).astype(np.float32)
        lab += line[..., None]*np.array([-22, 10, 7])
        dirty = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
        got = auto.even(dirty, self.allowed, 210)
        self.assertLess(np.abs(got.astype(float)-dirty)[line > .5].mean(), 2)

    def test_missing_donor_leaves_source(self):
        repair = np.zeros((256, 256), np.uint8)
        repair[100:150, 100:150] = 1
        got, meta = auto.restore(self.clean, repair, repair.astype(np.float32), 210)
        np.testing.assert_array_equal(got, self.clean)
        self.assertEqual(meta['donors'], 0)


if __name__ == '__main__':
    unittest.main()
