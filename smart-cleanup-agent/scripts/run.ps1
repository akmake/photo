$ErrorActionPreference = "Stop"
$AgentRoot = Split-Path -Parent $PSScriptRoot
$env:SMART_CLEANUP_MODEL_DIR = "$AgentRoot\models"
$env:SMART_CLEANUP_RUN_DIR = "$AgentRoot\runs"
$env:SMART_CLEANUP_VISION_MODEL = "$AgentRoot\models\qwen3-vl-4b"
$env:SMART_CLEANUP_SEGMENT_MODEL = "$AgentRoot\models\sam2.1-hiera-small"
& "$AgentRoot\.venv\Scripts\python.exe" -m uvicorn smart_cleanup_agent.server:app --host 127.0.0.1 --port 8765

