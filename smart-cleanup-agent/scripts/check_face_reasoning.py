from __future__ import annotations

import argparse
from pathlib import Path

import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor


PROMPT = """
You are the semantic verification stage of a professional portrait retouching system.
The image is a montage of four enlarged face crops labeled face-1 through face-4.
Inspect facial SKIN only, at high detail. Identify temporary removable material or marks:
dirt, food, saliva/drool, mucus, a scratch-like temporary light/dark streak, or a distinct
temporary blemish. Ignore normal anatomy, freckles/moles, eyes, eyelashes, eyebrows,
lips, teeth, hair, lighting gradients, and ordinary skin texture.

Return JSON only:
{"faces":[{"id":"face-1","removable_marks":[{"description":"...","location":"precise plain-language facial location","confidence":0.0}]}]}
Include every face. Use an empty removable_marks list only after carefully checking the
forehead, both cheeks, nose area, around the mouth, and chin.
""".strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    processor = AutoProcessor.from_pretrained(args.model, local_files_only=True)
    model = AutoModelForImageTextToText.from_pretrained(
        args.model, local_files_only=True, device_map="auto", dtype=torch.bfloat16
    ).eval()
    image = Image.open(args.image).convert("RGB")
    messages = [{"role": "user", "content": [
        {"type": "image", "image": image},
        {"type": "text", "text": PROMPT},
    ]}]
    inputs = processor.apply_chat_template(
        messages, add_generation_prompt=True, tokenize=True,
        return_dict=True, return_tensors="pt",
    ).to(model.device)
    with torch.inference_mode():
        generated = model.generate(**inputs, max_new_tokens=700, do_sample=False)
    answer = processor.decode(
        generated[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True
    )
    args.output.write_text(answer, encoding="utf-8")
    print(answer)


if __name__ == "__main__":
    main()
