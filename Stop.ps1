#requires -version 5.1
$ErrorActionPreference = "SilentlyContinue"
$StateDir = Join-Path $env:ProgramData "LDPlayer-Browser-Remote-v3"
$TaskName = "LDPlayer-Browser-Remote-v3-AutoStart"
$StopSignal = Join-Path $StateDir "stop.signal"
New-Item -ItemType File -Path $StopSignal -Force | Out-Null
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
$pidFiles = @((Join-Path $StateDir 'guardian.pid'),(Join-Path $StateDir 'bridge.pid'),(Join-Path $StateDir 'gateway.pid'))
$pidFiles += @(Get-ChildItem -LiteralPath $StateDir -Filter 'gateway-*.pid' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
foreach ($p in $pidFiles) {
    if (Test-Path -LiteralPath $p) {
        try { Stop-Process -Id ([int](Get-Content -LiteralPath $p -Raw)) -Force -ErrorAction SilentlyContinue } catch {}
        Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "后台远控服务已停止。自动登录启动任务仍保留；下次登录会再次启动。" -ForegroundColor Green
