"""Evaluate local semantic mark localization; predictions are not safe repairs."""
from pathlib import Path
import argparse
import hashlib
import json
import math
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


def final_payload(answer, thinking=False):
    """Never interpret an unfinished reasoning trace as localization output."""
    if thinking or '<think>' in answer:
        if '</think>' not in answer:
            raise ValueError('Thinking did not finish; no final localization answer')
        answer=answer.rsplit('</think>',1)[1]
    start=answer.find('{')
    if start<0:
        raise ValueError('No final JSON object')
    payload,end=json.JSONDecoder().raw_decode(answer[start:])
    tail=answer[start+end:].strip().removesuffix('<|im_end|>').strip()
    if tail not in ('','```'):
        raise ValueError('Unexpected content after final JSON')
    if not isinstance(payload,dict) or not isinstance(payload.get('marks'),list):
        raise ValueError('Final answer has no marks array')
    for mark in payload['marks']:
        if not isinstance(mark,dict) or not isinstance(mark.get('label'),str):
            raise ValueError('Invalid mark label')
        box=mark.get('box')
        if not isinstance(box,list) or len(box)!=4 or any(type(x) not in (int,float) or not math.isfinite(x) for x in box):
            raise ValueError('Invalid mark box')
        x0,y0,x1,y1=box
        if not (0<=x0<x1<=1000 and 0<=y0<y1<=1000):
            raise ValueError('Out-of-bounds mark box')
    return payload

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
    parser.add_argument('--model-path',type=Path,default=ROOT/'smart-cleanup-agent/models/qwen3-vl-4b')
    parser.add_argument('--nf4',action='store_true',help='Local 4-bit weights with bfloat16 computation')
    parser.add_argument('--thinking',action='store_true',help='Require a completed thinking section before parsing final JSON')
    parser.add_argument('--max-new-tokens',type=int,default=500)
    parser.add_argument('--seed',type=int,default=0)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    source=ImageOps.exif_transpose(Image.open(args.image)).convert('RGB')
    faces=FaceDetector().detect(source)
    if args.face is not None:
        faces=[faces[args.face-1]]
    if not faces:
        raise RuntimeError('No faces detected')
    path=args.model_path
    processor=AutoProcessor.from_pretrained(path,local_files_only=True)
    quant={}
    if args.nf4:
        from transformers import BitsAndBytesConfig
        quant['quantization_config']=BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type='nf4',
            bnb_4bit_use_double_quant=True,bnb_4bit_compute_dtype=torch.bfloat16)
    model=AutoModelForImageTextToText.from_pretrained(path,local_files_only=True,
        device_map={'':0} if args.nf4 else 'auto',dtype=torch.bfloat16,**quant).eval()
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
        torch.manual_seed(args.seed)
        generation={'do_sample':True,'temperature':1.0,'top_p':.95,'top_k':20,'repetition_penalty':1.0} if args.thinking else {'do_sample':False}
        with torch.inference_mode():
            generated=model.generate(**inputs,max_new_tokens=args.max_new_tokens,**generation)
        answer=processor.decode(generated[0][inputs['input_ids'].shape[-1]:],skip_special_tokens=False)
        (args.output/f'{face.id}-raw.txt').write_text(answer,encoding='utf-8')
        payload=final_payload(answer,thinking=args.thinking)
        marked=crop.copy()
        d=ImageDraw.Draw(marked)
        marks=[]
        for m in payload['marks']:
            x0,y0,x1,y1=m['box']
            if not (0<=x0<x1<=1000 and 0<=y0<y1<=1000):
                raise ValueError(f'Invalid model coordinates: {m}')
            box=[math.floor(x0*crop.width/1000),math.floor(y0*crop.height/1000),
                 math.ceil(x1*crop.width/1000),math.ceil(y1*crop.height/1000)]
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
            'prompt':prompt,'viewSide':args.view_side,'model':str(path),'faces':rows,
            'nf4':args.nf4,'thinking':args.thinking,'maxNewTokens':args.max_new_tokens,
            'seed':args.seed,'generation':generation,
            'automaticRemovalApproved':False}
    (args.output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
