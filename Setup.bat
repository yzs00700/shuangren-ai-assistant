@echo off
chcp 437 >nul
title Creo AI Assistant Setup
echo ============================================
echo   Creo AI Assistant Portable Setup
echo   No JVM, no Toolkit, no Python runtime.
echo   The package stays on its own drive.
echo   The machine's C: config.pro is read only.
echo ============================================
echo.

del "%~dp0setup.result.txt" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jlink\setup_core.ps1"
set RC=%errorlevel%

if not "%RC%"=="0" (
    echo.
    echo [FAILED] See messages above.
    if exist "%~dp0setup.result.txt" type "%~dp0setup.result.txt"
    pause
    exit /b %RC%
)

echo.
echo ============================================
echo   INSTALL OK!
echo.
echo   1. Close Creo completely.
echo   2. Double-click start_creo_ai.bat in this
echo      folder.  It starts Creo with the
echo      package config.pro (GB drawing setup,
echo      HelloCreo plugin, AI mapkeys).
echo   3. In Creo press a-i to open the AI
echo      window, or run start_ai.bat directly.
echo.
echo   Do not use the old desktop Creo shortcut
echo   if you want the package AI mapkeys; that
echo   shortcut reads the C: config instead.
echo ============================================
pause
