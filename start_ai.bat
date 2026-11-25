@echo off
setlocal
cd /d "%~dp0"

rem Keep every temporary file inside the portable package.  The proxy, the
rem bridge and the browser profile all inherit these values.
if not exist "%~dp0temp" mkdir "%~dp0temp"
if not exist "%~dp0work\models" mkdir "%~dp0work\models"
if not exist "%~dp0work\frames" mkdir "%~dp0work\frames"
set "TEMP=%~dp0temp"
set "TMP=%~dp0temp"

rem Local AI proxy (CreoAiSrv.exe)
tasklist /FI "IMAGENAME eq CreoAiSrv.exe" 2>nul | find /I "CreoAiSrv.exe" >nul
if errorlevel 1 start "" /min "%~dp0CreoAiSrv.exe"

rem ---- Creo VB API (pfcls) ------------------------------------------------
rem pfclscom.exe locates pro_comm_msg.exe through PRO_COMM_MSG_EXE.  The VB
rem API installer normally sets it; resolve it from the registry when it is
rem missing so a copied package still connects.
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

rem CreoBridge (library / command / drawing bridge + chat UI host)
rem Do not use netstat here: a TIME_WAIT socket on 18766 made the old check
rem think the bridge was already running, so the orb opened a "cannot reach
rem page" window.  The process check is the reliable one.
if exist "%~dp0bridge\CreoBridge.exe" (
  tasklist /FI "IMAGENAME eq CreoBridge.exe" 2>nul | find /I "CreoBridge.exe" >nul
  if errorlevel 1 start "" /min "%~dp0bridge\CreoBridge.exe"
)

rem ---- BomTree VB API helper (multi-level assembly BOM, port 18767) --------
rem Expands sub-assemblies so the BOM tool can import N levels instead of only
rem the top level.  Kept separate from CreoBridge; the front end falls back to
rem the top-level list when this helper is not running.
if exist "%~dp0toolbox\BomTree.exe" (
  tasklist /FI "IMAGENAME eq BomTree.exe" 2>nul | find /I "BomTree.exe" >nul
  if errorlevel 1 start "" /min "%~dp0toolbox\BomTree.exe"
)

rem AiAsk.exe waits for /health itself and then opens
rem http://127.0.0.1:18766/app/index.html in Edge app mode.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open_ai_once.ps1" -Root "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_watch.ps1" -Root "%~dp0"
endlocal
