"""Evaluate a pretrained blemish detector on a face without retouching pixels.

Uses verified ModelScope-compatible inference and YuNet's native face crops.
Raw masks are retained so a protection mask cannot conceal classification errors.
These are predictions, never ground truth or a certification of pixel accuracy.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageOps
import torch
import torch.nn.functional as F

ROOT=Path(__file__).resolve().parents[1]
os.environ['SMART_CLEANUP_MODEL_DIR']=str(ROOT/'smart-cleanup-agent/models')
sys.path.insert(0,str(ROOT/'smart-cleanup-agent/src'))
sys.path.insert(0,str(ROOT/'engine'))
from smart_cleanup_agent.face_analysis import FaceDetector
from abpn_local import DetectionUNet


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('image',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    started=time.perf_counter()
    image=ImageOps.exif_transpose(Image.open(args.image)).convert('RGB')
    rgb=np.array(image)
    faces=FaceDetector().detect(image)
    if not faces:
        raise RuntimeError('No face: cannot evaluate')
    device='cuda' if torch.cuda.is_available() else 'cpu'
    torch.set_num_threads(4)
    checkpoint=ROOT/'engine/models/joint_20210926.pth'
    weights=torch.load(checkpoint,map_location='cpu',weights_only=True)
    model=DetectionUNet().to(device).eval()
    model.load_state_dict(weights['detection_net'],strict=True)
    del weights
    full_score=np.zeros(rgb.shape[:2],np.float32)
    records=[]
    args.output.mkdir(parents=True,exist_ok=True)
    for face in faces:
        x0,y0,x1,y1=face.crop_box
        crop=rgb[y0:y1,x0:x1]
        tensor=torch.from_numpy(crop.transpose(2,0,1).copy()).float().unsqueeze(0).to(device)/127.5-1
        with torch.inference_mode():
            standard=F.interpolate(tensor,(768,768),mode='bilinear',align_corners=True)
            prediction=torch.sigmoid(model(standard))
            score=F.interpolate(prediction,crop.shape[:2],mode='nearest')[0,0].cpu().numpy()
        full_score[y0:y1,x0:x1]=np.maximum(full_score[y0:y1,x0:x1],score)
        # These are upstream probability cutoffs, not calibrated retouching
        # confidence. Retain low/high masks separately in the output.
        count,labels,stats,_=cv2.connectedComponentsWithStats((score>=.35).astype(np.uint8),8)
        for i in range(1,count):
            x,y,w,h,area=map(int,stats[i])
            component=labels[y:y+h,x:x+w]==i
            values=score[y:y+h,x:x+w][component]
            records.append({'face':face.id,'box':[x+x0,y+y0,x+w+x0,y+h+y0],
                            'area':area,'maxScore':float(values.max()),'meanScore':float(values.mean())})
    np.save(args.output/'scores.npy',full_score)
    for name,cutoff in [('low',.35),('high',.5)]:
        selected=full_score>=cutoff
        Image.fromarray(selected.astype(np.uint8)*255).save(args.output/f'{name}-mask.png')
        overlay=rgb.copy()
        overlay[selected]=np.rint(.5*rgb[selected]+.5*np.array([245,55,40])).astype(np.uint8)
        Image.fromarray(overlay).save(args.output/f'{name}-overlay.png')
    report={'source':str(args.image.resolve()),'sha256':hashlib.sha256(args.image.read_bytes()).hexdigest(),
            'device':device,'seconds':round(time.perf_counter()-started,2),
            'faceCrops':[list(face.crop_box) for face in faces], 'components':records,
            'lowMaskPx':int((full_score>=.35).sum()),'highMaskPx':int((full_score>=.5).sum()),
            'pixelAccuracyValidated':False,'protectionApplied':False,'retouchingExecuted':False}
    (args.output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='components'},indent=2))
    print(f'Components: {len(records)}',flush=True)


if __name__=='__main__':
    main()
