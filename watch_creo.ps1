param(
    [Parameter(Mandatory = $true)][int]$CreoPid,
    [string]$PackageRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$PackageRoot = $PackageRoot.Trim('"')

# Watch the Creo process started by launch_creo.ps1.  When Creo exits, close
# the AI window and stop the local bridge/proxy so the whole assistant shuts
# down together with Creo instead of lingering in the background.

$log = Join-Path $PackageRoot 'temp\watch_creo.log'
function Write-Log([string]$msg) {
    try {
        $dir = Split-Path -Parent $log
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $msg) -Encoding UTF8
    } catch { }
}

Write-Log ('watching Creo PID ' + $CreoPid)
try {
    Wait-Process -Id $CreoPid -ErrorAction Stop
} catch {
    Write-Log 'Creo process was already gone'
}

Start-Sleep -Milliseconds 300
Write-Log 'Creo exited; restoring packaged ribbon UI'

# Creo rewrites creo_parametric_customization.ui on exit and can lose the
# AI button's icon/label.  Restore the packaged master so the next start
# always shows the correct 霜刃AI助手 button.
$master = Join-Path $PackageRoot 'jlink\creo_parametric_customization.ui'
if (Test-Path -LiteralPath $master) {
    foreach ($sub in @('', 'work', 'work\models')) {
        $dir = Join-Path $PackageRoot $sub
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        Copy-Item -LiteralPath $master -Destination (Join-Path $dir 'creo_parametric_customization.ui') -Force
    }
    Write-Log 'packaged ribbon UI restored'
}

Write-Log 'closing AI window'

# 1) AI app-mode browser windows (Edge / Chromium).
$browserProcs = @()
try {
    $browserProcs = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match '127\.0\.0\.1:18766/app/' -or $_.CommandLine -match 'edge_profile' }
} catch { }
foreach ($bp in $browserProcs) {
    try { Stop-Process -Id $bp.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
}

# 2) Any Edge/Chromium window whose title is the assistant page.
try {
    Get-Process -Name msedge -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -match 'CreoAI助手|霜刃AI助手' } |
        ForEach-Object {
            try {
                $null = $_.CloseMainWindow()
                Start-Sleep -Milliseconds 600
                if (-not $_.HasExited) { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
            } catch { }
        }
} catch { }

# 3) WebView2 host used by AiAsk.exe, if present.
try {
    Get-Process -Name AiAsk -ErrorAction SilentlyContinue |
        ForEach-Object {
            try {
                $null = $_.CloseMainWindow()
                Start-Sleep -Milliseconds 400
                if (-not $_.HasExited) { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
            } catch { }
        }
} catch { }

# 4) Stop the local bridge and proxy so ports are released.
#    pfclscom.exe is the VB API COM server.  If it outlives the Creo session it
#    keeps a dead connection, and the next Connect() fails with
#    pfcExceptions::XToolkitCantModify until it is killed.
Start-Sleep -Seconds 1
foreach ($name in @('CreoBridge', 'CreoAiSrv', 'BomTree', 'pfclscom')) {
    try {
        Get-Process -Name $name -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
    } catch { }
}

Write-Log 'AI window and bridge stopped'
