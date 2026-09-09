"""Evaluate local semantic mark localization; predictions are not safe repairs."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import sys
import time
from PIL import Image, ImageDraw, ImageOps
import torch
from transformers import AutoModelForImageTextToText, AutoProcessor

ROOT=Path(__file__).resolve().parents[1]
os.environ['SMART_CLEANUP_MODEL_DIR']=str(ROOT/'smart-cleanup-agent/models')
sys.path.insert(0,str(ROOT/'smart-cleanup-agent/src'))
from smart_cleanup_agent.face_analysis import FaceDetector

PROMPT='''Inspect this face for visible material or marks that a portrait retoucher
would clean: temporary blemishes, scratches, crusts, dirt, food, mucus, or saliva.
Locate each complete mark including its less conspicuous ends. Preserve normal
skin texture, moles, freckles, hair, eyelashes, eyebrows, eyes, lips, nostrils,
creases, and lighting. Do not invent defects on clean skin. This is visual
localization, not a medical diagnosis. Return JSON only:
{"marks":[{"label":"visible description","bbox_format": "xyxy",
"box":[x1,y1,x2,y2]}]}
Use coordinates normalized to 0..1000 relative to this image. Return an empty
marks array if no such marks are visible.'''

CLASS_PROMPT='''Locate visible scratches, crusts, skin blemishes, dirt, food residue,
mucus and saliva on facial skin. Return all visible instances as JSON:
{"marks":[{"label":"description", "box":[x1,y1,x2,y2]}]}.
Use bounding box coordinates normalized to 0..1000. Enclose the complete mark.
Do not label normal anatomy, hair, moles or lighting as a defect. If none are
visible, return {"marks":[]}.'''

OBSERVATION_PROMPT='''Describe and locate visible marks on the skin of this face,
including faint light or dark lines, spots and surface material. Report what is
visible without deciding whether it is temporary, permanent, or should be removed.
Return JSON: {"marks":[{"label":"visual description", "box":[x1,y1,x2,y2]}]}.
Coordinates are normalized to 0..1000. Enclose each complete mark. Do not label
the eyes, eyebrows, nose, mouth, hair or general lighting as marks.'''


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('image',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--prompt-mode',choices=['conservative','classes','observations'],default='conservative')
    parser.add_argument('--face',type=int,help='Only this one-based face index, for diagnosis')
    parser.add_argument('--view-side',type=int,default=0,help='Diagnostic enlargement before visual encoding')
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    source=ImageOps.exif_transpose(Image.open(args.image)).convert('RGB')
    faces=FaceDetector().detect(source)
    if args.face is not None:
        faces=[faces[args.face-1]]
    if not faces:
        raise RuntimeError('No faces detected')
    path=ROOT/'smart-cleanup-agent/models/qwen3-vl-4b'
    processor=AutoProcessor.from_pretrained(path,local_files_only=True)
    model=AutoModelForImageTextToText.from_pretrained(path,local_files_only=True,
        device_map='auto',dtype=torch.bfloat16).eval()
    rows=[]
    prompt={'classes':CLASS_PROMPT,'observations':OBSERVATION_PROMPT,'conservative':PROMPT}[args.prompt_mode]
    panel=Image.new('RGB',(1024,544*len(faces)),'white')
    draw=ImageDraw.Draw(panel)
    for i,face in enumerate(faces):
        started=time.perf_counter()
        crop=source.crop(face.crop_box)
        view=crop
        if args.view_side:
            scale=args.view_side/max(crop.size)
            view=crop.resize((round(crop.width*scale),round(crop.height*scale)),Image.Resampling.LANCZOS)
        messages=[{'role':'user','content':[{'type':'image','image':view},
                   {'type':'text','text':prompt}]}]
        inputs=processor.apply_chat_template(messages,add_generation_prompt=True,
            tokenize=True,return_dict=True,return_tensors='pt').to(model.device)
        with torch.inference_mode():
            generated=model.generate(**inputs,max_new_tokens=500,do_sample=False)
        answer=processor.decode(generated[0][inputs['input_ids'].shape[-1]:],skip_special_tokens=True)
        (args.output/f'{face.id}-raw.txt').write_text(answer,encoding='utf-8')
        payload=json.loads(answer[answer.find('{'):answer.rfind('}')+1])
        marked=crop.copy()
        d=ImageDraw.Draw(marked)
        marks=[]
        for m in payload['marks']:
            x0,y0,x1,y1=m['box']
            if not (0<=x0<x1<=1000 and 0<=y0<y1<=1000):
                raise ValueError(f'Invalid model coordinates: {m}')
            box=[round(x0*crop.width/1000),round(y0*crop.height/1000),
                 round(x1*crop.width/1000),round(y1*crop.height/1000)]
            d.rectangle(box,outline='red',width=2)
            marks.append({'label':m['label'],'cropBox':box,'sourceBox':
                [box[0]+face.crop_box[0],box[1]+face.crop_box[1],
                 box[2]+face.crop_box[0],box[3]+face.crop_box[1]]})
        crop.save(args.output/f'{face.id}-original.png')
        marked.save(args.output/f'{face.id}-boxes.png')
        for j,img in enumerate([crop,marked]):
            view=ImageOps.pad(img,(512,512),color='white')
            panel.paste(view,(512*j,544*i+32))
        draw.text((8,544*i+8),f'{face.id}: original / semantic candidates',fill='black')
        rows.append({'face':face.id,'crop':list(face.crop_box),'marks':marks,
                     'seconds':round(time.perf_counter()-started,2)})
        print(json.dumps(rows[-1]),flush=True)
    panel.save(args.output/'comparison.png')
    report={'source':str(args.image.resolve()),'sha256':hashlib.sha256(args.image.read_bytes()).hexdigest(),
            'prompt':prompt,'viewSide':args.view_side,'model':str(path),'faces':rows,'automaticRemovalApproved':False}
    (args.output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
