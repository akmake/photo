from pathlib import Path

from huggingface_hub import snapshot_download


root = Path(__file__).resolve().parents[1] / "models"
root.mkdir(parents=True, exist_ok=True)

models = [
    ("facebook/sam2.1-hiera-small", root / "sam2.1-hiera-small"),
    ("Qwen/Qwen3-VL-4B-Instruct", root / "qwen3-vl-4b"),
]

for repo_id, destination in models:
    print(f"Downloading {repo_id} -> {destination}", flush=True)
    snapshot_download(
        repo_id=repo_id,
        local_dir=destination,
        allow_patterns=["*.json", "*.safetensors", "*.txt", "*.yaml"],
    )

print("All model weights are local.", flush=True)

