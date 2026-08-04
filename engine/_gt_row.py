"""Four panels for one face: BEFORE | marked | after skin-cleanup | after face-retouch.

One look answers all three questions at once — what is really there, what the
detector claimed, and what each tool did about it. The panels are the crops the
other scripts already wrote, so nothing is recomputed and nothing can drift
between them.

    python _gt_row.py <benchdir> <tag> [spots]
"""

from __future__ import annotations

import os
import re
import sys

from PIL import Image, ImageDraw

H = 620


def cell(path, label):
    im = Image.open(path)
    im = im.resize((int(im.width * H / im.height), H), Image.LANCZOS)
    c = Image.new("RGB", (im.width, H + 20), (16, 16, 20))
    c.paste(im, (0, 20))
    ImageDraw.Draw(c).text((5, 4), label, fill=(235, 235, 235))
    return c


def main():
    base, tag = sys.argv[1], sys.argv[2]
    spots = sys.argv[3] if len(sys.argv) > 3 else "25"
    faces = sorted(
        int(m.group(1))
        for f in os.listdir(os.path.join(base, "clean"))
        for m in [re.match(re.escape(tag) + r"_f(\d+)\.jpg$", f)]
        if m
    )
    rows = []
    for i in faces:
        panels = [
            (os.path.join(base, "clean", f"{tag}_f{i}.jpg"), f"f{i} BEFORE"),
            (os.path.join(base, "marked", f"{tag}_f{i}_s{spots}.jpg"),
             f"marked s{spots}"),
            (os.path.join(base, "after_cleanup", f"{tag}_f{i}.jpg"),
             "AFTER skin-cleanup"),
            (os.path.join(base, "after_retouch", f"{tag}_f{i}.jpg"),
             "AFTER face-retouch"),
        ]
        cells = [cell(p, l) for p, l in panels if os.path.exists(p)]
        row = Image.new("RGB", (sum(c.width + 4 for c in cells), H + 20),
                        (16, 16, 20))
        x = 0
        for c in cells:
            row.paste(c, (x, 0))
            x += c.width + 4
        rows.append(row)
    sheet = Image.new("RGB", (max(r.width for r in rows),
                              sum(r.height + 6 for r in rows)), (16, 16, 20))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 6
    out = os.path.join(base, "rows")
    os.makedirs(out, exist_ok=True)
    sheet.save(os.path.join(out, f"{tag}_s{spots}.jpg"), quality=93)
    print(os.path.join(out, f"{tag}_s{spots}.jpg"))


if __name__ == "__main__":
    main()
