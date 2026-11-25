@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "CreoBridge.exe" (
  "CreoBridge.exe" %*
) else (
  echo CreoBridge.exe not found.
)
pause
