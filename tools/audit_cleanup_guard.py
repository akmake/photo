"""Audit the compositor on the user's exact source, without claiming retouching.

Exports original-resolution protection overlays, tests attempted changes at
every pixel, and reports limitations of the existing mask provider. The stress
prediction is NOT exported as a cleaned photograph.
"""
from pathlib import Path
import argparse
import hashlib
import json
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
import common
import masks
from cleanup_guard import compose


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    rgb = common.to_np(common.load_image(str(args.image)))
    faces = masks._face_landmarks(rgb)
    if not faces:
        raise RuntimeError('No face landmarks: cannot validate protection')
    anatomy = np.zeros(rgb.shape[:2], bool)
    for face in faces:
        for part in masks.anatomy_parts(rgb, face).values():
            anatomy |= part > 0
    hair = masks.get_mask(rgb, 'hair') > 0
    oval = masks.get_mask(rgb, 'face-oval') > .5
    skin = masks.get_mask(rgb, 'face-skin') > .5
    protected = anatomy | hair | ~oval | ~skin
    requested = np.ones(rgb.shape[:2], bool)
    _, metrics = compose(rgb, 255-rgb, requested, protected)
    assert metrics['protectedChangedPx'] == 0
    assert metrics['changedPx'] > 0
    args.output.mkdir(parents=True, exist_ok=True)
    overlay = rgb.copy()
    overlay[anatomy | hair] = np.rint(
        .55 * rgb[anatomy | hair] + .45 * np.array([35, 150, 235])
    ).astype(np.uint8)
    Image.fromarray(overlay).save(args.output / 'protection-overlay.png')
    Image.fromarray(protected.astype(np.uint8)*255).save(args.output / 'protected.png')
    report = {
        'source': str(args.image.resolve()),
        'sha256': hashlib.sha256(args.image.read_bytes()).hexdigest(),
        'width': rgb.shape[1], 'height': rgb.shape[0], 'faces': len(faces),
        'test': 'adversarial full-image prediction; compositor only',
        'metrics': metrics,
        'limitations': ['No learned reconstruction executed.',
                        'Hair category is not a separately validated beard detector.',
                        'Mask correctness is not certified by pixel preservation.',
                        'No product integration or quality acceptance yet.'],
    }
    (args.output / 'audit.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
