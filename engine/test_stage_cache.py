"""The stage cache may only buy time, never change a pixel.

    python test_stage_cache.py <image> [more images...]

For every step of the edit screen's own recipe: render with that step's
slider moved, once resuming from the cache and once from scratch, and demand
the two frames be IDENTICAL — not close, identical. Then the cancellation:
a render stopped between steps must leave the cache in a state the next
render can finish exactly.
"""

import copy
import sys
import time

import numpy as np
from PIL import Image

import common
import render
import server

RECIPE = [
    {"toolId": "skin-retouch", "params": {"blemishes": 100, "evenness": 70, "texture": 0, "glow": 0, "keepMoles": 1}, "enabled": True},
    {"toolId": "skin-cleanup", "params": {"redness": 90}, "enabled": True},
    {"toolId": "eye-sparkle", "params": {"strength": 50}, "enabled": True},
    {"toolId": "glow", "params": {"amount": 35, "people": 25, "skin": 20, "fabric": 15, "radius": 40}, "enabled": True},
    {"toolId": "contour", "params": {"cheekbones": 25, "forehead": 15, "jaw": 15, "undereye": -10, "sculpt": 20}, "enabled": True},
    {"toolId": "tone-color", "params": {"exposure": 0, "contrast": 15, "highlights": -10, "shadows": 15, "temperature": 0, "saturation": 5}, "enabled": True},
    {"toolId": "tonal-contrast", "params": {"contrast": 40}, "enabled": True},
    {"toolId": "sharpen", "params": {"amount": 30, "radius": 20, "masking": 25}, "enabled": True},
]

# one numeric slider per tool, and the value it is moved to
MOVES = {
    "skin-retouch": ("evenness", 40),
    "skin-cleanup": ("redness", 60),
    "eye-sparkle": ("strength", 80),
    "glow": ("amount", 55),
    "contour": ("sculpt", 45),
    "tone-color": ("exposure", 25),
    "tonal-contrast": ("contrast", 70),
    "sharpen": ("amount", 60),
}

failures = 0


def check(name, ok, detail=""):
    global failures
    print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures += 1


def frame_of(path, width=1400):
    img = common.load_image(path)
    size = server._fit_size(img.size, server._quantise_width(width, img.size))
    work = img.resize(size, Image.LANCZOS)
    return work, max(img.size) / float(max(size)), img, server._photo_key(path)


def run(path):
    print("\n" + path)
    work, scale, src, key = frame_of(path)

    render.clear_stage_cache()
    t = time.time()
    render.render(work, RECIPE, scale, src, key=key)
    print(f"  cold render {time.time() - t:.2f}s")

    for tool, (param, value) in MOVES.items():
        moved = copy.deepcopy(RECIPE)
        for step in moved:
            if step["toolId"] == tool:
                step["params"][param] = value

        # prime the cache with the ORIGINAL recipe, then move the one slider
        render.render(work, RECIPE, scale, src, key=key)
        t = time.time()
        cached_img, cached_meta = render.render(work, moved, scale, src, key=key)
        warm_s = time.time() - t

        render.clear_stage_cache()
        t = time.time()
        fresh_img, _ = render.render(work, moved, scale, src, key=key)
        fresh_s = time.time() - t

        a, b = np.asarray(cached_img), np.asarray(fresh_img)
        diff = int(np.abs(a.astype(np.int16) - b.astype(np.int16)).max())
        reused = sum(1 for s in cached_meta["steps"] if s.get("cached"))
        check(f"{tool}.{param} moved: identical to a fresh render "
              f"({warm_s:.2f}s vs {fresh_s:.2f}s, {reused} steps reused)",
              diff == 0, f"max diff {diff}")

    # Cancellation: stop after two steps, then finish — must equal a fresh run.
    moved = copy.deepcopy(RECIPE)
    moved[5]["params"]["exposure"] = -30
    render.clear_stage_cache()
    asked = {"n": 0}

    def stop():
        asked["n"] += 1
        return asked["n"] > 2

    try:
        render.render(work, moved, scale, src, key=key, should_stop=stop)
        check("a stopped render raises Superseded", False)
    except render.Superseded:
        check("a stopped render raises Superseded", True)
    finished, meta = render.render(work, moved, scale, src, key=key)
    check("the next render resumes where the stopped one got to",
          sum(1 for s in meta["steps"] if s.get("cached")) == 2)
    render.clear_stage_cache()
    fresh, _ = render.render(work, moved, scale, src, key=key)
    check("and its frame is identical to an uninterrupted one",
          np.array_equal(np.asarray(finished), np.asarray(fresh)))

    # Without a key nothing is cached — pixels with no name have no identity.
    render.clear_stage_cache()
    render.render(work, RECIPE, scale, src)
    check("an unnamed frame is never cached", len(render._STAGES) == 0)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        run(p)
    print(f"\n{'PASS' if not failures else f'{failures} FAILED'}")
    sys.exit(1 if failures else 0)
