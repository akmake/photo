"""Montage the per-face crops back into one sheet per image.

A frame with five faces costs five looks otherwise, and the referee loses the
thread between them. This stitches the faces of one frame into a single row,
labelled with the face index, so an image is one look per pass.

    python _gt_montage.py <benchdir> <subfolder> [suffix]

    _gt_montage.py ../test-results/gt-bench clean
    _gt_montage.py ../test-results/gt-bench marked _s25
"""

from __future__ import annotations

import os
import re
import sys
from collections import defaultdict

from PIL import Image, ImageDraw

HEIGHT = 900


def main():
    base, sub = sys.argv[1], sys.argv[2]
    suffix = sys.argv[3] if len(sys.argv) > 3 else ""
    src = os.path.join(base, sub)
    out = os.path.join(base, f"montage_{sub}{suffix}")
    os.makedirs(out, exist_ok=True)

    groups = defaultdict(list)
    for f in sorted(os.listdir(src)):
        m = re.match(r"(.+)_f(\d+)" + re.escape(suffix) + r"\.jpg$", f)
        if m:
            groups[m.group(1)].append((int(m.group(2)), os.path.join(src, f)))

    for tag, faces in sorted(groups.items()):
        cells = []
        for index, path in sorted(faces):
            im = Image.open(path)
            im = im.resize((int(im.width * HEIGHT / im.height), HEIGHT), Image.LANCZOS)
            cell = Image.new("RGB", (im.width, HEIGHT + 22), (16, 16, 20))
            cell.paste(im, (0, 22))
            ImageDraw.Draw(cell).text((5, 5), f"face{index}", fill=(235, 235, 235))
            cells.append(cell)
        if not cells:
            continue
        sheet = Image.new(
            "RGB", (sum(c.width + 4 for c in cells), HEIGHT + 22), (16, 16, 20)
        )
        x = 0
        for c in cells:
            sheet.paste(c, (x, 0))
            x += c.width + 4
        sheet.save(os.path.join(out, f"{tag}.jpg"), quality=93)
    print(f"{len(groups)} sheets -> {out}")


if __name__ == "__main__":
    main()
