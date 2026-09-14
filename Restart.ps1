#requires -version 5.1
$ErrorActionPreference = "SilentlyContinue"
$StateDir = Join-Path $env:ProgramData "LDPlayer-Browser-Remote-v3"
$TaskName = "LDPlayer-Browser-Remote-v3-AutoStart"
& (Join-Path $PSScriptRoot 'Stop.ps1')
Remove-Item -LiteralPath (Join-Path $StateDir 'stop.signal') -Force -ErrorAction SilentlyContinue
try { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop }
catch { Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $StateDir 'Guardian.ps1')) }
Write-Host "后台远控服务已重新启动。" -ForegroundColor Green
