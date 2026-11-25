@echo off
setlocal
cd /d "%~dp0"

rem Portable Creo + AI launcher.
rem Creo is started with this folder as its working directory, so Creo reads
rem the package config.pro instead of the machine's C: config.  All temporary
rem files and the browser profile stay inside the package.

if not exist "%~dp0temp" mkdir "%~dp0temp"
if not exist "%~dp0work\models" mkdir "%~dp0work\models"
if not exist "%~dp0work\frames" mkdir "%~dp0work\frames"
set "TEMP=%~dp0temp"
set "TMP=%~dp0temp"

echo [1/3] Starting local AI proxy and bridge...
tasklist /FI "IMAGENAME eq CreoAiSrv.exe" 2>nul | find /I "CreoAiSrv.exe" >nul
if errorlevel 1 start "" /min "%~dp0CreoAiSrv.exe"

if exist "%~dp0bridge\CreoBridge.exe" (
  netstat -ano | findstr ":18766" >nul
  if errorlevel 1 (
    tasklist /FI "IMAGENAME eq CreoBridge.exe" 2>nul | find /I "CreoBridge.exe" >nul
    if errorlevel 1 start "" /min "%~dp0bridge\CreoBridge.exe"
  )
)

rem ---- BomTree VB API helper (multi-level assembly BOM, port 18767) --------
rem The packaged CreoBridge only exposes the top-level components of the active
rem assembly.  BomTree walks sub-assemblies through the same VB API so the BOM
rem tool can expand N levels.  pfclscom.exe locates pro_comm_msg.exe through
rem PRO_COMM_MSG_EXE; resolve it from the registry when it is not already set.
if not defined PRO_COMM_MSG_EXE (
  for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\PTC\PTC Creo Parametric" /s /v InstallLocation 2^>nul ^| findstr /i "InstallLocation"') do (
    if exist "%%B\..\Common Files\x86e_win64\obj\pro_comm_msg.exe" (
      set "PRO_COMM_MSG_EXE=%%B\..\Common Files\x86e_win64\obj\pro_comm_msg.exe"
    )
  )
)
if defined PRO_COMM_MSG_EXE (
  for %%P in ("%PRO_COMM_MSG_EXE%") do set "PRO_COMM_MSG_EXE=%%~fP"
)
if exist "%~dp0toolbox\BomTree.exe" (
  netstat -ano | findstr ":18767" >nul
  if errorlevel 1 (
    tasklist /FI "IMAGENAME eq BomTree.exe" 2>nul | find /I "BomTree.exe" >nul
    if errorlevel 1 start "" /min "%~dp0toolbox\BomTree.exe"
  )
)

rem ping is used instead of timeout /t: timeout needs console input and
rem fails with "Input redirection is not supported" in automated shells.
ping -n 3 127.0.0.1 >nul

echo [2/3] Starting Creo with the portable config...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_creo.ps1"
set RC=%errorlevel%

if "%RC%"=="0" (
  echo [3/3] Waiting for Creo to finish loading...
  ping -n 9 127.0.0.1 >nul
) else (
  echo [3/3] Creo was not started by this script.  Opening the AI window only.
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open_ai_once.ps1" -Root "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_watch.ps1" -Root "%~dp0"
endlocal
