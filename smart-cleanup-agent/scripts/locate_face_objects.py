from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor


def parse_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    return json.loads(text[text.find("{"):text.rfind("}") + 1])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    image = Image.open(args.image).convert("RGB")
    width, height = image.size
    prompt = f"""
This is one enlarged face crop, exactly {width}x{height} pixels. Act as a professional
retoucher. Find each COMPLETE temporary skin object (wound/scab/scratch, dirt, food,
saliva, mucus, or blemish). Treat a long continuous wound as ONE object, not as small
bright fragments. For every object return a tight box covering it from its first visible
pixel to its last visible pixel. Coordinates refer to this exact {width}x{height} image.
Ignore eyes, brows, lips, hair, moles, normal highlights, and ordinary texture.
JSON only: {{"objects":[{{"type":"wound_or_scab|dirt|saliva|blemish|other","description":"...","box":{{"x1":0,"y1":0,"x2":1,"y2":1}},"confidence":0.0}}]}}
""".strip()
    processor = AutoProcessor.from_pretrained(args.model, local_files_only=True)
    model = AutoModelForImageTextToText.from_pretrained(
        args.model, local_files_only=True, device_map="auto", dtype=torch.bfloat16,
    ).eval()
    messages = [{"role": "user", "content": [
        {"type": "image", "image": image}, {"type": "text", "text": prompt},
    ]}]
    inputs = processor.apply_chat_template(
        messages, add_generation_prompt=True, tokenize=True,
        return_dict=True, return_tensors="pt",
    ).to(model.device)
    with torch.inference_mode():
        generated = model.generate(**inputs, max_new_tokens=450, do_sample=False)
    answer = processor.decode(
        generated[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True,
    )
    payload = parse_json(answer)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
