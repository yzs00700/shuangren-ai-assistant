# CreoAiAsk portable uninstaller.
#
# The AI mapkeys and the package config.pro now live entirely inside the
# package folder.  Nothing on the C: drive is modified or deleted, so this
# script does not need administrator rights and does not touch C: config.pro
# or the user's mapkeys.pro.
$ErrorActionPreference = 'Continue'
$pkg = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Stop-Quiet($name) {
    try {
        Get-Process -Name $name -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Output ('stopped ' + $name)
    } catch { }
}

Stop-Quiet 'AiAsk'
Stop-Quiet 'CreoBridge'
Stop-Quiet 'CreoAiSrv'
Stop-Quiet 'CreoToolbox'

# Close only the Edge/Chrome windows that use this package's profile.
try {
    $profile = Join-Path $pkg 'temp\edge_profile'
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { }

Write-Output ''
Write-Output 'OK: CreoAiAsk processes stopped.'
Write-Output 'The machine C: config.pro and mapkeys.pro were NOT changed.'
Write-Output ('You can now delete this folder manually: ' + $pkg)
Write-Output 'Close Creo first if you want to remove the folder completely.'
