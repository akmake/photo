"""Reproducible cleanup case capture, without changing the source photograph.

Usage: python benchmark_auto_cleanup.py IMAGE OUTPUT_DIRECTORY
Saves full-resolution results and scan arrays for inspecting missed repairs.
The independent score is a diagnostic, not a substitute for visual review.
"""
import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

import cleanup
import common
import masks
from test_cleanup_quality import _blemish_index, _protected


def sheet(images, box, path):
    x0, y0, x1, y1 = box
    panels = []
    for label, rgb in images:
        im = Image.fromarray(rgb[y0:y1, x0:x1])
        im.thumbnail((800, 900))
        panel = Image.new('RGB', (im.width, im.height + 28), '#18181c')
        panel.paste(im, (0, 28))
        ImageDraw.Draw(panel).text((8, 7), label, fill='white')
        panels.append(panel)
    canvas = Image.new('RGB', (sum(p.width for p in panels), max(p.height for p in panels)), '#18181c')
    x = 0
    for panel in panels:
        canvas.paste(panel, (x, 0))
        x += panel.width
    canvas.save(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(4)
    rgb = common.to_np(common.load_image(args.image))
    masks.set_source(rgb)
    skin = masks.get_mask(rgb, 'face-skin')
    face_d = float(np.sqrt(skin.sum()))
    brow, eye, other, hair = _protected(rgb, face_d)
    judge = np.clip(skin * masks.get_mask(rgb, 'face-oval') - brow - eye - other - hair, 0, 1)
    box = common.region_box(skin, int(face_d * .25), rgb.shape)
    if box is None:
        raise RuntimeError('No face skin was detected')
    panels = [('Original', rgb)]
    report = {'source': str(Path(args.image).resolve()), 'before': _blemish_index(rgb, judge, face_d)}
    for label, params in [('default', {'redness': 90, 'spots': 25}), ('maximum', {'strength': 100})]:
        started = time.perf_counter()
        out, meta = cleanup.apply(rgb, params)
        delta = np.abs(out.astype(np.float32) - rgb).max(axis=2)
        report[label] = {'params': params, 'seconds': round(time.perf_counter()-started, 2),
                         'after': _blemish_index(out, judge, face_d), 'meta': meta,
                         'eye_max': float(delta[eye > .5].max(initial=0))}
        Image.fromarray(out).save(args.output / f'{label}.png')
        panels.append((label, out))
        print(label, report[label]['after'], flush=True)
    scan = cleanup._scan_face(rgb, {'strength': 100}, frame_eye=masks.get_mask(rgb, 'face-eye-region'))
    x0, y0, x1, y1 = scan.box
    np.savez_compressed(args.output / 'scan.npz', original=rgb, crop=scan.crop, crop_pre=scan.crop_pre,
                        repair=scan.repair, region=scan.detection.region, conf=scan.detection.conf,
                        box=scan.box, judge=judge, face_d=face_d,
                        features=masks.get_mask(rgb, 'face-features'),
                        eye=masks.get_mask(rgb, 'face-eye-region'), hair=hair,
                        skin=skin, oval=masks.get_mask(rgb, 'face-oval'))
    sheet(panels, box, args.output / 'comparison.png')
    (args.output / 'metrics.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(args.output.resolve(), flush=True)


if __name__ == '__main__':
    main()
