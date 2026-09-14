#requires -version 5.1
$ErrorActionPreference="Stop"
$StateDir=Join-Path $env:ProgramData "LDPlayer-Browser-Remote-v3"
try {
  [void][Reflection.Assembly]::LoadFrom((Join-Path $StateDir "Bridge.dll"))
  [LdBrowserRemote.BridgeRuntime]::Run((Join-Path $StateDir "config.ini"),(Join-Path $StateDir "www"),(Join-Path $StateDir "runtime.log"))
} catch { Add-Content -LiteralPath (Join-Path $StateDir "runtime.log") -Encoding UTF8 -Value ("[{0}] SCRCPY BRIDGE FATAL: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"),$_.Exception) }
