@echo off
setlocal
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$s=Join-Path $env:ProgramData 'LDPlayer-Browser-Remote-v3\stop.signal';Remove-Item -LiteralPath $s -Force -ErrorAction SilentlyContinue;try{Start-ScheduledTask -TaskName 'LDPlayer-Browser-Remote-v3-AutoStart' -ErrorAction Stop}catch{Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """'+(Join-Path $env:ProgramData 'LDPlayer-Browser-Remote-v3\Guardian.ps1')+'"""'}"
endlocal
