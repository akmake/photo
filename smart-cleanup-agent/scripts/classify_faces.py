"""Full classification pass, per face. Classification only - nothing is masked,
nothing is cleaned, the source image is never written to.

Two axes, because one of them was missing everywhere in this tool:
  1. WHAT is it   - a type from the fixed taxonomy below
  2. IS IT HIM    - temporary (remove) vs permanent (part of the person, keep)

The taxonomy is fixed here on purpose. Until now it existed as free text in the
verifier's prompt and as a slightly different list in the annotator, so nothing
could be counted, compared between runs, or turned into training labels.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageOps
from transformers import AutoModelForImageTextToText, AutoProcessor

from smart_cleanup_agent.face_analysis import FaceDetector

TEMPORARY = {
    "wound_scab": "wound, scab or healing mark",
    "blemish": "pimple, papule or temporary spot",
    "scratch": "scratch or graze",
    "dirt_food": "dirt, food, crumbs or dust on the skin",
    "saliva_mucus": "saliva, drool, mucus or any wet trail",
    "stain_mark": "temporary stain, ink, paint or coloured smear",
    "other_temporary": "any other temporary thing that is not part of the person",
}
PERMANENT = {
    "mole": "mole or beauty spot",
    "freckles": "freckles",
    "birthmark": "birthmark",
    "old_scar": "healed permanent scar",
    "wrinkle_line": "wrinkle or expression line",
    "makeup": "deliberate makeup",
    "skin_texture": "ordinary skin texture, pores, redness or blotchiness",
    "light_shadow": "highlight, shine or shadow from the lighting",
    "hair": "hair, eyebrow, eyelash or stray strand",
}

FEED = 1008


def build_prompt() -> str:
    temp = "\n".join(f"  {k} = {v}" for k, v in TEMPORARY.items())
    perm = "\n".join(f"  {k} = {v}" for k, v in PERMANENT.items())
    return (
        "You are the classification stage of a professional portrait-retouching system.\n"
        "This is one enlarged crop of a single face. Examine the FACIAL SKIN closely and "
        "list everything you can see on it that is not plain, unmarked skin.\n\n"
        "Classify each thing you list into exactly one type.\n\n"
        f"TEMPORARY - happened to the person, a retoucher would remove it:\n{temp}\n\n"
        f"PERMANENT - part of who the person is, must NEVER be removed:\n{perm}\n\n"
        "Rules:\n"
        "- A long continuous mark is ONE entry, not several.\n"
        "- If you are not sure whether something is temporary or permanent, say "
        "uncertain and explain what would settle it.\n"
        "- Do not invent anything. If the skin is clean, return an empty list.\n"
        "- Judge the skin only. Do not list the eyes, teeth or clothing.\n\n"
        'Output JSON only:\n'
        '{"findings":[{"type":"<one type id>","permanence":"temporary|permanent|uncertain",'
        '"region":"forehead|left_cheek|right_cheek|nose|around_mouth|chin|jaw|temple",'
        '"description":"what you actually see","confidence":0.0}]}'
    )


def parse(text: str) -> list[dict]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError(f"classifier did not return JSON: {text[:200]}")
    return json.loads(cleaned[start:end + 1]).get("findings", [])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    pil = ImageOps.exif_transpose(Image.open(args.image)).convert("RGB")
    bgr = cv2.cvtColor(np.asarray(pil), cv2.COLOR_RGB2BGR)
    faces = FaceDetector().detect(pil)
    print(f"faces: {len(faces)}", flush=True)

    processor = AutoProcessor.from_pretrained(args.model, local_files_only=True)
    model = AutoModelForImageTextToText.from_pretrained(
        args.model, local_files_only=True, device_map="auto", dtype=torch.bfloat16,
    ).eval()
    prompt = build_prompt()

    known = set(TEMPORARY) | set(PERMANENT)
    report = {"source": str(args.image), "cleaning_performed": False,
              "taxonomy": {"temporary": list(TEMPORARY), "permanent": list(PERMANENT)},
              "faces": []}
    panels = []

    for face in faces:
        x1, y1, x2, y2 = face.crop_box
        crop = bgr[y1:y2, x1:x2].copy()
        scale = FEED / max(crop.shape[:2])
        fed = cv2.resize(crop, (round(crop.shape[1] * scale), round(crop.shape[0] * scale)),
                         interpolation=cv2.INTER_AREA)
        messages = [{"role": "user", "content": [
            {"type": "image", "image": Image.fromarray(cv2.cvtColor(fed, cv2.COLOR_BGR2RGB))},
            {"type": "text", "text": prompt},
        ]}]
        inputs = processor.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=True,
            return_dict=True, return_tensors="pt",
        ).to(model.device)
        with torch.inference_mode():
            generated = model.generate(**inputs, max_new_tokens=700, do_sample=False)
        answer = processor.decode(
            generated[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True
        ).strip()

        try:
            findings = parse(answer)
        except (ValueError, json.JSONDecodeError) as exc:
            findings = []
            print(f"{face.id}: UNPARSED - {exc}", flush=True)

        for item in findings:
            item["type_known"] = item.get("type") in known
        report["faces"].append({
            "face_id": face.id, "box": list(face.box),
            "findings": findings, "raw_answer": answer,
        })

        print(f"\n=== {face.id} ===", flush=True)
        for item in findings:
            flag = "" if item.get("type_known") else "  <-- TYPE NOT IN TAXONOMY"
            print(f"  [{item.get('permanence','?'):9}] {str(item.get('type','?')):16} "
                  f"{str(item.get('region','?')):13} conf={item.get('confidence','?'):<5} "
                  f"{item.get('description','')}{flag}", flush=True)
        if not findings:
            print("  (clean - nothing listed)", flush=True)

        panel = crop.copy()
        temporary = [f for f in findings if f.get("permanence") == "temporary"]
        permanent = [f for f in findings if f.get("permanence") == "permanent"]
        uncertain = [f for f in findings if f.get("permanence") == "uncertain"]
        colour = (0, 40, 255) if temporary else ((0, 200, 255) if uncertain else (60, 200, 60))
        cv2.rectangle(panel, (0, 0), (panel.shape[1] - 1, panel.shape[0] - 1), colour, 6)
        lines = [f"{face.id}: {len(temporary)} temp / {len(permanent)} perm / {len(uncertain)} unc"]
        lines += [f"- {f.get('type')} ({f.get('region')})" for f in temporary + uncertain]
        for row, line in enumerate(lines[:7]):
            y = 30 + row * 26
            cv2.putText(panel, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4, cv2.LINE_AA)
            cv2.putText(panel, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, colour, 1, cv2.LINE_AA)
        panels.append(cv2.resize(panel, (560, 700), interpolation=cv2.INTER_AREA))

    if panels:
        cv2.imwrite(str(args.output / "classification.jpg"), np.hstack(panels))
    (args.output / "classification.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    total = sum(len(f["findings"]) for f in report["faces"])
    print(json.dumps({"faces": len(faces), "findings": total,
                      "output": str(args.output)}), flush=True)


if __name__ == "__main__":
    main()
