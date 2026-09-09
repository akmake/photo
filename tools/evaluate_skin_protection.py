"""Expose raw parsing and existing protection at native pixel resolution.

Green means eligible skin, not validated safe skin. No retouching is performed.
Nearest-neighbor zoom preserves visible pixel errors instead of smoothing them.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
os.environ['SMART_CLEANUP_MODEL_DIR'] = str(ROOT / 'smart-cleanup-agent/models')
sys.path.insert(0, str(ROOT / 'smart-cleanup-agent/src'))
from smart_cleanup_agent.face_analysis import FaceDetector, FaceSkinAnalyzer


def overlay(rgb, mask):
    result = rgb.copy()
    result[mask] = np.rint(.55*rgb[mask] + .45*np.array([20, 240, 70])).astype(np.uint8)
    return Image.fromarray(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    image = ImageOps.exif_transpose(Image.open(args.image)).convert('RGB')
    args.output.mkdir(parents=True, exist_ok=True)
    analyzer = FaceSkinAnalyzer()
    records = []
    for face in FaceDetector().detect(image):
        crop = image.crop(face.crop_box)
        rgb = np.array(crop)
        tensor = cv2.resize(rgb, (512, 512)).astype(np.float32)/255
        tensor = (tensor-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)
        net = analyzer._load()
        net.setInput(tensor.transpose(2,0,1)[None])
        logits = net.forward()[0]
        labels = cv2.resize(logits.argmax(0).astype(np.uint8), crop.size,
                            interpolation=cv2.INTER_NEAREST)
        raw = labels == 1
        existing = analyzer.skin_mask(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), face).astype(bool)
        Image.fromarray(labels).save(args.output/f'{face.id}-labels.png')
        Image.fromarray(raw.astype(np.uint8)*255).save(args.output/f'{face.id}-raw-skin.png')
        Image.fromarray(existing.astype(np.uint8)*255).save(args.output/f'{face.id}-existing-skin.png')
        views = [crop, overlay(rgb,raw), overlay(rgb,existing)]
        panel = Image.new('RGB',(crop.width*3,crop.height+32),'white')
        for col, (view, title) in enumerate(zip(views, ['Original', 'Raw skin (unvalidated)', 'Existing protection'])):
            panel.paste(view,(col*crop.width,32))
            ImageDraw.Draw(panel).text((col*crop.width+4,8),title,fill='black')
        panel.save(args.output/f'{face.id}-native.png')
        # Fixed landmark-centered inspection windows, not reference labels.
        points = [('eye-1',face.landmarks[0]),('eye-2',face.landmarks[1])]
        points.append(('lower-face',((face.box[0]+face.box[2])//2,
            round(face.box[1]+.8*(face.box[3]-face.box[1])))))
        windows = []
        for name,(sx,sy) in points:
            cx,cy=sx-face.crop_box[0],sy-face.crop_box[1]
            half=max(16,round((face.box[2]-face.box[0])*.16))
            box=(max(0,cx-half),max(0,cy-half),min(crop.width,cx+half),min(crop.height,cy+half))
            w,h=box[2]-box[0],box[3]-box[1]
            zoom=Image.new('RGB',(w*12,h*4+32),'white')
            for col,view in enumerate(views):
                zoom.paste(view.crop(box).resize((w*4,h*4),Image.Resampling.NEAREST),(col*w*4,32))
            ImageDraw.Draw(zoom).text((4,8),'Original / raw skin / existing protection -- 4x pixel zoom',fill='black')
            zoom.save(args.output/f'{face.id}-{name}-4x.png')
            windows.append({'name':name,'sourceBox':[box[0]+face.crop_box[0],box[1]+face.crop_box[1],box[2]+face.crop_box[0],box[3]+face.crop_box[1]]})
        records.append({'face':face.id,'crop':face.crop_box,'rawSkinPixels':int(raw.sum()),
            'existingEligiblePixels':int(existing.sum()),'inspectionWindows':windows})
    report={'source':str(args.image.resolve()),'sha256':hashlib.sha256(args.image.read_bytes()).hexdigest(),
        'parserSha256':hashlib.sha256(analyzer.model_path.read_bytes()).hexdigest(),
        'faces':records,'pixelAccuracyValidated':False,'retouchingExecuted':False,
        'legend':'Green = eligible skin; no manual reference mask, no accuracy score.'}
    (args.output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    main()
