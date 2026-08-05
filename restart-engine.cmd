@echo off
REM Double-click this to restart the local engine.
REM
REM The work is in engine\restart_engine.ps1 -- a .cmd is here only because a
REM .ps1 is not double-clickable on Windows, it opens in an editor.
REM
REM `pause` at the end on purpose: if the engine dies on startup, the window
REM has to stay open long enough to read WHY. A restart script that flashes a
REM window and vanishes is how a crash becomes "it just does not work".
title TEZA engine
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0engine\restart_engine.ps1"
echo.
echo The engine has stopped.
pause
