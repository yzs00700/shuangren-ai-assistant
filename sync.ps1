# 霜刃AI助手 - 双远程同步脚本
# 用法：powershell -ExecutionPolicy Bypass -File sync.ps1 "提交说明"
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}

$msg = if ($args.Count -gt 0) { $args -join ' ' } else { "chore: sync $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }

git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "没有需要提交的更改。"
} else {
    git commit -m $msg
    if ($LASTEXITCODE -ne 0) { throw "git commit 失败" }
}

$remotes = git remote

if ($remotes -contains 'gitee') {
    Write-Host "==> push gitee main"
    git push gitee main
    if ($LASTEXITCODE -ne 0) { throw "push gitee 失败" }
}

if ($remotes -contains 'origin') {
    Write-Host "==> push origin main"
    git push origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "GitHub 推送失败（常见原因：当前网络无法直连 github.com）。内容已推送到 Gitee，可稍后重试：git push origin main"
    }
}

Write-Host "完成。"
