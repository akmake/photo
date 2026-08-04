"""torch/ONNX parity: the shipped engine must make the same picture as the lab.

We carry PyTorch (~2-3GB on Windows) to press play on three finished weight
files. The plan is to export them to ONNX and drop torch from the shipping
requirements — onnxruntime already runs BiRefNet and MiDaS, so the runtime is
there either way.

The risk in that move is silent: an exported graph loads, runs, returns an
image, and the image is slightly different. Convolution accumulation order,
a bilinear resize implemented one pixel apart, a fused BatchNorm folded with
different rounding — none of it raises. It just shifts the result under a tool
the photographer already trusts.

So the conversion is not allowed to land on "it runs". It lands on a measured
delta against a reference captured while torch was still the engine:

    python test_onnx_parity.py capture     # run torch, write the reference
    python test_onnx_parity.py check       # run ONNX against it, report

Two levels are measured, because they answer different questions:

  net   the raw network, replayed on the EXACT input tensor torch saw. This is
        the only level that isolates the export: no face detection, no masks,
        no resampling of our own. If this level is clean the graph is faithful.

  tool  the whole `abpn.apply()` output, end to end. This is what the user
        sees, and it is where a clean net delta can still be amplified — the
        no-overshoot guard in abpn.py takes a sign() of a difference, and a
        sign flip on a near-zero deviation is a discontinuity, not a rounding.

A net-level pass with a tool-level failure is a real result, not a broken test.
It would mean the guard rails need a dead band, and we would want to know that
before shipping, not after.

`capture` needs the torch path, which abpn.py no longer has — the reference in
test-results/onnx-parity was taken before the switch and is the historical
record. Re-taking it means checking out the commit before abpn.py moved to
onnxruntime; `manifest.json` carries the weights hash so it can be verified.
"""

import argparse
import hashlib
import json
import os
import sys
import time

import numpy as np
from PIL import Image

import abpn
import common

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF_DIR = os.path.join(ROOT, "test-results", "onnx-parity")
NET_DIR = os.path.join(REF_DIR, "net")
TOOL_DIR = os.path.join(REF_DIR, "tool")
MANIFEST = os.path.join(REF_DIR, "manifest.json")

ONNX_PATH = abpn.WEIGHTS  # abpn now loads the exported graph directly

# The only true holdout set we have. `Downloads/22` is gone from this machine;
# pass paths on the command line to use anything else.
DEFAULT_IMAGE_DIR = r"c:\Users\yosef dahan\Downloads\jm__yg0J2rjsE-dhAL"

# Strength changes `degree`, which is applied AFTER the network — so every
# strength shares one net input per face and only the tool level differs.
# The extremes are the interesting ones: 40 is a normal edit, 100 is where the
# guard rails carry the most weight.
STRENGTHS = (40, 100)

# Full-resolution frames make the reference slow without making it stronger:
# the net always sees a 512 crop either way.
#
# 4000 rather than something smaller because face_d scales with the downscale,
# and the group shots are the frames worth having — they are the only ones that
# exercise the per-face loop in apply(). Measured on this set: the 5472px
# originals hold faces of face_d 187-228, so 2000 (0.37x) drops them to ~70-84
# and MIN_FACE_PX=100 skips the whole frame. 4000 (0.73x) leaves them at ~137.
# Recorded in the manifest so `check` resamples identically.
DEFAULT_MAX_DIM = 4000

# --- gates ------------------------------------------------------------------
# Deliberately provisional. Nobody has measured a torch-vs-ONNX delta on THIS
# graph yet, so these are the values we are willing to defend before seeing the
# number, not values fitted to it. If a real run lands above them, the honest
# move is to look at where, not to widen the gate.
NET_TOL = 1e-4      # max |delta| on the raw blend layer, whose range is ~0..1
TOOL_TOL = 1        # max |delta| in 8-bit levels on the finished image


def _sha(arr: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(arr).tobytes()).hexdigest()[:16]


def _load(path: str, max_dim: int) -> np.ndarray:
    img = common.load_image(path)
    if max_dim and max(img.size) > max_dim:
        s = max_dim / max(img.size)
        # LANCZOS is deterministic in PIL, so capture and check agree.
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    return common.to_np(img)


def _images(args) -> list:
    if args.images:
        return args.images
    if not os.path.isdir(DEFAULT_IMAGE_DIR):
        sys.exit(f"no images given and {DEFAULT_IMAGE_DIR} is not there")
    names = sorted(
        n for n in os.listdir(DEFAULT_IMAGE_DIR)
        if n.lower().endswith((".jpg", ".jpeg", ".png"))
    )
    return [os.path.join(DEFAULT_IMAGE_DIR, n) for n in names][: args.limit]


class _Recorder:
    """Stands in for the loaded net and keeps every (input, output) pair.

    `abpn._infer` reaches the network through `_net_instance()`, which returns
    the module global `_net` once it is loaded. Replacing that global after the
    real load puts us in the call path without touching abpn.py — the tool
    under test stays exactly the code that ships.
    """

    def __init__(self, net):
        self.net = net
        self.calls = []

    def __call__(self, x):
        import torch

        with torch.no_grad():
            y = self.net(x)
        self.calls.append((x.detach().numpy().copy(), y.detach().numpy().copy()))
        return y


def _install_recorder() -> _Recorder:
    abpn._net_instance()              # force the real load first
    rec = _Recorder(abpn._net)
    abpn._net = rec                   # _net_instance() now hands back the recorder
    return rec


# --------------------------------------------------------------------- capture

def capture(args):
    if not hasattr(abpn, "_net_instance"):
        sys.exit(
            "abpn.py no longer has a torch path - there is nothing left to capture.\n"
            f"The reference taken before the switch is at {REF_DIR}.\n"
            "To re-take it, check out the commit before abpn.py moved to onnxruntime."
        )

    os.makedirs(NET_DIR, exist_ok=True)
    os.makedirs(TOOL_DIR, exist_ok=True)

    if not os.path.exists(abpn.TORCH_WEIGHTS):
        sys.exit(f"weights missing: {abpn.TORCH_WEIGHTS}")

    paths = _images(args)
    print(f"capturing torch reference from {len(paths)} image(s), max_dim={args.max_dim}\n")

    rec = _install_recorder()
    net_cases, tool_cases, seen = {}, [], {}

    for path in paths:
        stem = os.path.splitext(os.path.basename(path))[0]
        rgb = _load(path, args.max_dim)

        for strength in STRENGTHS:
            rec.calls.clear()
            t0 = time.time()
            out, meta = abpn.apply(rgb, {"strength": strength})
            dt = time.time() - t0

            if not rec.calls:
                # No face, or a face below MIN_FACE_PX. Worth printing: a
                # reference built from frames the tool skips proves nothing.
                print(f"  {stem:<14} s{strength:<4} SKIPPED - net never ran ({meta})")
                continue

            case = f"{stem}-s{strength}"
            Image.fromarray(out).save(os.path.join(TOOL_DIR, case + ".png"))
            tool_cases.append({
                "case": case,
                "image": path,
                "strength": strength,
                "meta": {k: v for k, v in meta.items()},
                "sha": _sha(out),
                "netCalls": len(rec.calls),
            })

            # One net input per face; identical across strengths, so store once.
            for i, (x, y) in enumerate(rec.calls):
                key = _sha(x)
                if key in seen:
                    continue
                seen[key] = True
                name = f"{stem}-f{i}-{key}"
                np.save(os.path.join(NET_DIR, name + ".in.npy"), x)
                np.save(os.path.join(NET_DIR, name + ".out.npy"), y)
                net_cases[name] = {
                    "shapeIn": list(x.shape),
                    "shapeOut": list(y.shape),
                    "shaIn": key,
                    "shaOut": _sha(y),
                    "outMin": float(y.min()),
                    "outMax": float(y.max()),
                }

            print(f"  {stem:<14} s{strength:<4} {dt:5.1f}s  faces={len(rec.calls)}  {meta}")

    if not tool_cases:
        sys.exit("\nnothing captured - no frame produced a net call")

    # Determinism first. Every tolerance below is meaningless if torch itself
    # does not repeat: we would be measuring our own noise and calling it ONNX.
    print("\n  re-running the net on its own saved inputs (torch determinism)")
    worst = 0.0
    for name, info in net_cases.items():
        x = np.load(os.path.join(NET_DIR, name + ".in.npy"))
        y = np.load(os.path.join(NET_DIR, name + ".out.npy"))
        worst = max(worst, float(np.abs(_run_torch(x) - y).max()))
    print(f"  max |delta| across {len(net_cases)} case(s): {worst:.3e}"
          f"  {'OK' if worst == 0.0 else 'NOT BIT-EXACT - see note below'}")
    if worst > 0.0:
        print("  torch is not reproducing itself; NET_TOL cannot be tighter than this.")

    manifest = {
        "createdAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "engine": "torch",
        "weights": abpn.WEIGHTS,
        "weightsSha": _file_sha(abpn.WEIGHTS),
        "maxDim": args.max_dim,
        "strengths": list(STRENGTHS),
        "torchSelfDelta": worst,
        "net": net_cases,
        "tool": tool_cases,
    }
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nwrote {len(net_cases)} net case(s), {len(tool_cases)} tool case(s)")
    print(f"  {MANIFEST}")


def _run_torch(x: np.ndarray) -> np.ndarray:
    import torch

    with torch.no_grad():
        return abpn._net_instance()(torch.from_numpy(x)).numpy()


def _file_sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


# ----------------------------------------------------------------------- check

def check(args):
    if not os.path.exists(MANIFEST):
        sys.exit(f"no reference at {MANIFEST} - run `capture` first, while torch still works")
    with open(MANIFEST, encoding="utf-8") as f:
        ref = json.load(f)

    if not os.path.exists(ONNX_PATH):
        sys.exit(
            f"no exported model at {ONNX_PATH}\n"
            "The reference is captured and waiting. Export the UNet, then re-run `check`."
        )

    import onnxruntime as ort

    sess = ort.InferenceSession(ONNX_PATH, providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name

    print(f"reference: {ref['createdAt']}  weights {ref['weightsSha']}")
    print(f"onnx:      {ONNX_PATH}\n")

    # --- net level ----------------------------------------------------------
    print("net level - the exported graph on the exact tensors torch saw")
    net_worst, net_fail = 0.0, 0
    for name, info in ref["net"].items():
        x = np.load(os.path.join(NET_DIR, name + ".in.npy"))
        y = np.load(os.path.join(NET_DIR, name + ".out.npy"))
        got = sess.run([out_name], {in_name: x})[0]
        d = np.abs(got - y)
        mx, mean = float(d.max()), float(d.mean())
        net_worst = max(net_worst, mx)
        ok = mx <= NET_TOL
        net_fail += (not ok)
        print(f"  {name:<40} max {mx:.3e}  mean {mean:.3e}  {'ok' if ok else 'FAIL'}")

    # --- tool level ---------------------------------------------------------
    # Runs the SHIPPED tool, unmodified. This is the level that covers what the
    # net level cannot: abpn._infer now resizes with cv2 where it used to use
    # F.interpolate, and the guard rails see whatever comes out of that.
    print("\ntool level - the shipped tool end to end, guard rails included")
    tool_worst, tool_fail = 0, 0
    for case in ref["tool"]:
        rgb = _load(case["image"], ref["maxDim"])
        out, _ = abpn.apply(rgb, {"strength": case["strength"]})
        want = np.asarray(Image.open(os.path.join(TOOL_DIR, case["case"] + ".png")))
        if out.shape != want.shape:
            print(f"  {case['case']:<40} SHAPE {out.shape} vs {want.shape}  FAIL")
            tool_fail += 1
            continue
        d = np.abs(out.astype(np.int16) - want.astype(np.int16))
        mx = int(d.max())
        # Both counts matter: `moved` is the failure, `touched` is the size of
        # the effect. A max of 1 over three pixels and a max of 1 over the whole
        # face are not the same result, and only the second column tells them apart.
        moved = int((d > TOOL_TOL).sum())
        touched = int((d > 0).sum())
        tool_worst = max(tool_worst, mx)
        ok = mx <= TOOL_TOL
        tool_fail += (not ok)
        print(f"  {case['case']:<40} max {mx:>3} levels  over-tol {moved:>8} px  "
              f"differing {touched:>9} px ({100.0 * touched / d.size:5.2f}%)  "
              f"{'ok' if ok else 'FAIL'}")

    print(f"\nnet   worst {net_worst:.3e}  (tol {NET_TOL:.0e})   {net_fail} failing")
    print(f"tool  worst {tool_worst} levels  (tol {TOOL_TOL})   {tool_fail} failing")
    if net_fail == 0 and tool_fail:
        print("\nThe graph is faithful but the finished image moved: the delta is being\n"
              "amplified downstream, most likely by the sign() in the no-overshoot guard\n"
              "(abpn.py step 2). That is a guard-rail problem, not an export problem.")
    return 1 if (net_fail or tool_fail) else 0


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("mode", choices=("capture", "check"))
    p.add_argument("images", nargs="*", help="image paths (default: the holdout folder)")
    p.add_argument("--limit", type=int, default=6, help="how many default images to use")
    p.add_argument("--max-dim", type=int, default=DEFAULT_MAX_DIM)
    args = p.parse_args()
    if args.mode == "capture":
        capture(args)
        sys.exit(0)
    sys.exit(check(args))


if __name__ == "__main__":
    main()
