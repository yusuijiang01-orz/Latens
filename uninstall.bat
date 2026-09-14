@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p='%~dp0Uninstall.ps1';if(-not([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File """'+$p+'"""';exit};& $p"
endlocal
