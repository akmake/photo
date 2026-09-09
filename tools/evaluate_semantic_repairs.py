"""Diagnostic reconstruction from automatically grounded boxes, not a release.

Boxes deliberately remain boxes: this does not claim precise defect masks.
Semantic skin parsing protects other classes; beard/lash precision is unverified.
"""
from pathlib import Path
import argparse
import hashlib
import json
import sys
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageOps
import torch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'engine'))
from cleanup_guard import compose


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('reports',nargs='+',type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--box-context',action='store_true',help='Diagnostic margin for incomplete model boxes')
    args=parser.parse_args()
    reports=[json.loads(p.read_text(encoding='utf-8')) for p in args.reports]
    first=reports[0]
    path=Path(first['source'])
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if any(r['sha256']!=digest for r in reports):
        raise ValueError('Grounding reports must refer to the same unchanged source')
    source=ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    original=np.array(source)
    faces={}
    for report in reports:
        for f in report['faces']:
            saved=faces.setdefault(f['face'],{'crop':f['crop'],'marks':[]})
            if saved['crop']!=f['crop']:
                raise ValueError('Cannot combine different face crops')
            saved['marks'].extend(f['marks'])
    net=cv2.dnn.readNetFromONNX(str(ROOT/'smart-cleanup-agent/models/face_parsing_resnet18.onnx'))
    device='cuda' if torch.cuda.is_available() else 'cpu'
    model=torch.jit.load(str(ROOT/'engine/models/big-lama.pt'),map_location=device).eval()
    args.output.mkdir(parents=True,exist_ok=True)
    prediction=original.copy()
    requested=np.zeros(original.shape[:2],bool)
    permitted=np.zeros_like(requested)
    panels=[]
    records=[]
    for faceid,f in faces.items():
        x0,y0,x1,y1=f['crop']
        crop=original[y0:y1,x0:x1]
        holes=np.zeros(crop.shape[:2],np.uint8)
        for mark in f['marks']:
            bx0,by0,bx1,by1=mark['cropBox']
            if args.box_context:
                # Box uncertainty plus inward compositor feather. This is a
                # reconstruction margin, not a claim about defect boundaries.
                pad=3+round(.15*max(bx1-bx0,by1-by0))
                bx0,by0=max(0,bx0-pad),max(0,by0-pad)
                bx1,by1=min(crop.shape[1],bx1+pad),min(crop.shape[0],by1+pad)
            holes[by0:by1,bx0:bx1]=1
        if not holes.any():
            records.append({'face':faceid,'marks':0,'changedPx':0})
            continue
        inp=cv2.resize(crop,(512,512)).astype(np.float32)/255
        inp=(inp-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)
        net.setInput(inp.transpose(2,0,1)[None])
        labels=net.forward().argmax(1)[0].astype(np.uint8)
        skin=cv2.resize((labels==1).astype(np.uint8),(crop.shape[1],crop.shape[0]),interpolation=cv2.INTER_NEAREST)
        skin=cv2.erode(skin,np.ones((5,5),np.uint8)).astype(bool)
        repair=holes.astype(bool)&skin
        h,w=crop.shape[:2]
        padded=np.pad(crop,((0,(-h)%8),(0,(-w)%8),(0,0)),mode='symmetric')
        paddedholes=np.pad(repair,((0,(-h)%8),(0,(-w)%8)),mode='constant')
        tensor=torch.from_numpy(padded.transpose(2,0,1).copy()).float()[None].to(device)/255
        masktensor=torch.from_numpy(paddedholes.copy()).float()[None,None].to(device)
        with torch.inference_mode():
            raw=model(tensor,masktensor)
        pred=np.clip(np.rint(raw[0].permute(1,2,0).cpu().numpy()*255),0,255).astype(np.uint8)[:h,:w]
        fixed,metrics=compose(crop,pred,holes.astype(bool),~skin,feather_px=3)
        prediction[y0:y1,x0:x1]=fixed
        requested[y0:y1,x0:x1]|=holes.astype(bool)
        permitted[y0:y1,x0:x1]|=repair
        marked=crop.copy(); marked[repair]=np.rint(.5*crop[repair]+.5*np.array([250,30,40])).astype(np.uint8)
        panel=Image.new('RGB',(crop.shape[1]*3,h+32),'white'); d=ImageDraw.Draw(panel)
        for j,(name,array) in enumerate([('Original',crop),('Automatic box / skin gate',marked),('LaMa diagnostic',fixed)]):
            panel.paste(Image.fromarray(array),(j*w,32)); d.text((j*w+5,5),name,fill='black')
        panel.save(args.output/f'{faceid}-comparison.png')
        records.append({'face':faceid,'marks':len(f['marks']),'metrics':metrics})
    changed=np.any(prediction!=original,axis=2)
    if np.any(changed&~permitted):
        raise AssertionError('Reconstruction escaped permitted pixels')
    Image.fromarray(prediction).save(args.output/'diagnostic-result.png')
    Image.fromarray(permitted.astype(np.uint8)*255).save(args.output/'repair-mask.png')
    out={'source':str(path),'sha256':digest,'automaticGrounding':True,'preciseDefectMasks':False,
         'productionReady':False,'boxContext':args.box_context,'changedPx':int(changed.sum()),'outsidePermittedChangedPx':0,
         'faces':records,'groundingReports':[str(p.resolve()) for p in args.reports]}
    (args.output/'report.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    print(json.dumps(out,indent=2))


if __name__=='__main__':
    main()
