"""skin_retouch.py against DAMO's own pipeline code, plus the tool's contracts.

    python test_skin_retouch.py            (SKIN_RETOUCH_IMAGE=<photo> to choose)

Upstream here is the model card's wrapper, models/damo_skin_official/
ms_wrapper.py. The library copy (modelscope/pipelines/cv/skin_retouching_
pipeline.py) imports TensorFlow at module level, which this engine does not
install; its `retouch_local` and `predict_roi` bodies are the same code. The
wrapper's methods are called UNBOUND on a stub that carries upstream's own
networks and weights — no RetinaFace, no hub, no copy of their logic in here.

What parity can and cannot say: it proves the glue (tiling, overlap, padding,
thresholds, blend layer, border fade) is upstream's. It says nothing about
whether the result looks right — that is tools/evaluate_skin_retouch.py.
"""

import importlib.util
import os
import types
import unittest

import numpy as np
import torch

import common
import masks
import skin_retouch

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models", "damo_skin_official")
IMAGE = os.environ.get("SKIN_RETOUCH_IMAGE") or (
    r"C:\Users\yosef dahan\Downloads\17072026\istockphoto-971105428-2048x2048.jpg"
)


def _upstream_module():
    spec = importlib.util.spec_from_file_location(
        "damo_ms_wrapper", os.path.join(MODEL_DIR, "ms_wrapper.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@unittest.skipUnless(os.path.exists(IMAGE), f"no test photograph at {IMAGE}")
class UpstreamParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        W = _upstream_module()
        cls.W = W
        joint = torch.load(os.path.join(MODEL_DIR, "joint_20210926.pth"),
                           map_location="cpu", weights_only=True)
        det = W.DetectionUNet(3, 1, init_weights=False)
        det.load_state_dict(joint["detection_net"], strict=True)
        det.eval()
        inp = W.RetouchingNet(4, 3, init_weights=False)
        inp.load_state_dict(joint["inpainting_net"], strict=True)
        inp.eval()  # upstream overrides train() without returning self
        gen = W.UNet(3, 3)
        gen.load_state_dict(torch.load(os.path.join(MODEL_DIR, "pytorch_model.pt"),
                                       map_location="cpu", weights_only=True)["generator"])
        gen.eval()
        cls.stub = types.SimpleNamespace(
            detection_net=det, inpainting_net=inp, generator=gen,
            patch_size=512, input_size=512, device="cpu",
            diffuse_mask=torch.from_numpy(W.gen_diffuse_mask()).float().permute(2, 0, 1)[None],
        )
        rgb = common.to_np(common.load_image(IMAGE))
        crops = skin_retouch.face_crops(rgb)
        assert crops, "the parity photograph must contain a face"
        (x0, y0, x1, y1), _ = max(crops, key=lambda c: c[1])
        cls.crop = np.ascontiguousarray(rgb[y0:y1, x0:x1])
        cls.x = skin_retouch.to_tensor(cls.crop)
        with torch.inference_mode():
            cls.expected_local = W.SkinRetouchingTorchPipeline.retouch_local(cls.stub, cls.x)

    def test_diffuse_mask_is_upstreams(self):
        np.testing.assert_array_equal(skin_retouch.diffuse_mask(),
                                      self.W.gen_diffuse_mask()[..., 0])

    def test_blemish_removal_is_upstreams(self):
        removal = skin_retouch.removal_weights(skin_retouch.detect(self.x))
        # a parity test on a crop with nothing to remove would test nothing
        self.assertGreater(int((removal > 0).sum()), 0)
        h, w = removal.shape
        # and one tile would not exercise the overlap
        self.assertGreater(min(h, w), skin_retouch.PATCH)
        actual = skin_retouch.inpaint(self.x, removal)
        torch.testing.assert_close(actual, self.expected_local, rtol=0, atol=1e-5)

    def test_evening_is_upstreams(self):
        with torch.inference_mode():
            expected = self.W.SkinRetouchingTorchPipeline.predict_roi(
                self.stub, self.expected_local, degree=0.7, smooth_border=True
            )["pred"].numpy().astype(np.int16)
        comp = self.expected_local
        img01 = ((comp[0].permute(1, 2, 0).numpy() + 1.0) / 2.0).astype(np.float32)
        ours = skin_retouch.apply_layer(img01, skin_retouch.evening_layer(comp), 0.7)
        # upstream ends with `(pred * 255).byte()`, a truncation
        ours = np.floor(ours * 255.0).astype(np.int16)
        diff = np.abs(ours - expected)
        # the evening net here is the ONNX export (4.1e-06 from torch, see
        # test_onnx_parity.py), so a level at the truncation edge may differ
        self.assertLessEqual(int(diff.max()), 1)
        self.assertLess(float(diff.mean()), 0.02)


@unittest.skipUnless(os.path.exists(IMAGE), f"no test photograph at {IMAGE}")
class Contracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rgb = common.to_np(common.load_image(IMAGE))
        # every stage at full, so each guard below is tested against all of them
        cls.params = {"blemishes": 100, "evenness": 100, "texture": 100, "glow": 100}
        cls.out, cls.meta = skin_retouch.apply(cls.rgb, cls.params)

    def test_stages_at_zero_change_nothing(self):
        a, _ = skin_retouch.apply(self.rgb, {"blemishes": 100, "evenness": 70})
        b, _ = skin_retouch.apply(self.rgb, {"blemishes": 100, "evenness": 70, "texture": 0, "glow": 0})
        np.testing.assert_array_equal(a, b)

    def test_off_means_untouched(self):
        out, meta = skin_retouch.apply(self.rgb, {"blemishes": 0, "evenness": 0, "texture": 0, "glow": 0})
        self.assertIs(out, self.rgb)
        self.assertEqual(meta["applied"], 0)

    def test_it_acts(self):
        self.assertGreaterEqual(self.meta["applied"], 1)
        self.assertGreater(self.meta["blemishPx"], 0)

    def test_nothing_outside_the_face_crops_moves(self):
        inside = np.zeros(self.rgb.shape[:2], bool)
        for (x0, y0, x1, y1), _ in skin_retouch.face_crops(self.rgb):
            inside[y0:y1, x0:x1] = True
        np.testing.assert_array_equal(self.out[~inside], self.rgb[~inside])

    def test_kept_moles_are_left_exactly_as_they_were(self):
        # Protected from REMOVAL and EVENING — the two stages that erase a mark.
        # Softening and glow reach a mole with the skin around it on purpose
        # (shielded, it read as a dark stain), so they are off for this check.
        out, meta = skin_retouch.apply(self.rgb, {"blemishes": 100, "evenness": 100})
        h, w = self.rgb.shape[:2]
        kept = 0
        for (x0, y0, x1, y1), fw in skin_retouch.face_crops(self.rgb):
            box_id = "skin-retouch-%.4f,%.4f,%.4f,%.4f" % (x0 / w, y0 / h, x1 / w, y1 / h)
            bc = np.ascontiguousarray(self.rgb[y0:y1, x0:x1])
            with masks.scope(box_id):
                skin = np.maximum(masks.get_mask(bc, "face-skin"), masks.get_mask(bc, "body-skin"))
                feats = masks.get_mask(bc, "face-features")
            allowed = ((skin > 0.5) & (feats < 0.05)).astype(np.float32)
            a = skin_retouch._analyse(bc, allowed, skin, fw, True)
            if a["molesKept"]:
                kept += a["molesKept"]
                np.testing.assert_array_equal(out[y0:y1, x0:x1][a["moles"]], bc[a["moles"]])
        # the acne photograph has brown marks; a guard that never engages proves nothing
        self.assertGreater(kept, 0)
        self.assertEqual(kept, meta["molesKept"])

    def test_switching_moles_off_removes_them(self):
        _, meta = skin_retouch.apply(self.rgb, {**self.params, "keepMoles": 0})
        self.assertEqual(meta["molesKept"], 0)
        self.assertGreater(meta["blemishPx"], self.meta["blemishPx"])

    def test_features_are_left_exactly_as_they_were(self):
        h, w = self.rgb.shape[:2]
        for (x0, y0, x1, y1), _ in skin_retouch.face_crops(self.rgb):
            box_id = "skin-retouch-%.4f,%.4f,%.4f,%.4f" % (x0 / w, y0 / h, x1 / w, y1 / h)
            with masks.scope(box_id):
                f = masks.get_mask(self.rgb[y0:y1, x0:x1], "face-features") >= 0.999
            self.assertGreater(int(f.sum()), 0)
            np.testing.assert_array_equal(self.out[y0:y1, x0:x1][f], self.rgb[y0:y1, x0:x1][f])


if __name__ == "__main__":
    unittest.main()
