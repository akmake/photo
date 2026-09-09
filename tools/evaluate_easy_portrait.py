"""Compare an evaluation-only EasyPortrait ONNX model with saved skin audit.

Converted weights have not independently passed upstream numerical parity here.
Upstream custom licensing has not been approved for product distribution.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageOps


def overlay(rgb, mask):
    out=rgb.copy()
    out[mask]=np.rint(.55*rgb[mask]+.45*np.array([20,240,70])).astype(np.uint8)
    return Image.fromarray(out)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('baseline',type=Path)
    p.add_argument('--model',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    r=json.loads(a.baseline.read_text(encoding='utf-8'))
    source=Path(r['source'])
    if hashlib.sha256(source.read_bytes()).hexdigest()!=r['sha256']:
        raise ValueError('Source changed')
    im=ImageOps.exif_transpose(Image.open(source)).convert('RGB')
    opts=ort.SessionOptions();opts.intra_op_num_threads=4
    session=ort.InferenceSession(str(a.model),sess_options=opts,providers=['CPUExecutionProvider'])
    side=session.get_inputs()[0].shape[-1]
    a.output.mkdir(parents=True,exist_ok=True)
    rows=[]
    for f in r['faces']:
        started=time.perf_counter()
        crop=im.crop(f['crop']);rgb=np.array(crop)
        # Original checkpoint config uses Normalize(to_rgb=True): mmcv reads
        # BGR then converts to RGB. PIL already supplies RGB. The converter's
        # manifest incorrectly requests BGR. Its first Conv receives input
        # directly and its weights are identical to the original checkpoint.
        resized=cv2.resize(rgb,(side,side)).astype(np.float32)
        tensor=(resized-np.array([143.55267075,132.96705975,126.94924335],np.float32))/np.array([60.2625333,60.32740275,59.30988645],np.float32)
        logits=session.run(['logits'],{'image':tensor.transpose(2,0,1)[None]})[0][0]
        if logits.shape[0]!=8:
            raise ValueError('Unexpected class mapping; expected background, skin, brows, eyes, lips, teeth')
        # Resize logits before argmax, preserving continuous model output until
        # the final native-grid decision. Probabilities are not hair opacity.
        native=cv2.resize(logits.transpose(1,2,0),crop.size)
        labels=native.argmax(2).astype(np.uint8)
        new=labels==1
        old=np.array(Image.open(a.baseline.parent/f'{f["face"]}-raw-skin.png'))>0
        Image.fromarray(labels).save(a.output/f'{f["face"]}-labels.png')
        Image.fromarray(new.astype(np.uint8)*255).save(a.output/f'{f["face"]}-skin.png')
        views=[crop,overlay(rgb,old),overlay(rgb,new)]
        panel=Image.new('RGB',(crop.width*3,crop.height+32),'white')
        for j,(v,title) in enumerate(zip(views,['Original','Previous raw skin','EasyPortrait (unvalidated)'])):
            panel.paste(v,(j*crop.width,32));ImageDraw.Draw(panel).text((j*crop.width+4,8),title,fill='black')
        panel.save(a.output/f'{f["face"]}-native.png')
        for window in f['inspectionWindows']:
            b=window['sourceBox'];x,y=f['crop'][:2]
            box=(b[0]-x,b[1]-y,b[2]-x,b[3]-y);w,h=box[2]-box[0],box[3]-box[1]
            zoom=Image.new('RGB',(w*12,h*4+32),'white')
            for j,v in enumerate(views):
                zoom.paste(v.crop(box).resize((w*4,h*4),Image.Resampling.NEAREST),(j*w*4,32))
            ImageDraw.Draw(zoom).text((4,8),'Original / previous / EasyPortrait -- 4x pixels',fill='black')
            zoom.save(a.output/f'{f["face"]}-{window["name"]}-4x.png')
        rows.append({'face':f['face'],'skinPixels':int(new.sum()),'previousSkinNowExcluded':int((old&~new).sum()),'seconds':round(time.perf_counter()-started,2)})
    out={'source':r['source'],'sha256':r['sha256'],'modelSha256':hashlib.sha256(a.model.read_bytes()).hexdigest(),
         'faces':rows,'inputColorOrder':'RGB, verified against original checkpoint config',
         'pixelAccuracyValidated':False,'productionApproved':False,'independentConversionParity':False}
    (a.output/'report.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
    print(json.dumps(out,indent=2))


if __name__=='__main__':
    main()
