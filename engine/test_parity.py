"""JS/Python parity: the live preview and the batch export must agree.

The global tools are written twice on purpose — JS so a slider answers in the
same frame, Python so a thousand files export headlessly. The cost of that
choice is that any maths change can land on one side only, and then the preview
is lying about the picture the export will make. This is the guard against
that: run the same tool with the same parameters over the same pixels on both
engines and report where they part.

    python test_parity.py <image> [--tool grade-zones] [--sheet DIR]

Tolerance is per tool, because the two sides do not always compute the same
way by design (see TOL notes). A tool whose delta grows past its tolerance is a
real bug: someone edited one engine and not the other.
"""

import json
import os
import struct
import subprocess
import sys
import tempfile

import numpy as np

import common
import globals_py
import grade_zones
import hsl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_DIM = 900  # per-pixel JS on the full frame buys nothing here

# toolId -> (python callable, tolerance, cases). The tolerance is the largest
# per-channel difference allowed anywhere in the frame.
#   1  — the two sides do the same float maths. One level is the standing gap
#         between them: the Python wrapper truncates to bytes where the JS
#         writes into a Uint8ClampedArray, which rounds.
#
# A handful of pixels may land a further level apart where numpy is float32 and
# JS is float64 and the two straddle the same truncation boundary — so the gate
# is a rate, not an absolute: past OVER_PPM parts per million it is a bug, not
# arithmetic noise.
OVER_PPM = 100
CASES = [
    ("tone-color", globals_py.tone_color, 1, [
        {"exposure": 30, "contrast": 25, "temperature": -20, "vibrance": 40},
        {"highlights": -60, "shadows": 45, "whites": 20, "blacks": -25, "saturation": -30},
    ]),
    ("curves", globals_py.curves, 1, [
        {"lumaBlacks": 40, "lumaShadows": 20, "lumaHighlights": -15},
        {"blueBlacks": 35, "blueWhites": -25, "redMids": 18},
    ]),
    # 2, not 1: the engine builds the vignette falloff at 256px and scales it up
    # (a radial ramp carries no detail), where the JS evaluates it per pixel. The
    # gap is bounded at a couple of levels on the steepest part of the ramp —
    # anything past that is a real divergence, not the resampling.
    ("dimension", globals_py.dimension, 2, [
        {"vignette": 60, "midpoint": 20},
    ]),
    # Retired, still rendered for recipes that predate the merge — so parity
    # matters exactly as much as it did before.
    ("color-grade", globals_py.color_grade, 1, [
        {"shadowsWarm": -45, "highlightsWarm": 35, "fade": 30},
    ]),
    ("grade-zones", grade_zones.apply, 1, [
        {"shadowsHue": 200, "shadowsSat": 60, "highlightsHue": 45, "highlightsSat": 40},
        {"midtonesHue": 120, "midtonesSat": -50, "midtonesLum": 30, "balance": -40},
        {"fade": 30},                                   # the migrated matte
        {"fade": 45, "fadeWarmth": 70, "fadeRolloff": 80},
        {"shadowsHue": 260, "shadowsSat": 50, "fade": 25, "fadeRolloff": 60},
    ]),
    ("hsl", hsl.apply, 1, [
        {"greenSat": -70, "greenLum": -30},                 # the edit it was built for
        {"orangeHue": 25, "orangeSat": 30, "orangeLum": 15},  # skin band
        {"redHue": -40, "blueSat": 60, "purpleLum": -50, "aquaHue": 35},
        {"redSat": 40, "orangeSat": 40, "yellowSat": 40, "greenSat": 40,
         "aquaSat": 40, "blueSat": 40, "purpleSat": 40, "magentaSat": 40},
    ]),
]

# Divergences we already know about and have not fixed. They are measured and
# printed on every run so they cannot be forgotten, but they do not fail it —
# a red suite that is always red stops being read. Move a line out of here the
# day it is fixed, never the day it is inconvenient.
KNOWN = [
    (
        "dimension", globals_py.dimension, {"clarity": 40},
        "clarity's local contrast is built on different blurs on the two sides "
        "(~95% of pixels differ, up to 25 levels). The preview under-reports "
        "what the export will do. Not touched by the grade merge.",
    ),
]


def _bundle() -> str:
    """esbuild the node driver once per run; returns the bundle path."""
    out = os.path.join(tempfile.gettempdir(), "parity_driver.cjs")
    esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild.cmd")
    if not os.path.exists(esbuild):
        esbuild = os.path.join(ROOT, "node_modules", ".bin", "esbuild")
    subprocess.run(
        [
            esbuild,
            os.path.join(ROOT, "engine", "_parity_driver.ts"),
            "--bundle",
            "--platform=node",
            "--format=cjs",
            "--log-level=warning",
            f"--outfile={out}",
        ],
        check=True,
        cwd=ROOT,
    )
    return out


def _run_js(bundle: str, rgb: np.ndarray, tool: str, params: dict) -> np.ndarray:
    h, w = rgb.shape[:2]
    rgba = np.dstack([rgb, np.full((h, w, 1), 255, np.uint8)])
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = os.path.join(tmp, "in.raw"), os.path.join(tmp, "out.raw")
        with open(src, "wb") as f:
            f.write(struct.pack("<II", w, h))
            f.write(rgba.astype(np.uint8).tobytes())
        subprocess.run(
            ["node", bundle, src, dst, tool, json.dumps(params)], check=True
        )
        with open(dst, "rb") as f:
            ow, oh = struct.unpack("<II", f.read(8))
            arr = np.frombuffer(f.read(), np.uint8).reshape(oh, ow, 4)
    return arr[..., :3].copy()


def check(path: str, only: str | None, sheet_dir: str | None) -> bool:
    rgb = common.to_np(common.load_image(path))
    if max(rgb.shape[:2]) > MAX_DIM:
        import cv2

        s = MAX_DIM / max(rgb.shape[:2])
        rgb = cv2.resize(rgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)

    bundle = _bundle()
    name = path.replace("/", chr(92)).split(chr(92))[-1]
    print(f"  {name}  {rgb.shape[1]}x{rgb.shape[0]}")

    ok = True
    for tool, fn, tol, cases in CASES:
        if only and tool != only:
            continue
        for params in cases:
            js = _run_js(bundle, rgb, tool, params)
            py = fn(rgb, params)
            py = py[0] if isinstance(py, tuple) else py
            diff = np.abs(js.astype(np.int16) - py.astype(np.int16))
            mx, mean = int(diff.max()), float(diff.mean())
            over = int((diff > tol).sum())
            ppm = over / diff.size * 1e6
            good = ppm <= OVER_PPM
            ok &= good
            keys = ",".join(f"{k}={v}" for k, v in params.items())
            print(
                f"    {'ok  ' if good else 'DIFF'}  {tool:12s} max={mx:3d} "
                f"mean={mean:6.3f} over={over:7d} ({ppm:8.1f}ppm)  [{keys}]"
            )
            if sheet_dir and not good:
                from PIL import Image

                combo = np.concatenate([py, js, np.clip(diff * 16, 0, 255).astype(np.uint8)], 1)
                out = f"{sheet_dir}/parity-{tool}-{abs(hash(keys)) % 9999}.jpg"
                Image.fromarray(combo).save(out, quality=95)
                print(f"      -> {out}  (python | js | diff x16)")

    for tool, fn, params, note in KNOWN:
        if only and tool != only:
            continue
        js = _run_js(bundle, rgb, tool, params)
        py = fn(rgb, params)
        py = py[0] if isinstance(py, tuple) else py
        diff = np.abs(js.astype(np.int16) - py.astype(np.int16))
        keys = ",".join(f"{k}={v}" for k, v in params.items())
        print(
            f"    KNOWN {tool:12s} max={int(diff.max()):3d} "
            f"mean={float(diff.mean()):6.3f} "
            f"over={int((diff > 1).sum()):7d}  [{keys}]\n      {note}"
        )
    return ok


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    sheet = None
    if "--tool" in args:
        i = args.index("--tool")
        only, args = args[i + 1], args[:i] + args[i + 2:]
    if "--sheet" in args:
        i = args.index("--sheet")
        sheet, args = args[i + 1], args[:i] + args[i + 2:]
    if not args:
        print("usage: python test_parity.py <image> [...] [--tool ID] [--sheet DIR]")
        sys.exit(2)
    passed = all([check(p, only, sheet) for p in args])
    print("PASS" if passed else "FAIL")
    sys.exit(0 if passed else 1)
