#requires -version 5.1
$ErrorActionPreference = "Stop"
$StateDir = Join-Path $env:ProgramData "LDPlayer-Browser-Remote-v3"
$Guardian = Join-Path $StateDir "Guardian.ps1"
$StopSignal = Join-Path $StateDir "stop.signal"
if (-not (Test-Path -LiteralPath $Guardian)) { exit 2 }
Remove-Item -LiteralPath $StopSignal -Force -ErrorAction SilentlyContinue
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $Guardian)
