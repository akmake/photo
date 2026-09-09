"""Audit GrabCut boundaries from saved automatic localization, without repairs.

Uses OpenCV's documented rectangle or mask initialization and five iterations.
Optional seeds come from the existing detector cutoff, never hand annotations.
Localization and detector seeds are not semantic truth.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('reports', nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--detector-report', type=Path, help='Optional verified detector scores provide foreground seeds at its existing 0.5 cutoff')
    args = parser.parse_args()
    reports = [json.loads(p.read_text(encoding='utf-8')) for p in args.reports]
    source = Path(reports[0]['source'])
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if any(r['sha256'] != digest for r in reports):
        raise ValueError('Reports must match the unchanged source')
    rgb = np.array(ImageOps.exif_transpose(Image.open(source)).convert('RGB'))
    scores = None
    if args.detector_report:
        detector = json.loads(args.detector_report.read_text(encoding='utf-8'))
        if detector['sha256'] != digest:
            raise ValueError('Detector source mismatch')
        scores = np.load(args.detector_report.parent/'scores.npy', allow_pickle=False)
        if scores.shape != rgb.shape[:2] or not np.isfinite(scores).all():
            raise ValueError('Invalid detector scores')
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    union = np.zeros(rgb.shape[:2], np.uint8)
    cv2.setNumThreads(4)
    for report in reports:
        for face in report['faces']:
            x0, y0, x1, y1 = face['crop']
            crop = rgb[y0:y1, x0:x1].copy()
            for mark in face['marks']:
                bx0, by0, bx1, by1 = mark['cropBox']
                labels = np.zeros(crop.shape[:2], np.uint8)
                seeds = np.zeros(crop.shape[:2], bool)
                mode = cv2.GC_INIT_WITH_RECT
                if scores is not None:
                    labels[by0:by1, bx0:bx1] = cv2.GC_PR_FGD
                    seeds[by0:by1, bx0:bx1] = scores[y0+by0:y0+by1, x0+bx0:x0+bx1] >= .5
                    labels[seeds] = cv2.GC_FGD
                    mode = cv2.GC_INIT_WITH_MASK
                cv2.setRNGSeed(0)
                cv2.grabCut(crop, labels, (bx0, by0, bx1-bx0, by1-by0),
                            np.zeros((1, 65), np.float64),
                            np.zeros((1, 65), np.float64), 5, mode)
                selected = (labels == cv2.GC_FGD) | (labels == cv2.GC_PR_FGD)
                allowed = np.zeros_like(selected)
                allowed[by0:by1, bx0:bx1] = True
                if np.any(selected & ~allowed):
                    raise AssertionError('Segmentation escaped its rectangle')
                union[y0:y1, x0:x1] |= selected.astype(np.uint8)
                index = len(records)+1
                Image.fromarray(selected.astype(np.uint8)*255).save(args.output/f'mark-{index}-mask.png')
                overlay = crop.copy()
                overlay[selected] = np.rint(.5*crop[selected]+.5*np.array([255,30,40])).astype(np.uint8)
                margin = max(bx1-bx0, by1-by0)//2
                view = (max(0,bx0-margin), max(0,by0-margin), min(crop.shape[1],bx1+margin), min(crop.shape[0],by1+margin))
                parts = [Image.fromarray(a).crop(view) for a in (crop, overlay)]
                w, h = parts[0].size
                panel = Image.new('RGB', (w*8, h*4+30), 'white')
                draw = ImageDraw.Draw(panel)
                for j, part in enumerate(parts):
                    panel.paste(part.resize((w*4,h*4), Image.Resampling.NEAREST), (j*w*4,30))
                    draw.text((j*w*4+5,5), ['Original / 4x', 'GrabCut / 4x'][j], fill='black')
                panel.save(args.output/f'mark-{index}-comparison.png')
                records.append({'face': face['face'], 'crop': face['crop'], 'box': mark['cropBox'],
                                'maskPx': int(selected.sum()), 'boxPx': int(allowed.sum()), 'seedPx': int(seeds.sum()),
                                'groundingReport': str(report.get('mode', 'unspecified'))})
    Image.fromarray(union*255).save(args.output/'mask.png')
    out = {'source': str(source), 'sha256': digest, 'method': 'OpenCV GrabCut, 5 iterations',
           'initialization': 'detector-seeded mask' if scores is not None else 'rectangle',
           'detectorReport': str(args.detector_report) if args.detector_report else None,
           'marks': records, 'pixelAccuracyValidated': False, 'retouchingExecuted': False,
           'productionReady': False, 'groundingReports': [str(p.resolve()) for p in args.reports]}
    (args.output/'report.json').write_text(json.dumps(out, indent=2), encoding='utf-8')
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
