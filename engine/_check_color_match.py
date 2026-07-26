"""Visual and numerical comparison: legacy feather vs direct local colour match.

Usage:
    python _check_color_match.py <source-image> <output-directory> [strength]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import masks


SOURCE = sys.argv[1]
OUTPUT = Path(sys.argv[2])
STRENGTH = float(sys.argv[3]) if len(sys.argv) > 3 else 70.0
OUTPUT.mkdir(parents=True, exist_ok=True)


def _labelled_panel(images, labels, scale=1):
    prepared = []
    for image, label in zip(images, labels):
        panel = Image.fromarray(image)
        if scale != 1:
            panel = panel.resize(
                (panel.width * scale, panel.height * scale), Image.Resampling.LANCZOS
            )
        canvas = Image.new("RGB", (panel.width, panel.height + 34), (22, 22, 25))
        canvas.paste(panel, (0, 34))
        ImageDraw.Draw(canvas).text((10, 9), label, fill=(240, 240, 240))
        prepared.append(canvas)
    width = sum(panel.width for panel in prepared) + 12 * (len(prepared) - 1)
    height = max(panel.height for panel in prepared)
    output = Image.new("RGB", (width, height), (12, 12, 14))
    x = 0
    for panel in prepared:
        output.paste(panel, (x, 0))
        x += panel.width + 12
    return output


rgb = common.to_np(common.load_image(SOURCE))
legacy, legacy_meta = cleanup.apply(
    rgb, {"strength": STRENGTH, "colorMatch": 0}
)
direct, direct_meta = cleanup.apply(rgb, {"strength": STRENGTH})
Image.fromarray(legacy).save(OUTPUT / "legacy.jpg", quality=97, subsampling=0)
Image.fromarray(direct).save(OUTPUT / "direct.jpg", quality=97, subsampling=0)

skin = masks.get_mask(rgb, "face-skin")
face_d = float(np.sqrt(skin.sum()))
x0, y0, x1, y1 = common.region_box(skin, int(face_d * 0.25), rgb.shape)
crop = rgb[y0:y1, x0:x1]
got = cleanup.confidence(crop, {"strength": STRENGTH})
if got is None:
    raise SystemExit("No face confidence map")
confidence, region, face_scale, _ = got
repair = cleanup.decide(confidence, face_scale)

ys, xs = np.where(skin > 0.5)
pad = 50
fx0, fx1 = max(0, int(xs.min()) - pad), min(rgb.shape[1], int(xs.max()) + pad)
fy0, fy1 = max(0, int(ys.min()) - pad), min(rgb.shape[0], int(ys.max()) + pad)
_labelled_panel(
    [
        rgb[fy0:fy1, fx0:fx1],
        legacy[fy0:fy1, fx0:fx1],
        direct[fy0:fy1, fx0:fx1],
    ],
    ["ORIGINAL", "LEGACY FEATHER", "DIRECT LOCAL COLOUR"],
    3,
).save(OUTPUT / "face-comparison.jpg", quality=97, subsampling=0)

rows = []
count, labels, stats, _ = cv2.connectedComponentsWithStats(repair, 8)
for index in range(1, count):
    area = int(stats[index, cv2.CC_STAT_AREA])
    if area < 3:
        continue
    cx0 = x0 + int(stats[index, cv2.CC_STAT_LEFT])
    cy0 = y0 + int(stats[index, cv2.CC_STAT_TOP])
    cx1 = cx0 + int(stats[index, cv2.CC_STAT_WIDTH])
    cy1 = cy0 + int(stats[index, cv2.CC_STAT_HEIGHT])
    margin = max(24, int(max(cx1 - cx0, cy1 - cy0) * 1.2))
    bx0, bx1 = max(0, cx0 - margin), min(rgb.shape[1], cx1 + margin)
    by0, by1 = max(0, cy0 - margin), min(rgb.shape[0], cy1 + margin)
    before = rgb[by0:by1, bx0:bx1]
    old = legacy[by0:by1, bx0:bx1]
    new = direct[by0:by1, bx0:bx1]
    delta = np.abs(new.astype(np.int16) - old.astype(np.int16)).max(axis=2)
    heat = cv2.applyColorMap(
        np.clip(delta * 12, 0, 255).astype(np.uint8), cv2.COLORMAP_INFERNO
    )[..., ::-1]
    row = _labelled_panel(
        [before, old, new, heat],
        [
            f"ORIGINAL #{index}",
            "LEGACY",
            "DIRECT",
            f"CHANGE x12 / area {area}",
        ],
        5,
    )
    row.save(
        OUTPUT / f"component-{index:02d}-area-{area}.jpg",
        quality=97,
        subsampling=0,
    )
    rows.append(row)

if rows:
    width = max(row.width for row in rows)
    height = sum(row.height for row in rows) + 14 * (len(rows) - 1)
    sheet = Image.new("RGB", (width, height), (10, 10, 12))
    y = 0
    for row in rows:
        sheet.paste(row, (0, y))
        y += row.height + 14
    sheet.save(OUTPUT / "component-comparison.jpg", quality=97, subsampling=0)

metrics = {
    "strength": STRENGTH,
    "legacy": legacy_meta,
    "direct": direct_meta,
    "pixelsDifferentFromLegacy": int(
        (np.abs(direct.astype(np.int16) - legacy.astype(np.int16)).max(axis=2) > 2).sum()
    ),
    "maximumChannelDifferenceFromLegacy": int(
        np.abs(direct.astype(np.int16) - legacy.astype(np.int16)).max()
    ),
}
(OUTPUT / "metrics.json").write_text(
    json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8"
)
print(json.dumps(metrics, indent=2, ensure_ascii=False))
