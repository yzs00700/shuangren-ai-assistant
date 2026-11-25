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

foreach ($remote in @('origin', 'gitee')) {
    $exists = git remote
    if ($exists -contains $remote) {
        Write-Host "==> push $remote main"
        git push $remote main
        if ($LASTEXITCODE -ne 0) { throw "push $remote 失败" }
    } else {
        Write-Host "跳过不存在的远程：$remote"
    }
}

Write-Host "完成。"
