"""Native-resolution reconstruction diagnostic, NOT automatic cleanup.

Uses a released LaMa TorchScript model from simple-lama-inpainting, linked as
a third-party implementation by the LaMa authors. Diagnostic circles are
manually specified on the user's exact photo to isolate reconstruction quality.
No detector, strength sweep, colour painting, or texture graft participates.
"""
from pathlib import Path
import hashlib
import json
import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
from cleanup_guard import compose
import common
import argparse

SOURCE = Path('C:/Users/yosef dahan/Downloads/17072026/istockphoto-971105428-2048x2048.jpg')
EXPECTED_SHA = 'b181fc402f9ec72b7d670016123d8006922e00a52c20958cfd60e376602e33bd'
# x,y,r in original pixels. These are diagnostic annotations, not model output.
REGIONS = [('chin',1004,940,17), ('right-cheek-upper',1226,694,14),
           ('right-cheek-lower',1191,758,16), ('left-cheek',808,637,15),
           ('forehead-right',1156,389,13), ('forehead-centre',969,413,13)]


def run():
    parser=argparse.ArgumentParser()
    parser.add_argument('--automatic',action='store_true')
    args=parser.parse_args()
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED_SHA:
        raise RuntimeError('Source differs from the user-approved case')
    output = ROOT/('test-results/lama-auto-case' if args.automatic else 'test-results/lama-skin-case')
    output.mkdir(parents=True, exist_ok=True)
    rgb = common.to_np(common.load_image(str(SOURCE)))
    mask = np.zeros(rgb.shape[:2], np.uint8)
    protected=np.zeros_like(mask,dtype=bool)
    accepted=[]
    if args.automatic:
        import cleanup
        import masks
        found=cleanup.detect(rgb,{'redness':90,'spots':25})
        accepted=[item for item in found['items'] if item['verdict']=='heal']
        mask=cleanup._selection_mask(rgb.shape,[{'points':ring} for item in accepted for ring in item['contours']])
        mask=(mask>0).astype(np.uint8)
        # Preserve feature cores without the known overbroad forehead-contour
        # band. This is existing anatomy, not a validated beard/lash classifier.
        for face in masks._face_landmarks(rgb):
            for name,part in masks.anatomy_parts(rgb,face).items():
                if name.startswith(('eye-','brow-','lips','nose')):
                    protected |= part>0
        protected |= masks.get_mask(rgb,'hair')>.5
        mask[protected]=0
        (output/'detection.json').write_text(json.dumps(found),encoding='utf-8')
        print(f'Automatic candidates: {len(accepted)}, repair pixels: {int(mask.sum())}',flush=True)
    else:
        for _,x,y,r in REGIONS:
            cv2.circle(mask,(x,y),r,1,-1)
    # One face crop retains context and native pixels. There is no image resize.
    yy,xx=np.where(mask>0)
    if not len(xx):
        raise RuntimeError('No repairs: cannot evaluate reconstruction')
    x0,y0,x1,y1 = max(0,int(xx.min())-96),max(0,int(yy.min())-96),min(rgb.shape[1],int(xx.max())+97),min(rgb.shape[0],int(yy.max())+97)
    if not args.automatic:
        x0,y0,x1,y1=710,210,1340,1040
    crop = rgb[y0:y1,x0:x1]
    holes = mask[y0:y1,x0:x1]
    h,w = crop.shape[:2]
    padded_rgb = np.pad(crop,((0,(-h)%8),(0,(-w)%8),(0,0)),mode='symmetric')
    padded_mask = np.pad(holes,((0,(-h)%8),(0,(-w)%8)),mode='symmetric')
    image = torch.from_numpy(padded_rgb.transpose(2,0,1).copy()).float().unsqueeze(0)/255
    repair = torch.from_numpy(padded_mask.copy()).float().unsqueeze(0).unsqueeze(0)
    model_path=ROOT/'engine/models/big-lama.pt'
    torch.set_num_threads(4)
    started=time.perf_counter()
    model=torch.jit.load(str(model_path),map_location='cpu').eval()
    print('Model loaded',flush=True)
    with torch.inference_mode():
        prediction=model(image,repair)
    predicted=np.clip(np.rint(prediction[0].permute(1,2,0).cpu().numpy()*255),0,255).astype(np.uint8)[:h,:w]
    candidate=rgb.copy()
    candidate[y0:y1,x0:x1]=predicted
    result,metrics=compose(rgb,candidate,mask>0,protected,feather_px=0)
    assert metrics['outsideRepairChangedPx']==0
    Image.fromarray(result).save(output/('automatic-repairs.png' if args.automatic else 'diagnostic-six-repairs.png'))
    marked=rgb.copy()
    marked[mask>0]=np.rint(.5*rgb[mask>0]+.5*np.array([250,70,40])).astype(np.uint8)
    Image.fromarray(marked).save(output/'diagnostic-annotations.png')
    # 128 original pixels per tile, displayed 2x; identical interpolation.
    panel=Image.new('RGB',(128*2*3, (128*2+28)*len(REGIONS)), 'white')
    draw=ImageDraw.Draw(panel)
    for row,(name,x,y,r) in enumerate(REGIONS):
        for col,(label,array) in enumerate((('Original',rgb),('Diagnostic mask',marked),('LaMa',result))):
            tile=Image.fromarray(array[y-64:y+64,x-64:x+64]).resize((256,256),Image.Resampling.NEAREST)
            top=row*284
            draw.text((col*256+8,top+7),f'{name} / {label}',fill='black')
            panel.paste(tile,(col*256,top+28))
    panel.save(output/'comparison.png')
    report={'source':str(SOURCE),'sourceSha256':EXPECTED_SHA,
            'modelSource':'https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt',
            'modelSha256':hashlib.sha256(model_path.read_bytes()).hexdigest(),
            'seconds':round(time.perf_counter()-started,2),'metrics':metrics,
            'crop':[x0,y0,x1,y1],
            'regions':REGIONS,'automaticDetection':args.automatic,'productIntegrated':False,
            'acceptedCandidates':len(accepted) if args.automatic else None,
            'note':'Existing automatic detector, fixed UI settings; LaMa replaces only reconstruction.' if args.automatic else 'Six manually annotated diagnostic repairs. Visual quality not inferred from metrics.'}
    (output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__':
    run()
