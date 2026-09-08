from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader
from transformers import Sam2Model, Sam2Processor

from smart_cleanup_agent.defect_dataset import PromptedDefectDataset


def dice_loss(logits, target):
    probability = logits.sigmoid()
    intersection = (probability * target).sum(dim=(-2, -1))
    union = probability.sum(dim=(-2, -1)) + target.sum(dim=(-2, -1))
    return (1 - (2 * intersection + 1) / (union + 1)).mean()


def collate(batch):
    return batch[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--max-steps", type=int, default=0)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    args = parser.parse_args()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dataset = PromptedDefectDataset(args.manifest, "train")
    if not len(dataset):
        raise ValueError("No training records")
    loader = DataLoader(dataset, batch_size=1, shuffle=True, collate_fn=collate)
    processor = Sam2Processor.from_pretrained(args.model, local_files_only=True)
    model = Sam2Model.from_pretrained(args.model, local_files_only=True).to(device)
    for parameter in model.parameters():
        parameter.requires_grad = False
    for parameter in model.mask_decoder.parameters():
        parameter.requires_grad = True
    model.train()
    optimizer = torch.optim.AdamW(model.mask_decoder.parameters(), lr=args.learning_rate)
    history, step = [], 0
    for epoch in range(args.epochs):
        for sample in loader:
            inputs = processor(
                images=sample["image"], input_boxes=[[sample["box"]]], return_tensors="pt",
            ).to(device)
            outputs = model(**inputs, multimask_output=False)
            logits = outputs.pred_masks[:, 0, 0]
            target = torch.from_numpy(sample["mask"])[None, None].to(device)
            protected = torch.from_numpy(sample["protected_mask"])[None, None].to(device)
            target = F.interpolate(target, logits.shape[-2:], mode="nearest")[:, 0]
            protected = F.interpolate(protected, logits.shape[-2:], mode="nearest")[:, 0]
            bce = F.binary_cross_entropy_with_logits(logits, target)
            dice = dice_loss(logits, target)
            protection = (logits.sigmoid() * protected).mean()
            loss = bce + dice + protection * 2.0
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.mask_decoder.parameters(), 1.0)
            optimizer.step()
            step += 1
            history.append({"step": step, "loss": float(loss.detach().cpu())})
            print(json.dumps(history[-1]), flush=True)
            if args.max_steps and step >= args.max_steps:
                break
        if args.max_steps and step >= args.max_steps:
            break
    args.output.mkdir(parents=True, exist_ok=True)
    torch.save(model.mask_decoder.state_dict(), args.output / "mask_decoder.pt")
    (args.output / "training-history.json").write_text(
        json.dumps(history, indent=2), encoding="utf-8"
    )
    print(json.dumps({"steps": step, "output": str(args.output)}))


if __name__ == "__main__":
    main()
