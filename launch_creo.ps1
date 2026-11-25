# Start Creo Parametric with the portable package as its working directory.
# Creo reads config.pro from the working directory, so this makes the package
# config.pro (GB drawing settings + AI mapkeys + HelloCreo protkdat) active
# without touching the machine's C: config.
param(
    [string]$PackageRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = 'Stop'
$regRoot = 'HKLM:\SOFTWARE\PTC\PTC Creo Parametric'
$exe = $null

if (Test-Path $regRoot) {
    foreach ($ver in (Get-ChildItem $regRoot | Sort-Object Name -Descending)) {
        try {
            $loc = (Get-ItemProperty -LiteralPath $ver.PSPath -ErrorAction Stop).InstallLocation
            if ([string]::IsNullOrWhiteSpace($loc)) { continue }
            $candidate = Join-Path $loc 'bin\parametric.exe'
            if (Test-Path -LiteralPath $candidate) { $exe = $candidate; break }
        } catch { }
    }
}

if (-not $exe) {
    Write-Output 'Creo Parametric was not found in the registry.'
    Write-Output 'Install Creo 13 or edit launch_creo.ps1 with the parametric.exe path.'
    exit 1
}

$running = @(Get-CimInstance Win32_Process -Filter "Name='parametric.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $exe })
if ($running.Count -gt 0) {
    Write-Output 'Creo is already running.  The package config.pro is read only at startup.'
    Write-Output 'Close Creo and run start_creo_ai.bat again to activate the portable config.'
    exit 2
}

Write-Output ('Creo: ' + $exe)
Write-Output ('Working directory: ' + $PackageRoot)

# Creo can restore the last working directory (often work\models) before it
# loads creo_parametric_customization.ui.  Keep the AI ribbon UI in both the
# package root and work\models so the AI助手 button survives restarts.
$ui = Join-Path $PackageRoot 'creo_parametric_customization.ui'
if (Test-Path -LiteralPath $ui) {
    foreach ($d in @('work\models', 'work')) {
        $target = Join-Path $PackageRoot $d
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Copy-Item -LiteralPath $ui -Destination (Join-Path $target 'creo_parametric_customization.ui') -Force
    }
}

$p = Start-Process -FilePath $exe -WorkingDirectory $PackageRoot -PassThru
Write-Output ('Creo started, PID=' + $p.Id)

# Close the AI window and the local bridge when this Creo process exits.
$watch = Join-Path $PackageRoot 'watch_creo.ps1'
if (Test-Path -LiteralPath $watch) {
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $watch + '"'),
        '-CreoPid', $p.Id,
        '-PackageRoot', ('"' + $PackageRoot + '"')
    ) | Out-Null
}

exit 0
