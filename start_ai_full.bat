@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open_ai_once.ps1" -Root "%~dp0" -Full
endlocal
