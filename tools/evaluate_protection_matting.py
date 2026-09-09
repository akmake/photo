"""Diagnostic closed-form matting of learned skin boundaries at native resolution.

This refines only an unknown boundary band. It cannot repair confident semantic
mistakes elsewhere, and its opacity estimates are not validated ground truth.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time
import warnings

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'test-results/protection-research/matting-deps'))
from pymatting import estimate_alpha_cf


def overlay(rgb,alpha):
    weight=.45*alpha[...,None]
    return Image.fromarray(np.rint(rgb*(1-weight)+np.array([20,240,70])*weight).astype(np.uint8))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('baseline',type=Path)
    p.add_argument('parsing',type=Path)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--band-radius',type=int,default=4)
    p.add_argument('--symmetric-band',action='store_true',help='Diagnostic only: permit refinement into either side of boundary')
    a=p.parse_args()
    if a.band_radius<1: raise ValueError('Positive native-pixel band required')
    r=json.loads(a.baseline.read_text(encoding='utf-8'))
    pr=json.loads((a.parsing/'report.json').read_text(encoding='utf-8'))
    source=Path(r['source'])
    if hashlib.sha256(source.read_bytes()).hexdigest()!=r['sha256'] or pr['sha256']!=r['sha256']:
        raise ValueError('Source mismatch')
    im=ImageOps.exif_transpose(Image.open(source)).convert('RGB')
    a.output.mkdir(parents=True,exist_ok=True)
    kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*a.band_radius+1,)*2)
    rows=[]
    for f in r['faces']:
        started=time.perf_counter()
        crop=im.crop(f['crop']);rgb=np.array(crop)
        skin=np.array(Image.open(a.parsing/f'{f["face"]}-skin.png'))>0
        if skin.shape!=rgb.shape[:2]: raise ValueError('Native mask shape mismatch')
        known_skin=cv2.erode(skin.astype(np.uint8),kernel)>0
        known_protected=(cv2.erode((~skin).astype(np.uint8),kernel)>0
                         if a.symmetric_band else ~skin)
        trimap=np.full(skin.shape,.5,np.float64)
        trimap[known_skin]=1;trimap[known_protected]=0
        if not known_skin.any() or not known_protected.any():
            raise ValueError('Insufficient anchors; do not silently fall back')
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter('always')
            alpha=estimate_alpha_cf(rgb.astype(np.float64)/255,trimap,cg_kwargs={'maxiter':2000})
        if not np.isfinite(alpha).all(): raise ValueError('Non-finite alpha')
        assert np.all(alpha[known_skin]==1) and np.all(alpha[known_protected]==0)
        if not a.symmetric_band: assert np.all(alpha[~skin]==0)
        np.save(a.output/f'{f["face"]}-alpha.npy',alpha.astype(np.float32))
        Image.fromarray(np.rint(alpha*65535).astype(np.uint16)).save(a.output/f'{f["face"]}-alpha16.png')
        Image.fromarray(np.rint(trimap*255).astype(np.uint8)).save(a.output/f'{f["face"]}-trimap.png')
        views=[crop,overlay(rgb,skin.astype(float)),overlay(rgb,alpha)]
        panel=Image.new('RGB',(crop.width*3,crop.height+32),'white')
        for j,(v,title) in enumerate(zip(views,['Original','Learned mask','Matting (unvalidated)'])):
            panel.paste(v,(j*crop.width,32));ImageDraw.Draw(panel).text((j*crop.width+4,8),title,fill='black')
        panel.save(a.output/f'{f["face"]}-native.png')
        for w in f['inspectionWindows']:
            b=w['sourceBox'];x,y=f['crop'][:2];box=(b[0]-x,b[1]-y,b[2]-x,b[3]-y)
            width,height=box[2]-box[0],box[3]-box[1]
            zoom=Image.new('RGB',(width*12,height*4+32),'white')
            for j,v in enumerate(views):
                zoom.paste(v.crop(box).resize((width*4,height*4),Image.Resampling.NEAREST),(j*width*4,32))
            ImageDraw.Draw(zoom).text((4,8),'Original / learned mask / matting -- 4x pixels',fill='black')
            zoom.save(a.output/f'{f["face"]}-{w["name"]}-4x.png')
        rows.append({'face':f['face'],'unknownPixels':int((trimap==.5).sum()),
            'anchorPixelsChanged':0,'warnings':[str(v.message) for v in captured],
            'seconds':round(time.perf_counter()-started,2)})
    report={'source':r['source'],'sha256':r['sha256'],'parsing':str(a.parsing.resolve()),
        'method':'PyMatting 1.1.16 closed-form alpha','bandRadiusNativePx':a.band_radius,
        'symmetricBand':a.symmetric_band,
        'faces':rows,'pixelAccuracyValidated':False,'productionApproved':False}
    (a.output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
