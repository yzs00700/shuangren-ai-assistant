@echo off
chcp 437 >nul
title Creo AI Assistant Uninstall
echo ============================================
echo   Creo AI Assistant Portable Uninstall
echo   Stops the AI proxy / bridge / browser.
echo   C: config.pro and mapkeys.pro are NOT touched.
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0jlink\uninstall_core.ps1"
echo.
pause
