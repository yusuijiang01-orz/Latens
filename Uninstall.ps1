#requires -version 5.1
$ErrorActionPreference = "SilentlyContinue"
$StateDir = Join-Path $env:ProgramData "LDPlayer-Browser-Remote-v3"
$TaskName = "LDPlayer-Browser-Remote-v3-AutoStart"
if(Test-Path -LiteralPath $StateDir){
    New-Item -ItemType File -Path (Join-Path $StateDir 'stop.signal') -Force | Out-Null
}
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
$pidFiles=@(
    (Join-Path $StateDir 'guardian.pid'),
    (Join-Path $StateDir 'gateway.pid'),
    (Join-Path $StateDir 'bridge.pid')
)
$pidFiles += @(Get-ChildItem -LiteralPath $StateDir -Filter 'gateway-*.pid' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
foreach($p in $pidFiles){
    if(Test-Path -LiteralPath $p){
        try{Stop-Process -Id ([int](Get-Content -LiteralPath $p -Raw)) -Force -ErrorAction SilentlyContinue}catch{}
    }
}
foreach($rule in @(
    'LDPlayer Browser Remote v3 WebRTC signaling private networks',
    'LDPlayer Browser Remote v3 WebRTC media private networks',
    'LDPlayer Browser Remote v3 WebRTC signaling via Tailscale',
    'LDPlayer Browser Remote v3 WebRTC media via Tailscale'
)){
    Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $StateDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "v3 已卸载；雷电、应用和业务数据均未改动。" -ForegroundColor Green
Read-Host "按回车关闭"
