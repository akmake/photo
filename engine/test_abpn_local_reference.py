"""Numerical parity with the installed upstream ModelScope implementations.

Checkpoint key compatibility does not verify activations, operation order or
output range. Exercise both inference networks using the same learned weights.
"""
from pathlib import Path
import unittest

import torch

import abpn_local
from modelscope.models.cv.skin_retouching.detection_model.detection_unet_in import DetectionUNet
from modelscope.models.cv.skin_retouching.inpainting_model.inpainting_unet import RetouchingNet


class ModelScopeParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        cls.weights=torch.load(Path(__file__).parent/'models/joint_20210926.pth',map_location='cpu',weights_only=True)
        torch.manual_seed(21)
        cls.image=torch.rand(1,3,128,192)*2-1
        cls.keep=torch.ones(1,1,128,192)
        cls.keep[:,:,35:73,41:87]=0

    def test_detection_matches_upstream(self):
        actual=abpn_local.DetectionUNet().eval()
        expected=DetectionUNet(3,1,init_weights=False).eval()
        for net in (actual,expected):
            net.load_state_dict(self.weights['detection_net'],strict=True)
        with torch.inference_mode():
            torch.testing.assert_close(actual(self.image),expected(self.image),rtol=0,atol=1e-6)

    def test_reconstruction_matches_upstream(self):
        actual=abpn_local.RetouchingNet().eval()
        expected=RetouchingNet(4,3,init_weights=False)
        expected.eval()  # upstream overrides train() without returning self
        for net in (actual,expected):
            net.load_state_dict(self.weights['inpainting_net'],strict=True)
        masked=self.image*self.keep
        with torch.inference_mode():
            result=actual(masked,self.keep)
            torch.testing.assert_close(result,expected(masked,self.keep),rtol=0,atol=1e-6)
            self.assertLessEqual(float(result.abs().max()),1)


if __name__=='__main__':
    unittest.main()
