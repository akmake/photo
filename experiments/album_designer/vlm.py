"""The designer's eyes and judgement: Qwen3-VL-4B-Instruct, local, CPU.

Experiment only — not wired into the product. See docs/ALBUM-DESIGNER-TIMELINE.md.
"""
import json
import os
import re
import time

import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(HERE, "..", "..", "engine", "models", "qwen3-vl-4b-instruct")

_model = None
_proc = None


def load(dtype=torch.bfloat16):
    global _model, _proc
    if _model is None:
        torch.set_num_threads(os.cpu_count() or 4)
        _proc = AutoProcessor.from_pretrained(MODEL_DIR)
        _model = AutoModelForImageTextToText.from_pretrained(MODEL_DIR, dtype=dtype)
        _model.eval()
    return _model, _proc


def ask(prompt, images=(), max_new_tokens=300, image_px=448):
    """One question, optional images (PIL or paths). Returns (text, seconds)."""
    model, proc = load()
    content = []
    for im in images:
        if isinstance(im, str):
            im = Image.open(im)
        im = im.convert("RGB")
        im.thumbnail((image_px, image_px))
        content.append({"type": "image", "image": im})
    content.append({"type": "text", "text": prompt})
    msgs = [{"role": "user", "content": content}]
    inputs = proc.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True,
                                      return_dict=True, return_tensors="pt")
    t = time.time()
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
    text = proc.batch_decode(out[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0]
    return text.strip(), time.time() - t


def json_of(text):
    m = re.search(r"(\{.*\}|\[.*\])", text, re.S)
    if not m:
        raise ValueError(f"no JSON in: {text[:200]}")
    return json.loads(m.group(1))
