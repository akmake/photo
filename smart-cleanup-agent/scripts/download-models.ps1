$ErrorActionPreference = "Stop"
$AgentRoot = Split-Path -Parent $PSScriptRoot
& "$AgentRoot\.venv\Scripts\python.exe" "$PSScriptRoot\download_models.py"
if ($LASTEXITCODE -ne 0) { throw "Model download failed." }

