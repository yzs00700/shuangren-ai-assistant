param([string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path))

$Root = $Root.Trim('"')
if (-not (Test-Path -LiteralPath $Root)) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }

$creo = Get-Process parametric -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $creo) { return }

# Do not start a second watcher for the same Creo process.
$existing = @()
try {
    $existing = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -match 'watch_creo\.ps1' -and
            $_.CommandLine -match ('-CreoPid\s+' + $creo.Id)
        }
} catch { }
if ($existing.Count -gt 0) { return }

Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $Root 'watch_creo.ps1'),
    '-CreoPid', $creo.Id,
    '-PackageRoot', $Root
) | Out-Null
