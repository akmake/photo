@echo off
REM Starts the frontend (Vite) and the Python engine sidecar, each in its own
REM window so you can watch both logs live.

cd /d "%~dp0"

start "engine (python:8756)" cmd /k "cd /d "%~dp0engine" && .venv\Scripts\python.exe server.py"
start "frontend (vite:5173)" cmd /k "cd /d "%~dp0" && npm run dev"

echo Started both windows: engine (python:8756) and frontend (vite:5173).
