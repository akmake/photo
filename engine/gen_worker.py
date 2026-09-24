"""The generative fill worker — runs in its OWN Python, not the engine's.

The model (RORem, an SDXL inpainting network fine-tuned to remove objects,
Apache-2.0, CVPR 2025) needs torch with CUDA and diffusers; the engine's own
environment is CPU-only and is what gets packaged. So this file is started as a
separate long-lived process by engine/gen_fill.py with the runtime that has
them, loads the pipeline ONCE (12-20s), and then answers requests on stdin:

    {"image": <png path>, "mask": <png path>, "out": <png path>, "steps": 30}
    -> {"ok": true, "seconds": 29.8}   or   {"ok": false, "error": "..."}

One JSON object per line, UTF-8 both ways. Paths are files in a temp folder;
nothing but the paths crosses the pipe.

It imports nothing from the engine on purpose: the two environments share
files, not code.
"""

import io
import json
import sys
import time

# stdin/stdout as UTF-8 regardless of the console code page (Hebrew Windows)
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)


def main(model_dir: str) -> None:
    import numpy as np
    import torch
    from diffusers import AutoPipelineForInpainting
    from PIL import Image

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = AutoPipelineForInpainting.from_pretrained(model_dir, torch_dtype=dtype).to(device)
    pipe.set_progress_bar_config(disable=True)
    print(json.dumps({"ready": True, "device": device}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            t0 = time.time()
            image = Image.open(req["image"]).convert("RGB")
            mask = Image.open(req["mask"]).convert("L")
            w, h = image.size
            # RORem's own settings: no prompt, no guidance, strength 0.99.
            # Fewer steps on the CPU, where each step costs ~9s at 1024.
            steps = int(req.get("steps") or (30 if device == "cuda" else 10))
            out = pipe(prompt="", image=image, mask_image=mask, height=h, width=w,
                       guidance_scale=1.0, num_inference_steps=steps, strength=0.99,
                       generator=torch.Generator(device="cpu").manual_seed(int(req.get("seed", 0)))
                       ).images[0]
            out.save(req["out"])
            print(json.dumps({"ok": True, "seconds": round(time.time() - t0, 1)}), flush=True)
        except Exception as exc:  # noqa: BLE001 - reported to the engine, never swallowed
            print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}), flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
