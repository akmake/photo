"""The fast BiRefNet must be the same network, only faster.

    python test_birefnet_fast.py <image or folder> [more...]

Runs the exported graph and the rewritten one (birefnet_fast.py) on the same
input and holds two promises per frame:

  SAME.    The subject mask the tools actually read (matting's solidified
           alpha, at the model's 1024px output) differs nowhere by as much as
           one level in 255.
  FASTER.  Across the set, the rewritten graph takes less time.
"""

import glob
import os
import sys
import time

import numpy as np
import onnxruntime as ort

import birefnet
import common
import matting

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        failures += 1


def session(path):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) // 2)
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.enable_cpu_mem_arena = False
    return ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])


def solid(logits):
    alpha = 1.0 / (1.0 + np.exp(-logits[0, 0].astype(np.float64)))
    return matting._solidify(alpha.astype(np.float32), lo=0.04, hi=0.55)


def main(args):
    if not os.path.exists(birefnet.FAST_MODEL):
        print("models/birefnet_lite_fast.onnx is missing — run setup_models.py")
        return 1
    files = []
    for a in args:
        files += sorted(glob.glob(os.path.join(a, "*"))) if os.path.isdir(a) else [a]
    files = [f for f in files if f.lower().endswith((".jpg", ".jpeg", ".png"))]
    exported, fast = session(birefnet.MODEL), session(birefnet.FAST_MODEL)
    t_exp = t_fast = 0.0
    for i, f in enumerate(files):
        x = birefnet._prep(common.downscale(np.array(common.load_image(f))))
        if i == 0:
            exported.run(None, {"input_image": x})
            fast.run(None, {"input_image": x})
        t = time.perf_counter()
        a = exported.run(None, {"input_image": x})[0]
        t_exp += time.perf_counter() - t
        t = time.perf_counter()
        b = fast.run(None, {"input_image": x})[0]
        t_fast += time.perf_counter() - t
        d = np.abs(solid(a) - solid(b))
        check(f"{os.path.basename(f)}: largest mask difference {d.max() * 255:.4f} levels",
              d.max() * 255 < 1.0)
    n = max(1, len(files))
    check(f"{len(files)} frames: exported {t_exp / n:.2f}s, rewritten {t_fast / n:.2f}s a frame",
          t_fast < t_exp)
    print("\nPASS" if not failures else f"\n{failures} FAILED")
    return failures


if __name__ == "__main__":
    sys.exit(1 if main(sys.argv[1:]) else 0)
