"""Audit learned detector proposals with local visual context; never authorize repair.

The enlarged detail is only a viewing aid, not newly recovered image detail.
All proposals, including one-pixel regions, are retained in the audit.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

from PIL import Image, ImageDraw, ImageOps
import torch
from transformers import AutoModelForImageTextToText, AutoProcessor

ROOT = Path(__file__).resolve().parents[1]
PROMPT = '''The first image shows a face and a red rectangle identifying a candidate
region. The second is an unmarked enlargement of the surrounding detail. The
candidate is not necessarily a defect. Describe the visible feature inside the
rectangle and classify it as temporary_material, possible_blemish,
permanent_mark, hair_or_anatomy, normal_skin_or_lighting, or uncertain.
Preserve moles, freckles, beard, eyelashes, eyebrows, skin texture and facial
features. A dark dot alone is not evidence of a temporary blemish. If you cannot
distinguish the feature, choose uncertain. Do not infer disease, age or identity.
Return JSON only: {"category":"one category above","evidence":"brief visual
description","temporary_evidence":true or false}.'''
CATEGORIES = {'temporary_material', 'possible_blemish', 'permanent_mark',
              'hair_or_anatomy', 'normal_skin_or_lighting', 'uncertain'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('detection_report', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = json.loads(args.detection_report.read_text(encoding='utf-8'))
    source_path = Path(report['source'])
    if hashlib.sha256(source_path.read_bytes()).hexdigest() != report['sha256']:
        raise ValueError('Source changed since detection')
    source = ImageOps.exif_transpose(Image.open(source_path)).convert('RGB')
    args.output.mkdir(parents=True, exist_ok=True)
    model_path = ROOT / 'smart-cleanup-agent/models/qwen3-vl-4b'
    processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
    model = AutoModelForImageTextToText.from_pretrained(
        model_path, local_files_only=True, device_map='auto', dtype=torch.bfloat16).eval()
    records = []
    for index, component in enumerate(report['components'], 1):
        started = time.perf_counter()
        face_index = int(component['face'].split('-')[-1]) - 1
        face_box = report['faceCrops'][face_index]
        face = source.crop(face_box)
        x0, y0, x1, y1 = component['box']
        # Fixed context rule for every candidate, independent of desired result.
        side = max(64, 8 * max(x1-x0, y1-y0))
        cx, cy = (x0+x1)//2, (y0+y1)//2
        detail_box = [max(0, cx-side//2), max(0, cy-side//2),
                      min(source.width, cx+(side+1)//2),
                      min(source.height, cy+(side+1)//2)]
        detail = source.crop(detail_box)
        marked = face.copy()
        ImageDraw.Draw(marked).rectangle(
            [x0-face_box[0], y0-face_box[1], x1-face_box[0], y1-face_box[1]],
            outline='red', width=1)
        detail_view = ImageOps.contain(detail, (512, 512), Image.Resampling.LANCZOS)
        face_view = ImageOps.contain(marked, (768, 768), Image.Resampling.LANCZOS)
        messages = [{'role': 'user', 'content': [
            {'type': 'image', 'image': face_view},
            {'type': 'image', 'image': detail_view},
            {'type': 'text', 'text': PROMPT}]}]
        inputs = processor.apply_chat_template(messages, add_generation_prompt=True,
            tokenize=True, return_dict=True, return_tensors='pt').to(model.device)
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=220, do_sample=False)
        answer = processor.decode(generated[0][inputs['input_ids'].shape[-1]:],
                                  skip_special_tokens=True)
        (args.output / f'candidate-{index:02d}.txt').write_text(answer, encoding='utf-8')
        result = json.loads(answer[answer.find('{'):answer.rfind('}')+1])
        if result.get('category') not in CATEGORIES or type(result.get('temporary_evidence')) is not bool:
            raise ValueError(f'Invalid classification: {result}')
        contradiction = result['temporary_evidence'] and result['category'] not in {
            'temporary_material', 'possible_blemish'}
        record = {**component, 'index': index, 'detailBox': detail_box,
                  'internallyConsistent': not contradiction,
                  'assessment': result, 'seconds': round(time.perf_counter()-started, 2)}
        records.append(record)
        panel = Image.new('RGB', (1024, 560), 'white')
        panel.paste(ImageOps.pad(face_view, (512, 512), color='white'), (0, 32))
        panel.paste(ImageOps.pad(detail_view, (512, 512), color='white'), (512, 32))
        ImageDraw.Draw(panel).text((8, 8), f'{index}: {result["category"]}', fill='black')
        panel.save(args.output / f'candidate-{index:02d}.png')
        print(json.dumps(record), flush=True)
    audit = {'source': report['source'], 'sha256': report['sha256'],
             'detectorReport': str(args.detection_report.resolve()), 'prompt': PROMPT,
             'model': str(model_path), 'candidates': records,
             'automaticRemovalApproved': False, 'semanticAccuracyValidated': False}
    (args.output / 'report.json').write_text(json.dumps(audit, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
