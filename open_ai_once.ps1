param(
    [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [switch]$Full
)

$Root = $Root.Trim('"')
if (-not (Test-Path -LiteralPath $Root)) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }

# One main AI window only: close the previous main window, then open a fresh
# one.  Search/QA windows are left alone when their URL contains search/qa.
$edge = @()
try {
    $edge = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -match '127\.0\.0\.1:18766/app/index\.html' -and
            $_.CommandLine -notmatch 'search|qa'
        }
} catch { }
foreach ($e in $edge) {
    try { Stop-Process -Id $e.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
}
Start-Sleep -Milliseconds 300

# Make sure the local API services are actually listening before opening any UI.
$proxyExe = Join-Path $Root 'CreoAiSrv.exe'
if ((Test-Path -LiteralPath $proxyExe) -and -not (Get-Process -Name CreoAiSrv -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $proxyExe -WorkingDirectory $Root -WindowStyle Hidden
}
$bridgeExe = Join-Path $Root 'bridge\CreoBridge.exe'
if ((Test-Path -LiteralPath $bridgeExe) -and -not (Get-Process -Name CreoBridge -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $bridgeExe -WorkingDirectory (Join-Path $Root 'bridge') -WindowStyle Hidden
}
$healthy = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $h = Invoke-RestMethod 'http://127.0.0.1:18766/health' -TimeoutSec 1
        if ($h -and $h.ok) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 250
}

if ($Full) {
    Start-Process -FilePath (Join-Path $Root 'AiAsk.exe') -WorkingDirectory $Root
    return
}

# Native borderless WebView2 host: a real program window, no browser chrome.
$hostExe = Join-Path $Root 'host\CreoAiOrb.exe'
if (Test-Path -LiteralPath $hostExe) {
    Get-Process -Name CreoAiOrb -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 250
    Start-Process -FilePath $hostExe -WorkingDirectory (Join-Path $Root 'host')
    return
}

# Fallback: standalone floating orb in an Edge app window.
$edgeExe = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$edgeExe = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path -LiteralPath $edgeExe)) {
    $edgeExe = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
}
if (-not (Test-Path -LiteralPath $edgeExe)) {
    # Fallback to the old full window if Edge is not in a known location.
    Start-Process -FilePath (Join-Path $Root 'AiAsk.exe') -WorkingDirectory $Root
    return
}

$profile = Join-Path $Root 'temp\edge_profile'
if (-not (Test-Path -LiteralPath $profile)) {
    New-Item -ItemType Directory -Path $profile -Force | Out-Null
}

$posX = 900
$posY = 500
try {
    Add-Type -AssemblyName System.Windows.Forms
    $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $posX = [Math]::Max(0, $wa.Right - 96 - 30)
    $posY = [Math]::Max(0, $wa.Bottom - 96 - 60)
} catch { }

$url = 'http://127.0.0.1:18766/app/index.html?orb=1'
$args = @(
    "--app=$url",
    '--window-size=96,96',
    "--window-position=$posX,$posY",
    "--user-data-dir=$profile",
    '--no-first-run',
    '--disable-features=msEdgeSidebarV2'
)

Start-Process -FilePath $edgeExe -ArgumentList $args -WorkingDirectory $Root

# Keep the orb above Creo.  The page itself moves/resizes this window.
Start-Sleep -Milliseconds 1600
try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OriWin32 {
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
    $win = Get-Process -Name msedge -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -eq '霜刃 AI' } |
        Select-Object -First 1
    if ($win -and $win.MainWindowHandle -ne 0) {
        [OriWin32]::SetWindowPos($win.MainWindowHandle, [IntPtr](-1), 0, 0, 0, 0, 3) | Out-Null
    }
} catch { }
