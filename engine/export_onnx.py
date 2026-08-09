"""Export the learned models from PyTorch to ONNX, so torch stops shipping.

torch is ~2-3GB installed on Windows and we use it to press play on finished
weight files. onnxruntime (~50MB) already runs BiRefNet and MiDaS. Exporting
the remaining nets lets `requirements.txt` drop torch, timm, and the
install-from-github line for MobileSAM.

    python export_onnx.py abpn        # models/pytorch_model.pt -> abpn_unet.onnx

This script is a BUILD tool, not a runtime one: it needs torch, runs on a
developer machine, and its output is committed to models/ the same way the
downloaded weights are. Nothing in the shipped engine imports it.

Exporting is the easy half. The graph can load, run, return an image, and be
subtly wrong — a fused BatchNorm rounding differently, a bilinear resize landing
a pixel off. So this script only smoke-tests the export; the real gate is

    python test_onnx_parity.py check

which replays the exact tensors torch saw and measures the delta at both the
network and the finished-image level. Do not treat an export as done until that
passes. See docs/BUGS.md for what a silent difference costs.
"""

import argparse
import os
import sys

import numpy as np

MODELS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

# The network is only ever called on a TILE x TILE crop — abpn._infer resizes to
# 512 before the call and back afterwards — so the graph is exported at a fixed
# 1x3x512x512. Static shapes let onnxruntime plan memory and fuse ahead of time,
# and a dynamic axis here would buy nothing: no caller can use it.
ABPN_TILE = 512


def export_abpn(opset: int) -> str:
    import torch

    import abpn
    import abpn_net

    # abpn.WEIGHTS is the ONNX file we are about to write; the checkpoint we
    # read from is TORCH_WEIGHTS, which the engine itself never opens.
    src = abpn.TORCH_WEIGHTS
    if not os.path.exists(src):
        sys.exit(f"weights missing: {src}\nrun setup_models.py first")

    dst = os.path.join(MODELS, "abpn_unet.onnx")
    net = abpn_net.load(src, "cpu")          # load_state_dict(strict=True) inside
    dummy = torch.randn(1, 3, ABPN_TILE, ABPN_TILE)

    print(f"  source  {src}")
    print(f"  target  {dst}")
    print(f"  input   {tuple(dummy.shape)}  opset {opset}")

    torch.onnx.export(
        net,
        dummy,
        dst,
        input_names=["input"],
        output_names=["output"],
        opset_version=opset,
        do_constant_folding=True,
        dynamo=False,  # the TorchScript exporter: no onnxscript dependency
    )
    return dst


def export_dinov2(opset: int) -> str:
    """DINOv2 ViT-S/14 -> models/dinov2_vits14.onnx.

    Unlike abpn, the weights are not a file in models/: torch.hub fetches both the
    model code and the pretrained checkpoint (Apache 2.0, ungated) on this dev
    machine, and only the exported graph is kept. The engine then runs it on
    onnxruntime with no torch, exactly like MiDaS.

    The graph takes a 1x3x224x224 ImageNet-normalised tensor and returns the CLS
    embedding, 1x384. Batch is left dynamic so a later stage can embed several
    frames in one call without a re-export.
    """
    import torch

    dst = os.path.join(MODELS, "dinov2_vits14.onnx")
    print(f"  loading facebookresearch/dinov2:dinov2_vits14 via torch.hub ...")
    net = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14", trust_repo=True)
    net.eval()

    # DINOv2's own forward is `forward(self, *args, is_training=False, **kwargs)`,
    # and forward_features carries a `masks=None` parameter. Exported directly, the
    # var-args make the tracer expose a phantom second input named `masks` that
    # onnxruntime then demands on every run. Wrap it in a module with ONE explicit
    # input that returns the global image embedding — the normalised CLS token —
    # and the graph has exactly the one input the engine feeds.
    class _CLSEmbedding(torch.nn.Module):
        def __init__(self, backbone):
            super().__init__()
            self.backbone = backbone

        def forward(self, x):
            return self.backbone.forward_features(x)["x_norm_clstoken"]

    model = _CLSEmbedding(net).eval()
    dummy = torch.randn(1, 3, 224, 224)

    print(f"  target  {dst}")
    print(f"  input   {tuple(dummy.shape)}  opset {opset}")

    torch.onnx.export(
        model,
        dummy,
        dst,
        input_names=["input"],
        output_names=["embedding"],
        opset_version=opset,
        do_constant_folding=True,
        dynamo=False,
        dynamic_axes={"input": {0: "batch"}, "embedding": {0: "batch"}},
    )
    return dst


def smoke(dst: str, shape, runs: int = 3):
    """Same tensors through both engines. Catches a broken export, not a subtle one.

    Random input on purpose: real face crops occupy a narrow slice of the input
    space, and a graph can be wrong in a region no photograph reaches. This is
    a wider net than the parity reference, and a much coarser one.
    """
    import torch

    import abpn
    import abpn_net

    import onnxruntime as ort

    net = abpn_net.load(abpn.TORCH_WEIGHTS, "cpu")
    sess = ort.InferenceSession(dst, providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name

    worst = 0.0
    rng = np.random.default_rng(0)
    for i in range(runs):
        x = rng.standard_normal(shape, dtype=np.float32)
        with torch.no_grad():
            want = net(torch.from_numpy(x)).numpy()
        got = sess.run([out_name], {in_name: x})[0]
        d = float(np.abs(got - want).max())
        worst = max(worst, d)
        print(f"  random {i + 1}/{runs}   max |delta| {d:.3e}")

    size_mb = os.path.getsize(dst) / (1 << 20)
    print(f"\n  {os.path.basename(dst)}  {size_mb:.1f} MB")
    print(f"  worst random-input delta: {worst:.3e}")
    return worst


def smoke_dinov2(dst: str, runs: int = 3):
    """Same tensors through torch and onnxruntime. A graph-correctness check —
    it catches a broken export, and 384-d cosine ≈ 1.0 is what a good one looks
    like even on random input, which is a coarser bar than a face-image parity."""
    import torch

    net = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14", trust_repo=True)
    net.eval()

    import onnxruntime as ort

    sess = ort.InferenceSession(dst, providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name

    worst = 0.0
    rng = np.random.default_rng(0)
    for i in range(runs):
        x = rng.standard_normal((1, 3, 224, 224), dtype=np.float32)
        with torch.no_grad():
            want = net(torch.from_numpy(x)).numpy().reshape(-1)
        got = np.asarray(sess.run([out_name], {in_name: x})[0]).reshape(-1)
        cos = float(want @ got / (np.linalg.norm(want) * np.linalg.norm(got) + 1e-9))
        d = float(np.abs(got - want).max())
        worst = max(worst, d)
        print(f"  random {i + 1}/{runs}   cosine {cos:.5f}   max |delta| {d:.3e}")

    size_mb = os.path.getsize(dst) / (1 << 20)
    print(f"\n  {os.path.basename(dst)}  {size_mb:.1f} MB   worst delta {worst:.3e}")
    return worst


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("model", choices=("abpn", "dinov2"))
    p.add_argument("--opset", type=int, default=17)
    args = p.parse_args()

    print(f"exporting {args.model}")
    if args.model == "abpn":
        dst = export_abpn(args.opset)
        print("\nsmoke test - random tensors through both engines")
        smoke(dst, (1, 3, ABPN_TILE, ABPN_TILE))
        print("\nNow run the real gate:  python test_onnx_parity.py check")
    else:
        dst = export_dinov2(args.opset)
        print("\nsmoke test - random tensors through both engines")
        smoke_dinov2(dst)


if __name__ == "__main__":
    main()
