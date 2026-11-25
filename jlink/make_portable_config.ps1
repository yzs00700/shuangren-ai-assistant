# Build a package-local config.pro so Creo can start with the package as its
# working directory.  The machine's shared config.pro is READ ONLY: its
# non-AI settings are copied into the package, and only the AI mapkeys are
# appended.  With -CleanC the AI lines previously written into the shared
# config.pro and the user mapkeys.pro are removed (backups go to the package).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File make_portable_config.ps1
#   powershell -ExecutionPolicy Bypass -File make_portable_config.ps1 -CleanC

param(
    [string]$PackageRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
    [switch]$CleanC
)

$ErrorActionPreference = 'Stop'
$gbk = [System.Text.Encoding]::GetEncoding(936)
$srcCfg = 'C:\Users\Public\Documents\config.pro'
$srcMk = Join-Path $env:APPDATA 'PTC\ProENGINEER\Wildfire\.wf\.Settings\mapkeys.pro'
$configDir = Join-Path $PackageRoot 'config'
$formatsDir = Join-Path $configDir 'formats'
$backupDir = Join-Path $PackageRoot 'backup'
New-Item -ItemType Directory -Force -Path $configDir, $formatsDir, $backupDir | Out-Null

function Find-HelloCreo {
    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($drive in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
                        Select-Object -ExpandProperty Root)) {
        $candidates.Add((Join-Path $drive 'Program Files\HelloCreo'))
        $candidates.Add((Join-Path $drive 'Program Files (x86)\HelloCreo'))
    }
    if ($env:ProgramFiles) {
        $candidates.Add((Join-Path $env:ProgramFiles 'HelloCreo'))
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'HelloCreo'))
    }
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $c 'HelloCreo.dat')) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }
    return $null
}

function Find-CreoCommonFiles {
    $regRoot = 'HKLM:\SOFTWARE\PTC\PTC Creo Parametric'
    if (Test-Path $regRoot) {
        foreach ($ver in (Get-ChildItem $regRoot -ErrorAction SilentlyContinue |
                          Sort-Object Name -Descending)) {
            try {
                $loc = (Get-ItemProperty -LiteralPath $ver.PSPath -ErrorAction Stop).InstallLocation
                if ([string]::IsNullOrWhiteSpace($loc)) { continue }
                $common = Join-Path $loc 'Common Files'
                if (-not (Test-Path -LiteralPath $common)) {
                    $common = Join-Path (Split-Path -Parent $loc) 'Common Files'
                }
                if (Test-Path -LiteralPath $common) { return $common }
            } catch { }
        }
    }
    return $null
}

$helloRoot = Find-HelloCreo
$creoCommon = Find-CreoCommonFiles
if ($helloRoot) { Write-Output ('HelloCreo: ' + $helloRoot) }
else { Write-Output 'WARNING: HelloCreo not found; protkdat/search_path will be omitted.' }
if ($creoCommon) { Write-Output ('Creo Common Files: ' + $creoCommon) }
else { Write-Output 'WARNING: Creo Common Files not found; keeping config colors/fonts.' }

$stripAi = {
    param([string]$Text)
    $lines = $Text -split "`r?`n"
    $out = New-Object System.Collections.Generic.List[string]
    $skip = $false
    foreach ($l in $lines) {
        if ($l -match 'CreoAiAsk_AIAssistant_F_Green_END') { $skip = $false; continue }
        if ($l -match 'CreoAiAsk_Command_Mapkeys_END') { $skip = $false; continue }
        if ($l -match 'CreoAiAsk_AIAssistant_F_Green') { $skip = $true; continue }
        if ($l -match 'CreoAiAsk_Command_Mapkeys') { $skip = $true; continue }
        if ($skip) { continue }
        if ($l -match '^\s*!?\s*mapkey\s+aiask\b') { continue }
        if ($l -match '^\s*!?\s*mapkey\s+ai_cmd_') { continue }
        if ($l -match 'CreoAiAsk standalone AI window') { continue }
        if ($l -match '^\s*!?\s*protkdat\s+\S*[Cc]reo[Aa]i[Aa]sk') { continue }
        $out.Add($l)
    }
    return ($out -join "`r`n")
}

# ---- 1) copy the GB drawing resources the shared config points at ----
$docs = 'C:\Users\Public\Documents'
foreach ($name in @('gb_mm.dtl', 'gb.pnt', 'dxf_export_cn.pro')) {
    $src = Join-Path $docs $name
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination (Join-Path $configDir $name) -Force
        Write-Output ('copied ' + $name)
    }
}
Get-ChildItem -LiteralPath $docs -Filter '*.frm.*' -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $formatsDir $_.Name) -Force
}
Write-Output ('formats copied: ' + (Get-ChildItem -LiteralPath $formatsDir -File -ErrorAction SilentlyContinue).Count)

# ---- 2) build package config.pro from the shared one, minus AI lines ----
$raw = ''
if (Test-Path -LiteralPath $srcCfg) {
    $raw = [System.IO.File]::ReadAllText($srcCfg, $gbk)
}
$body = & $stripAi $raw

$haveDtl = Test-Path -LiteralPath (Join-Path $configDir 'gb_mm.dtl')
$havePnt = Test-Path -LiteralPath (Join-Path $configDir 'gb.pnt')
$haveDxf = Test-Path -LiteralPath (Join-Path $configDir 'dxf_export_cn.pro')
$haveFmt = @(Get-ChildItem -LiteralPath $formatsDir -File -ErrorAction SilentlyContinue).Count -gt 0

# Package-relative paths.  Creo resolves them against its run directory,
# which start_creo_ai.bat sets to the package root.  This keeps config.pro
# valid even if the whole package is copied to another drive.
if ($haveDtl) {
    $body = [regex]::Replace($body, '(?im)^\s*drawing_setup_file\s+.*$',
        'drawing_setup_file config/gb_mm.dtl')
}
if ($havePnt) {
    $body = [regex]::Replace($body, '(?im)^\s*pen_table_file\s+.*$',
        'pen_table_file config/gb.pnt')
}
if ($haveFmt) {
    $body = [regex]::Replace($body, '(?im)^\s*pro_format_dir\s+.*$',
        'pro_format_dir config/formats')
}
if ($haveDxf) {
    $body = [regex]::Replace($body, '(?im)^\s*intf2d_out_dxf_mapping_file\s+.*$',
        'intf2d_out_dxf_mapping_file config/dxf_export_cn.pro')
}

# If the shared config did not contain a setting, add it only when the file
# was actually copied into the package.
if ($body -notmatch '(?im)^\s*drawing_setup_file\s+' -and $haveDtl) {
    $body += "`r`ndrawing_setup_file config/gb_mm.dtl"
}
if ($body -notmatch '(?im)^\s*pen_table_file\s+' -and $havePnt) {
    $body += "`r`npen_table_file config/gb.pnt"
}
if ($body -notmatch '(?im)^\s*pro_format_dir\s+' -and $haveFmt) {
    $body += "`r`npro_format_dir config/formats"
}

# Keep UDF browsing/placement inside the portable package.  The bridge sets
# pro_group_dir at runtime as well, but the manual Creo UDF dialog reads it
# from config.pro.
$udfDir = Join-Path $PackageRoot 'UDF'
if (Test-Path -LiteralPath $udfDir) {
    if ($body -match '(?im)^\s*pro_group_dir\s+') {
        $body = [regex]::Replace($body, '(?im)^\s*pro_group_dir\s+.*$',
            'pro_group_dir UDF')
    } else {
        $body += "`r`npro_group_dir UDF"
    }
}

# ---- 2b) machine-specific Creo / HelloCreo paths ----
# The shared config may point at another drive or another Creo install.  Use
# the installation found on THIS computer.  protkdat and search_path are the
# two settings that load HelloCreo; without them the manual template drawing
# commands are unavailable.
if ($helloRoot) {
    $helloDat = (Join-Path $helloRoot 'HelloCreo.dat').Replace('\', '/')
    $helloTpl = (Join-Path $helloRoot 'templates').Replace('\', '/')
    if ($body -match '(?im)^\s*protkdat\s+.*HelloCreo\.dat') {
        $body = [regex]::Replace($body,
            '(?im)^\s*protkdat\s+.*HelloCreo\.dat\s*$',
            'protkdat ' + $helloDat)
    } else {
        $body += "`r`nprotkdat $helloDat"
    }
    if ($body -match '(?im)^\s*search_path\s+.*HelloCreo') {
        $body = [regex]::Replace($body,
            '(?im)^\s*search_path\s+.*HelloCreo.*$',
            'search_path ' + $helloTpl)
    } elseif ($body -notmatch ('(?im)^\s*search_path\s+' + [regex]::Escape($helloTpl))) {
        $body += "`r`nsearch_path $helloTpl"
    }
} else {
    $body = [regex]::Replace($body, '(?im)^\s*protkdat\s+.*HelloCreo\.dat\s*\r?\n?', '')
    $body = [regex]::Replace($body, '(?im)^\s*search_path\s+.*HelloCreo.*\r?\n?', '')
}

if ($creoCommon) {
    $syscol = (Join-Path $creoCommon 'creo_standards\config_files\syscol.scl')
    if (Test-Path -LiteralPath $syscol) {
        $body = [regex]::Replace($body, '(?im)^\s*system_colors_file\s+.*$',
            'system_colors_file ' + $syscol.Replace('\', '/'))
    }
    $fonts = Join-Path $creoCommon 'text\fonts'
    if (Test-Path -LiteralPath $fonts) {
        $body = [regex]::Replace($body, '(?im)^\s*pro_font_dir\s+.*$',
            'pro_font_dir ' + $fonts.Replace('\', '/'))
    }
}

# Load ribbon and mapkey customizations from the package, not from C:.
# The .ui file is generated once and shipped in jlink\; setup copies it to
# the package root so the AI助手 button appears in Part and Assembly.
if ($body -match '(?im)^\s*load_ui_customization_run_dir\s+') {
    $body = [regex]::Replace($body, '(?im)^\s*load_ui_customization_run_dir\s+.*$',
        'load_ui_customization_run_dir yes')
} else {
    $body += "`r`nload_ui_customization_run_dir yes"
}

# Creo 11+ ignores mapkeys in config.pro and reads them from Mapkeys.pro.
# With load_mapkeys_run_dir yes, Creo uses the package-root Mapkeys.pro, so
# the mapkeys travel with the green package and never touch the user's C:
# profile.
if ($body -match '(?im)^\s*load_mapkeys_run_dir\s+') {
    $body = [regex]::Replace($body, '(?im)^\s*load_mapkeys_run_dir\s+.*$',
        'load_mapkeys_run_dir yes')
} else {
    $body += "`r`nload_mapkeys_run_dir yes"
}

# ---- 3) build the AI mapkeys (GBK, written to Mapkeys.pro) ----
$label = [char]0x971C + [char]0x5203 + 'AI' + [char]0x52A9 + [char]0x624B
# Creo's @SYSTEM does not reliably inherit the run directory, so use the
# absolute launcher path.  Forward slashes avoid mapkey backslash escaping;
# Setup regenerates this file on every machine/drive.
$launcher = ((Join-Path $PackageRoot 'start_ai.bat') -replace '\\', '/')
$mapkeyLine = 'mapkey aiask @MAPKEY_NAME ' + $label + '; @MAPKEY_LABEL ' + $label +
    '; @SYSTEM cmd /c call "' + $launcher + '";'
$cmdMapkeys = @(
    'mapkey ai_cmd_extrude ~ Command `ProCmdFtExtrude` ;',
    'mapkey ai_cmd_revolve ~ Command `ProCmdFtRevolve` ;',
    'mapkey ai_cmd_hole ~ Command `ProCmdHole` ;',
    'mapkey ai_cmd_round ~ Command `ProCmdRound` ;',
    'mapkey ai_cmd_chamfer ~ Command `ProCmdChamferEdge` ;',
    'mapkey ai_cmd_pattern ~ Command `ProCmdPattern` ;',
    'mapkey ai_cmd_mirror ~ Command `ProCmdFtMirror` ;',
    'mapkey ai_cmd_draft ~ Command `ProCmdDraft` ;',
    'mapkey ai_cmd_shell ~ Command `ProCmdShell` ;',
    'mapkey ai_cmd_dimension ~ Command `ProCmdSketDimension` ;',
    'mapkey ai_cmd_dwg_view ~ Command `ProCmdDwgViewGen` ;',
    'mapkey ai_cmd_dwg_proj ~ Command `ProCmdDwgViewProj` ;',
    'mapkey ai_cmd_dwg_annot ~ Command `ProCmdDwgShowAllAnnots` ;',
    'mapkey ai_cmd_regen ~ Command `ProCmdRegenAuto` ;',
    'mapkey ai_cmd_explode ~ Command `ProCmdExplodeToggle` ;',
    'mapkey ai_cmd_balloon ~ Command `ProCmdDwgCreateBallon` ;'
)
# HelloCreo commands used by the AI assistant and by manual drawing work.
# They are package-local mapkeys, so a Setup run keeps the manual workflow
# identical to the bridge's raw RunMacro calls.
$helloMapkeys = @(
    'mapkey ai_hc_openworkdir ~ Command `OpenWorkDir_HelloCreo` ;',
    'mapkey ai_hc_setworkdir ~ Command `SetWorkDir_HelloCreo` ;',
    'mapkey ai_hc_autodrw ~ Command `AutoCreateDrw_HelloCreo` ;',
    'mapkey ai_hc_seldrws ~ Command `SelToCreateDrws_HelloCreo` ;',
    'mapkey ai_hc_opendrw ~ Command `OpenDrw_HelloCreo` ;',
    'mapkey ai_hc_seltemplate ~ Command `SelDrwTemplate_HelloCreo` ;',
    'mapkey ai_hc_batchexport ~ Command `BatchExport_HelloCreo` ;',
    'mapkey ai_hc_exportpdf ~ Command `Export2Pdf_HelloCreo` ;',
    'mapkey ai_hc_exportdwg ~ Command `Export2Dwg_HelloCreo` ;',
    'mapkey ai_hc_exportdxf ~ Command `Export2Dxf_HelloCreo` ;',
    'mapkey ai_hc_hybridexport ~ Command `HybridExport_HelloCreo` ;',
    'mapkey ai_hc_deldrw ~ Command `DelNamedDrw_HelloCreo` ;',
    'mapkey ai_hc_seltemplate_act ~ Activate `main_dlg_cur` `SelDrwTemplate_HelloCreo`;',
    'mapkey ai_hc_seltemplate_act1 ~ Activate `main_dlg_cur` `SelDrwTemplate_HelloCreo` 1;',
    'mapkey ai_hc_dwtman ~ Command `DwtMan_HelloCreo` ;',
    'mapkey ai_hc_dwtman_act ~ Activate `main_dlg_cur` `DwtMan_HelloCreo`;',
    'mapkey ai_hc_opendrw_act ~ Activate `main_dlg_cur` `OpenDrw_HelloCreo`;'
)
$block = @(
    '!',
    '! ===== CreoAiAsk_AIAssistant_F_Green =====',
    '! Package-local AI mapkeys.  Creo must be started with this folder as its',
    '! working directory (use start_creo_ai.bat) so this Mapkeys.pro is read.',
    $mapkeyLine) + $cmdMapkeys + @(
    '! HelloCreo mapkeys (manual drawing / export commands).',
    '') + $helloMapkeys + @(
    '! ===== CreoAiAsk_AIAssistant_F_Green_END ====='
)
$body = $body.TrimEnd("`r", "`n")
[System.IO.File]::WriteAllText((Join-Path $PackageRoot 'config.pro'),
    $body + "`r`n", $gbk)
Write-Output ('package config written: ' + (Join-Path $PackageRoot 'config.pro'))

# Creo 11+ ignores mapkeys in config.pro; they must live in Mapkeys.pro.
# load_mapkeys_run_dir yes makes Creo read the package-root copy, so the
# mapkeys stay portable and never touch the user's C: profile.
[System.IO.File]::WriteAllText((Join-Path $PackageRoot 'Mapkeys.pro'),
    ($block -join "`r`n") + "`r`n", $gbk)
Write-Output ('package mapkeys written: ' + (Join-Path $PackageRoot 'Mapkeys.pro'))

# ---- 4) optionally remove AI lines from the C: shared config (cleanup) ----
if ($CleanC) {
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    if (Test-Path -LiteralPath $srcCfg) {
        Copy-Item -LiteralPath $srcCfg -Destination (Join-Path $backupDir ('config.pro.bak_' + $stamp)) -Force
        $cText = [System.IO.File]::ReadAllText($srcCfg, $gbk)
        $cleanC = & $stripAi $cText
        [System.IO.File]::WriteAllText($srcCfg, $cleanC.TrimEnd("`r", "`n") + "`r`n", $gbk)
        Write-Output ('shared config cleaned: ' + $srcCfg)
    }
    if (Test-Path -LiteralPath $srcMk) {
        Copy-Item -LiteralPath $srcMk -Destination (Join-Path $backupDir ('mapkeys.pro.bak_' + $stamp)) -Force
        $mText = [System.IO.File]::ReadAllText($srcMk, $gbk)
        $cleanMk = & $stripAi $mText
        [System.IO.File]::WriteAllText($srcMk, $cleanMk.TrimEnd("`r", "`n") + "`r`n", $gbk)
        Write-Output ('user mapkeys cleaned: ' + $srcMk)
    }
    Write-Output ('backups: ' + $backupDir)
}
