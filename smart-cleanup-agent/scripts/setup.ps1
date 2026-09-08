$ErrorActionPreference = "Stop"
$AgentRoot = Split-Path -Parent $PSScriptRoot
$Python = "C:\Users\yosef dahan\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (-not (Test-Path $Python)) {
  throw "Python 3.11 or 3.12 is required. Update `$Python in scripts/setup.ps1."
}

& $Python -m venv "$AgentRoot\.venv"
$VenvPython = "$AgentRoot\.venv\Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
& $VenvPython -m pip install -e "$AgentRoot[test]"

Write-Host "Standalone environment is ready. Models download on first run."

