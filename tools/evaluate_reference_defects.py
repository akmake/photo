"""Local SegGPT transfer audit from an explicitly annotated reference.

Reference annotations are approximate development examples, never ground truth.
All target face crops come from saved detections; no target blemish box is used.
Uses the model publisher's processor and palette decoding unchanged.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image, ImageDraw, ImageOps
import torch
from transformers import SegGptForImageSegmentation, SegGptImageProcessor

ROOT = Path(__file__).resolve().parents[1]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('reference', type=Path)
    p.add_argument('targets', nargs='+', type=Path)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--reference-scale-tiles', action='store_true', help='Uniform native tiles at reference size, 50 percent overlap; majority vote in overlaps')
    args = p.parse_args()
    ref = json.loads(args.reference.read_text(encoding='utf-8'))
    source = Path(ref['source'])
    if hashlib.sha256(source.read_bytes()).hexdigest() != ref['sha256']:
        raise ValueError('Reference source mismatch')
    ref_image = ImageOps.exif_transpose(Image.open(source)).convert('RGB').crop(ref['crop'])
    mask_path = args.reference.parent/ref['mask']
    ref_mask = Image.open(mask_path).convert('L')
    if ref_mask.size != ref_image.size or not set(np.unique(ref_mask)).issubset({0, 1}):
        raise ValueError('Reference must be a same-size binary label mask')
    if not np.any(ref_mask):
        raise ValueError('Empty reference')
    model_path = ROOT/'smart-cleanup-agent/models/seggpt-vit-large'
    processor = SegGptImageProcessor.from_pretrained(model_path, local_files_only=True)
    model, loading = SegGptForImageSegmentation.from_pretrained(model_path, local_files_only=True, output_loading_info=True)
    if any(loading[k] for k in ('missing_keys','unexpected_keys','mismatched_keys','error_msgs')):
        raise ValueError(f'Incomplete weights: {loading}')
    torch.set_num_threads(4)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = model.eval().to(device)
    args.output.mkdir(parents=True, exist_ok=True)
    ref_image.save(args.output/'reference.png')
    annotated = np.array(ref_image)
    sel = np.array(ref_mask).astype(bool)
    annotated[sel] = np.rint(.5*annotated[sel]+.5*np.array([255,30,40])).astype(np.uint8)
    Image.fromarray(annotated).save(args.output/'reference-overlay.png')
    records = []
    for path in args.targets:
        report = json.loads(path.read_text(encoding='utf-8'))
        source_path = Path(report['source'])
        if hashlib.sha256(source_path.read_bytes()).hexdigest() != report['sha256']:
            raise ValueError('Target source mismatch')
        image = ImageOps.exif_transpose(Image.open(source_path)).convert('RGB')
        for face in report['faces']:
            crop = image.crop(face['crop'])
            started = time.perf_counter()
            def predict(part):
                inputs = processor(images=part, prompt_images=ref_image, prompt_masks=ref_mask,
                                   num_labels=1, return_tensors='pt').to(device)
                with torch.inference_mode():
                    outputs = model(**inputs)
                return processor.post_process_semantic_segmentation(outputs, [part.size[::-1]], num_labels=1)[0].cpu().numpy().astype(np.uint8)
            tile_count=1
            if args.reference_scale_tiles:
                tw,th=min(ref_image.width,crop.width),min(ref_image.height,crop.height)
                xs=sorted(set(range(0,crop.width-tw+1,max(1,tw//2)))|{crop.width-tw})
                ys=sorted(set(range(0,crop.height-th+1,max(1,th//2)))|{crop.height-th})
                total=np.zeros((crop.height,crop.width),np.float32)
                count=np.zeros_like(total)
                for top in ys:
                    for left in xs:
                        total[top:top+th,left:left+tw]+=predict(crop.crop((left,top,left+tw,top+th)))
                        count[top:top+th,left:left+tw]+=1
                if not np.all(count>0):
                    raise AssertionError('Uncovered tile pixels')
                mask=(total/count>.5).astype(np.uint8)
                tile_count=len(xs)*len(ys)
            else:
                mask=predict(crop)
            key = f"{source_path.stem}-{face['face']}"
            Image.fromarray(mask*255).save(args.output/f'{key}-mask.png')
            rgb = np.array(crop)
            marked = rgb.copy()
            selected = mask == 1
            marked[selected] = np.rint(.5*rgb[selected]+.5*np.array([255,30,40])).astype(np.uint8)
            panel = Image.new('RGB',(crop.width*2,crop.height+30),'white')
            draw = ImageDraw.Draw(panel)
            panel.paste(crop,(0,30)); panel.paste(Image.fromarray(marked),(crop.width,30))
            draw.text((5,5),'Original',fill='black'); draw.text((crop.width+5,5),'Reference transfer prediction',fill='black')
            panel.save(args.output/f'{key}-comparison.png')
            record = {'key':key,'source':str(source_path),'sha256':report['sha256'],'crop':face['crop'],
                      'maskPx':int(selected.sum()),'seconds':round(time.perf_counter()-started,2),'tileCount':tile_count,
                      'sameSourceAsReference':report['sha256']==ref['sha256']}
            records.append(record)
            print(json.dumps(record),flush=True)
            out = {'model':'BAAI/seggpt-vit-large','device':device,'reference':ref,
                   'referenceMaskSha256':hashlib.sha256(mask_path.read_bytes()).hexdigest(),
                   'loading':loading,'faces':records,'referenceScaleTiles':args.reference_scale_tiles,'pixelAccuracyValidated':False,
                   'automaticRemovalApproved':False,'retouchingExecuted':False}
            (args.output/'report.json').write_text(json.dumps(out,indent=2),encoding='utf-8')


if __name__ == '__main__':
    main()
