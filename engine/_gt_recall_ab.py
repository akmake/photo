"""Run the injected-mark recall suite with the structural prior ON and OFF.

An "after" number is worth nothing without a "before" taken on the same code,
the same images and the same masks. This runs `test_cleanup_recall` twice in one
process, zeroing the prior's weights for the first pass, so the only difference
between the two results is the thing being tested.

    python _gt_recall_ab.py <image> [more images...]
"""

from __future__ import annotations

import io
import contextlib
import sys

import cleanup

WEIGHTS = ("STRUCT_LIFT", "SPECULAR_LIFT", "PIGMENT_CREDIT")
SAVED = {k: getattr(cleanup, k) for k in WEIGHTS}


def run(images):
    src = open("test_cleanup_recall.py", encoding="utf-8").read()
    buf = io.StringIO()
    argv = sys.argv
    sys.argv = ["test_cleanup_recall.py"] + images
    try:
        with contextlib.redirect_stdout(buf):
            try:
                exec(compile(src, "test_cleanup_recall.py", "exec"), {"__name__": "__main__"})
            except SystemExit:
                pass
    finally:
        sys.argv = argv
    return buf.getvalue()


def digest(text):
    for line in text.splitlines():
        s = line.strip()
        if s.startswith(("PASS", "FAIL")):
            print("   " + s.split("{")[0].strip())
        elif s.split(" ")[0] in ("HEAL", "MISS", "part"):
            print("     " + s)


def main():
    images = sys.argv[1:]
    for k in WEIGHTS:
        setattr(cleanup, k, 0.0)
    print("=== BEFORE (structural prior off) ===")
    digest(run(images))
    for k, v in SAVED.items():
        setattr(cleanup, k, v)
    print(f"\n=== AFTER  (lift {SAVED['STRUCT_LIFT']}, spec {SAVED['SPECULAR_LIFT']}, "
          f"credit {SAVED['PIGMENT_CREDIT']}) ===")
    digest(run(images))


if __name__ == "__main__":
    main()
