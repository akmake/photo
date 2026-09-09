"""Inspect SAM2 boundaries from semantic boxes; no retouching approval implied."""
from pathlib import Path
import argparse
import hashlib
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps
import torch
from transformers import Sam2Model, Sam2Processor, SamHQModel, SamHQProcessor

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('report',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--model',choices=['sam2','sam-hq','hq-original'],default='sam2')
    parser.add_argument('--eager',action='store_true',help='Compare unaccelerated attention for inference parity')
    parser.add_argument('--local-context',action='store_true',help='Inspect each mark with one box-width of surrounding context')
    parser.add_argument('--detector-report',type=Path,help='Use connected high-confidence detector components as point prompts')
    args=parser.parse_args()
    report=json.loads(args.report.read_text(encoding='utf-8'))
    path=Path(report['source'])
    if hashlib.sha256(path.read_bytes()).hexdigest()!=report['sha256']:
        raise ValueError('Source changed since grounding')
    source=ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    detector_scores=None
    if args.detector_report:
        detector=json.loads(args.detector_report.read_text(encoding='utf-8'))
        if detector['sha256']!=report['sha256']:
            raise ValueError('Detector source mismatch')
        detector_scores=np.load(args.detector_report.parent/'scores.npy',allow_pickle=False)
        if detector_scores.shape!=(source.height,source.width) or not np.isfinite(detector_scores).all():
            raise ValueError('Invalid detector score array')
    device='cuda' if torch.cuda.is_available() else 'cpu'
    if args.model=='hq-original':
        from segment_anything_hq import sam_model_registry,SamPredictor
        modelpath=ROOT/'smart-cleanup-agent/models/hq-sam-original/sam_hq_vit_b.pth'
        model=sam_model_registry['vit_b']()
        model.load_state_dict(torch.load(modelpath,map_location='cpu',weights_only=True),strict=True)
        model=model.to(device).eval()
        predictor=SamPredictor(model)
        loading={'strictLoad':True}
    else:
        modelpath=ROOT/'smart-cleanup-agent/models'/('sam-hq-vit-base' if args.model=='sam-hq' else 'sam2.1-hiera-small')
        processorclass,modelclass=(SamHQProcessor,SamHQModel) if args.model=='sam-hq' else (Sam2Processor,Sam2Model)
        processor=processorclass.from_pretrained(modelpath,local_files_only=True)
        model,loading=modelclass.from_pretrained(modelpath,local_files_only=True,output_loading_info=True,
            **({'attn_implementation':'eager'} if args.eager else {}))
        if loading['missing_keys'] or loading['mismatched_keys'] or loading['error_msgs']:
            raise ValueError(f'Incomplete pretrained model: {loading}')
        model=model.to(device).eval()
    args.output.mkdir(parents=True,exist_ok=True)
    records=[]
    for face in report['faces']:
        for i,mark in enumerate(face['marks']):
            crop=source.crop(face['crop'])
            key=f"{face['face']}-mark-{i+1}"
            box=list(mark['cropBox'])
            offset=[0,0]
            if args.local_context:
                margin=max(box[2]-box[0],box[3]-box[1])
                local=[max(0,box[0]-margin),max(0,box[1]-margin),min(crop.width,box[2]+margin),min(crop.height,box[3]+margin)]
                crop=crop.crop(local)
                offset=local[:2]
                box=[box[0]-local[0],box[1]-local[1],box[2]-local[0],box[3]-local[1]]
            points=[]
            if detector_scores is not None:
                sx,sy=face['crop'][0]+offset[0],face['crop'][1]+offset[1]
                scores_crop=detector_scores[sy:sy+crop.height,sx:sx+crop.width]
                seeds=np.zeros(scores_crop.shape,np.uint8)
                seeds[box[1]:box[3],box[0]:box[2]]=scores_crop[box[1]:box[3],box[0]:box[2]]>=.5
                count,labels=cv2.connectedComponents(seeds,8)
                for component in range(1,count):
                    ys,xs=np.where(labels==component)
                    best=int(scores_crop[ys,xs].argmax())
                    points.append([int(xs[best]),int(ys[best])])
            if args.model=='hq-original':
                with torch.inference_mode():
                    predictor.set_image(np.array(crop))
                    masks,scores,_=predictor.predict(box=np.array(box),multimask_output=False,
                        point_coords=np.array(points) if points else None,
                        point_labels=np.ones(len(points),np.int32) if points else None)
            else:
                prompts={'input_points':[[points]],'input_labels':[[[1]*len(points)]]} if points else {}
                inputs=processor(images=crop,input_boxes=[[box]],return_tensors='pt',**prompts).to(device)
                with torch.inference_mode():
                    result=model(**inputs,multimask_output=args.model=='sam2')
                postargs=[result.pred_masks.cpu(),inputs['original_sizes'].cpu()]
                if args.model=='sam-hq':
                    postargs.append(inputs['reshaped_input_sizes'].cpu())
                masks=processor.post_process_masks(*postargs)[0][0].numpy().astype(bool)
                scores=result.iou_scores[0,0].float().cpu().numpy()
            selected=int(scores.argmax())
            panel=Image.new('RGB',(crop.width*(len(masks)+1),crop.height+32),'white')
            d=ImageDraw.Draw(panel)
            panel.paste(crop,(0,32)); d.text((5,5),'Original',fill='black')
            roi=np.zeros((crop.height,crop.width),bool)
            x0,y0,x1,y1=box
            roi[y0:y1,x0:x1]=True
            stats=[]
            for j,mask in enumerate(masks):
                rgb=np.array(crop); rgb[mask]=np.rint(.5*rgb[mask]+.5*np.array([250,30,40])).astype(np.uint8)
                panel.paste(Image.fromarray(rgb),((j+1)*crop.width,32))
                d.text(((j+1)*crop.width+5,5),f'{j}: score {scores[j]:.3f}',fill='black')
                Image.fromarray(mask.astype(np.uint8)*255).save(args.output/f'{key}-mask-{j}.png')
                stats.append({'maskPixels':int(mask.sum()),'outsideBoxPixels':int((mask&~roi).sum())})
            panel.save(args.output/f'{key}-comparison.png')
            records.append({'key':key,'face':face['face'],'label':mark['label'],
                            'faceCrop':face['crop'],'localOffset':offset,'promptBox':box,'promptPoints':points,'selectedIndex':selected,
                            'scores':scores.tolist(),'maskStats':stats})
    output={'source':report['source'],'sha256':report['sha256'],'groundingReport':str(args.report.resolve()),
            'model':args.model,'eager':args.eager,'loading':loading,'localContext':args.local_context,
            'detectorReport':str(args.detector_report) if args.detector_report else None,
            'marks':records,'automaticRemovalApproved':False}
    (args.output/'report.json').write_text(json.dumps(output,indent=2),encoding='utf-8')
    print(json.dumps(output,indent=2))


if __name__=='__main__':
    main()
