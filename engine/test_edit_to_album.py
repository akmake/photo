"""The contract every screen that SHOWS a photograph relies on.

The album lays out and prints `frame.shown`. That is only correct if, after an
edit is applied:

  1. `list_frames` reports the edited file as `shown`,
  2. its `version` changes with every new render — an edit rewrites the same
     path, and a thumbnail address without a version is kept by the browser
     for a day, so a re-edited photo went on showing its previous edit,
  3. the engine's own thumbnail cache follows the new file, not the old one.

Real files, a real render, a throwaway project folder. Nothing is mocked,
because every link of this chain has already failed once in a way no mock
would have shown. (docs/EDIT-TO-ALBUM.md)

    python test_edit_to_album.py [image]
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time

import previews
import render
import workspace

HERE = os.path.dirname(os.path.abspath(__file__))


def pick_image() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    # any real photograph will do; prefer a small one so the test stays fast
    for root in (os.path.join(HERE, "..", "public", "demo"), os.path.join(HERE, "..", "test-results")):
        for dirpath, _, files in os.walk(root):
            for f in sorted(files):
                if f.lower().endswith((".jpg", ".jpeg")):
                    return os.path.join(dirpath, f)
    raise SystemExit("no image found — pass one: python test_edit_to_album.py <image>")


def check(cond: bool, what: str) -> bool:
    print(f"  {'PASS' if cond else 'FAIL'}  {what}")
    return cond


def main() -> int:
    image = pick_image()
    home = tempfile.mkdtemp(prefix="edit-to-album-")
    ok = True
    try:
        raw_dir = os.path.join(home, workspace.RAW_DIR)
        edited_dir = os.path.join(home, workspace.EDITED_DIR)
        os.makedirs(raw_dir)
        os.makedirs(edited_dir)
        raw = os.path.join(raw_dir, "frame.jpg")
        shutil.copyfile(image, raw)
        print(f"image: {image}\nproject: {home}\n")

        # --- before any edit: the raw is what is shown -------------------
        (frame,) = workspace.list_frames(raw_dir, edited_dir)
        ok &= check(frame["edited"] is False and frame["shown"] == raw,
                    "untouched frame shows the raw")
        ok &= check(bool(frame.get("version")), "untouched frame still has a version")

        # --- first edit: exactly what /project/apply does -----------------
        strong = [{"toolId": "vignette", "params": {"amount": 90}, "enabled": True}]
        out_path, _ = render.export(raw, strong, edited_dir, "jpeg", render.DEFAULT_QUALITY)
        (frame,) = workspace.list_frames(raw_dir, edited_dir)
        ok &= check(frame["edited"] is True and frame["shown"] == out_path,
                    "after an apply, the edited file is what is shown")
        first_version = frame["version"]
        first_thumb = previews.cached_thumb(frame["shown"], 320)

        # --- re-edit: same path, must be a NEW version and a new thumbnail --
        time.sleep(0.05)  # distinct mtime even on coarse clocks
        light = [{"toolId": "vignette", "params": {"amount": 10}, "enabled": True}]
        out_path2, _ = render.export(raw, light, edited_dir, "jpeg", render.DEFAULT_QUALITY)
        (frame,) = workspace.list_frames(raw_dir, edited_dir)
        ok &= check(out_path2 == out_path, "a re-edit replaces the file in place (same path)")
        ok &= check(frame["version"] != first_version,
                    "and the version changes, so the thumbnail address changes")
        second_thumb = previews.cached_thumb(frame["shown"], 320)
        ok &= check(second_thumb != first_thumb,
                    "the engine's thumbnail cache serves the NEW file, not the old one")
        ok &= check(isinstance(frame["version"], str),
                    "version is a string (a nanosecond mtime overflows a JS number)")
    finally:
        shutil.rmtree(home, ignore_errors=True)

    print("\nedit -> album contract:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
