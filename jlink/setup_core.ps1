# CreoAiAsk portable installer.
#
# Green/portable rules:
#   * the package stays on its own drive (F: by default);
#   * the machine's C: config.pro is READ ONLY - it is copied into the
#     package config.pro, never modified;
#   * AI mapkeys live in the package Mapkeys.pro, not in C: mapkeys.pro;
#   * no Python / JVM / Toolkit runtime is required.
$ErrorActionPreference = 'Stop'
$pkg = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Fail($msg) { Write-Output ('FAIL: ' + $msg); exit 1 }

# ---- 1) required files ----
foreach ($f in @(
    'AiAsk.exe',
    'app\index.html',
    'ai_config.ini',
    'bridge\CreoBridge.exe',
    'start_ai.bat',
    'start_creo_ai.bat',
    'launch_creo.ps1',
    'jlink\make_portable_config.ps1'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $pkg $f))) {
        Fail ($f + ' not found in ' + $pkg)
    }
}

# ---- 2) space-free location ----
# Creo mapkeys are sensitive to spaces and backslashes, so keep the package
# in a space-free folder.  No administrator rights are needed for this copy.
$base = $pkg
if ($base -match ' ') {
    $dst = $base.Substring(0, 2) + '\CreoAiAsk_Green'
    Write-Output ('Space in path; deploying to ' + $dst)
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    Copy-Item -Path (Join-Path $pkg '*') -Destination $dst -Recurse -Force
    $base = $dst
}
$result = Join-Path $base 'setup.result.txt'

# ---- 3) package-local config.pro (C: config is read only) ----
& (Join-Path $base 'jlink\make_portable_config.ps1') -PackageRoot $base
if (-not (Test-Path -LiteralPath (Join-Path $base 'config.pro'))) {
    Fail 'config.pro was not generated'
}
Write-Output 'portable config.pro generated (C: config untouched)'

# ---- 3b) keep CreoToolbox's own config inside the package ----
# CreoToolbox looks for ai_config.ini next to its exe first; without this copy
# it may fall back to %APPDATA%\CreoToolbox on the C: drive.
$toolboxDir = Join-Path $base 'toolbox'
if (Test-Path -LiteralPath $toolboxDir) {
    Copy-Item -LiteralPath (Join-Path $base 'ai_config.ini') `
        -Destination (Join-Path $toolboxDir 'ai_config.ini') -Force
    Write-Output 'toolbox\ai_config.ini copied (no C: fallback)'
}

# ---- 3c) ribbon button (AI助手) ----
# The .ui file is the Creo ribbon customization.  It is loaded from the run
# directory because make_portable_config.ps1 writes
# load_ui_customization_run_dir yes.  Keeping it in the package means the
# button works without writing to the user's C: profile.
$uiSrc = Join-Path $base 'jlink\creo_parametric_customization.ui'
$uiDst = Join-Path $base 'creo_parametric_customization.ui'
if (Test-Path -LiteralPath $uiSrc) {
    Copy-Item -LiteralPath $uiSrc -Destination $uiDst -Force
    Write-Output 'ribbon customization copied (AI助手 button)'
} else {
    Write-Output 'WARNING: jlink\creo_parametric_customization.ui not found; ribbon button not installed.'
}

# ---- 3d) integrate the button into the Creo user profile ----
# Creo loads its user-profile UI even when it is started from the normal
# desktop icon.  Copying the packaged UI and the aiask mapkey there makes the
# ribbon button available without a separate launcher shortcut.
$settings = Join-Path $env:APPDATA 'PTC\ProENGINEER\Wildfire\.wf\.Settings'
if ((Test-Path -LiteralPath $settings) -and (Test-Path -LiteralPath $uiDst)) {
    $profUi = Join-Path $settings 'creo_parametric_customization.ui'
    if (Test-Path -LiteralPath $profUi) {
        Copy-Item -LiteralPath $profUi -Destination ($profUi + '.bak_aiask') -Force
    }
    Copy-Item -LiteralPath $uiDst -Destination $profUi -Force
    $profMap = Join-Path $settings 'Mapkeys.pro'
    $gbk = [Text.Encoding]::GetEncoding(936)
    $old = ''
    if (Test-Path -LiteralPath $profMap) {
        $old = [IO.File]::ReadAllText($profMap, $gbk)
    }
    if ($old -notmatch 'mapkey\s+aiask') {
        $label = -join ([char]0x971C, [char]0x5203, 'AI', [char]0x52A9, [char]0x624B)
        $start = ($base -replace '\\', '/') + '/start_ai.bat'
        $block = "`r`n! ===== CreoAiAsk_AIAssistant_F_Green =====`r`n" +
                 "mapkey aiask @MAPKEY_NAME $label; @MAPKEY_LABEL $label; @SYSTEM cmd /c call `"$start`";`r`n" +
                 "! ===== CreoAiAsk_AIAssistant_F_Green_END =====`r`n"
        [IO.File]::WriteAllText($profMap, $old.TrimEnd() + $block, $gbk)
    }
    Write-Output 'ribbon button + aiask mapkey integrated into Creo user profile'
}

# ---- 4) local working folders ----
New-Item -ItemType Directory -Force -Path `
    (Join-Path $base 'work\models'), `
    (Join-Path $base 'work\frames'), `
    (Join-Path $base 'models'), `
    (Join-Path $base 'temp'), `
    (Join-Path $base 'backup') | Out-Null

# Creo may restore work\models as its working directory before loading the
# ribbon customization.  Keep a copy of the AI UI there as well.
if (Test-Path -LiteralPath $uiDst) {
    foreach ($d in @('work\models', 'work')) {
        Copy-Item -LiteralPath $uiDst `
            -Destination (Join-Path $base ($d + '\creo_parametric_customization.ui')) -Force
    }
    Write-Output 'ribbon customization copied to work and work\models'
}

# ---- 5) summary ----
$summary = @(
    ('OK installed ' + (Get-Date -Format 'yyyyMMdd_HHmmss')),
    ('BASE=' + $base),
    ('CONFIG=' + (Join-Path $base 'config.pro')),
    ('MODELS=' + (Join-Path $base 'models')),
    ('C_CONFIG=read-only (not modified)'),
    ('START_CREO=' + (Join-Path $base 'start_creo_ai.bat')),
    ('START_AI=' + (Join-Path $base 'start_ai.bat'))
)
$summary | Set-Content -LiteralPath $result -Encoding UTF8
Write-Output '===== INSTALL OK ====='
$summary | ForEach-Object { Write-Output $_ }
