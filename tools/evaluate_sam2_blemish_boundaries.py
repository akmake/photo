"""Diagnostic SAM2 masks for six explicit blemishes; not automatic cleanup."""
from pathlib import Path
import argparse
import hashlib
import json
import time
import numpy as np
from PIL import Image, ImageOps, ImageDraw
import torch
from transformers import Sam2Model, Sam2Processor

ROOT = Path(__file__).resolve().parents[1]
POINTS = [(1004,940,17),(1226,694,14),(1191,758,16),
          (808,637,15),(1156,389,13),(969,413,13)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('image', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    started = time.perf_counter()
    source = ImageOps.exif_transpose(Image.open(args.image)).convert('RGB')
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    path = ROOT/'smart-cleanup-agent/models/sam2.1-hiera-small'
    processor = Sam2Processor.from_pretrained(path, local_files_only=True)
    model, loading = Sam2Model.from_pretrained(path, local_files_only=True, output_loading_info=True)
    if loading.get('missing_keys') or loading.get('mismatched_keys') or loading.get('error_msgs'):
        raise RuntimeError(f'Incomplete pretrained image model: {loading}')
    model = model.to(device).eval()
    args.output.mkdir(parents=True, exist_ok=True)
    panel = Image.new('RGB', (256*3, 280*len(POINTS)), 'white')
    draw = ImageDraw.Draw(panel)
    records = []
    for index, (x,y,r) in enumerate(POINTS):
        # Crop at native resolution to give a small lesion adequate model area.
        left, top = max(0,x-128), max(0,y-128)
        crop = source.crop((left,top,min(source.width,left+256),min(source.height,top+256)))
        cx,cy = x-left,y-top
        inputs = processor(images=crop,
            input_boxes=[[[cx-r,cy-r,cx+r,cy+r]]],
            return_tensors='pt').to(device)
        with torch.inference_mode():
            output = model(**inputs, multimask_output=False)
        mask = processor.post_process_masks(output.pred_masks.cpu(),inputs['original_sizes'])[0][0,0].numpy().astype(bool)
        rgb = np.array(crop)
        overlay = rgb.copy()
        overlay[mask] = np.rint(.5*rgb[mask]+.5*np.array([255,30,40])).astype(np.uint8)
        boxview = crop.copy()
        ImageDraw.Draw(boxview).rectangle((cx-r,cy-r,cx+r,cy+r),outline='yellow',width=1)
        row = index*280
        for col,img in enumerate((crop,boxview,Image.fromarray(overlay))):
            panel.paste(img,(col*256,row+24))
        draw.text((4,row+4),f'{index+1}: original / manual prompt / predicted mask',fill='black')
        Image.fromarray(mask.astype(np.uint8)*255).save(args.output/f'mask-{index+1}.png')
        records.append({'center':[x,y],'promptRadius':r,'cropOrigin':[left,top],
                        'maskPixels':int(mask.sum()),'modelIoUScore':float(output.iou_scores.flatten()[0])})
    panel.save(args.output/'comparison.png')
    report = {'source':str(args.image.resolve()),'sha256':hashlib.sha256(args.image.read_bytes()).hexdigest(),
              'device':device,'seconds':round(time.perf_counter()-started,2),'manualPrompts':True,
              'pixelAccuracyValidated':False,'loading':loading,'cases':records}
    (args.output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    main()
