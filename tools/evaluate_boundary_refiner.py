"""Audit a published mask refiner on saved SAM predictions, without repair.

CascadePSP's dataset uses PIL RGB, despite its quickstart passing cv2.imread.
Use RGB here, the authors' model checksum, and unchanged inference defaults.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time

import numpy as np
from PIL import Image, ImageDraw, ImageOps
import torch
from segmentation_refinement import Refiner

ROOT=Path(__file__).resolve().parents[1]


def main():
    p=argparse.ArgumentParser()
    p.add_argument('report',type=Path)
    p.add_argument('--output',required=True,type=Path)
    args=p.parse_args()
    report=json.loads(args.report.read_text(encoding='utf-8'))
    path=Path(report['source'])
    if hashlib.sha256(path.read_bytes()).hexdigest()!=report['sha256']:
        raise ValueError('Source mismatch')
    source=ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    folder=ROOT/'smart-cleanup-agent/models/cascadepsp'
    checkpoint=folder/'model'
    if hashlib.md5(checkpoint.read_bytes()).hexdigest()!='7478d4a9c42ab52beb6d7e9683402fe0':
        raise ValueError('Publisher checksum mismatch')
    os.environ['TORCH_FORCE_WEIGHTS_ONLY_LOAD']='1'
    device='cuda:0' if torch.cuda.is_available() else 'cpu'
    torch.set_num_threads(4)
    refiner=Refiner(device=device,model_folder=str(folder),download_and_check_model=False)
    args.output.mkdir(parents=True,exist_ok=True)
    records=[]
    for mark in report['marks']:
        key=mark['key']
        mask_path=Path(mark['maskPath']) if 'maskPath' in mark else args.report.parent/f"{key}-mask-{mark['selectedIndex']}.png"
        coarse=np.array(Image.open(mask_path).convert('L'))
        h,w=coarse.shape
        if 'sourceCrop' in mark:
            sx,sy,ex,ey=mark['sourceCrop']
            if [ex-sx,ey-sy]!=[w,h]:
                raise ValueError('Mask size does not match source crop')
        else:
            dx,dy=mark.get('localOffset',[0,0])
            sx,sy=mark['faceCrop'][0]+dx,mark['faceCrop'][1]+dy
        rgb=np.array(source.crop((sx,sy,sx+w,sy+h)))
        started=time.perf_counter()
        refined=refiner.refine(rgb,coarse,fast=False,L=900)
        if refined.shape!=coarse.shape:
            raise ValueError('Refiner changed dimensions')
        Image.fromarray(refined).save(args.output/f'{key}-soft-mask.png')
        selected=refined>127
        Image.fromarray(selected.astype(np.uint8)*255).save(args.output/f'{key}-mask.png')
        panel=Image.new('RGB',(w*3,h+30),'white');draw=ImageDraw.Draw(panel)
        for j,(label,mask) in enumerate([('Original',np.zeros_like(selected)),('Coarse SAM mask',coarse>127),('CascadePSP',selected)]):
            overlay=rgb.copy()
            overlay[mask]=np.rint(.5*rgb[mask]+.5*np.array([255,30,40])).astype(np.uint8)
            panel.paste(Image.fromarray(overlay),(j*w,30));draw.text((j*w+4,5),label,fill='black')
        panel.save(args.output/f'{key}-comparison.png')
        row={'key':key,'sourceCrop':[sx,sy,sx+w,sy+h],'coarsePx':int((coarse>127).sum()),
             'refinedPx':int(selected.sum()),'seconds':round(time.perf_counter()-started,2)}
        records.append(row); print(json.dumps(row),flush=True)
    out={'source':report['source'],'sha256':report['sha256'],'inputReport':str(args.report.resolve()),
         'model':'CascadePSP v1.0 / segmentation-refinement 0.6','colorOrder':'RGB',
         'checkpointSha256':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
         'marks':records,'retouchingExecuted':False,'automaticRemovalApproved':False}
    (args.output/'report.json').write_text(json.dumps(out,indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
