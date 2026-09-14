#requires -version 5.1
$ErrorActionPreference = "SilentlyContinue"
$StateDir = Join-Path $env:ProgramData "LDPlayer-Browser-Remote-v3"
$Config = Join-Path $StateDir "config.ini"
$out = Join-Path $PSScriptRoot "诊断日志.txt"
function Read-Config {
    $m=@{}
    foreach($line in Get-Content -LiteralPath $Config -Encoding UTF8){
        if($line -match '^([^#=]+)=(.*)$'){$m[$Matches[1].Trim()]=$Matches[2].Trim()}
    }
    return $m
}
function Get-Password($c){
    if($c.ContainsKey('AccessPassword') -and $c['AccessPassword']){return [string]$c['AccessPassword']}
    return [string]$c['Pin']
}
function Is-Allowed([string]$s){
    $a=$null
    if(-not [Net.IPAddress]::TryParse($s,[ref]$a)){return $false}
    $b=$a.GetAddressBytes()
    return ($b[0]-eq 10) -or ($b[0]-eq 172 -and $b[1]-ge 16 -and $b[1]-le 31) -or ($b[0]-eq 192 -and $b[1]-eq 168) -or ($b[0]-eq 100 -and $b[1]-ge 64 -and $b[1]-le 127)
}
if(-not(Test-Path -LiteralPath $Config)){
    Write-Host "尚未安装 v3。" -ForegroundColor Yellow
    Read-Host "按回车关闭"
    exit 1
}
$c=Read-Config
$pw=Get-Password $c
$enc=[uri]::EscapeDataString($pw)
$ips=@(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' -and (Is-Allowed $_.IPAddress) } | Select-Object -ExpandProperty IPAddress -Unique)
$urls=@($ips | ForEach-Object { "http://{0}:{1}/" -f $_,$c['PublicPort'] })
$health=@()
foreach($u in $urls){
    $ok=$false
    try{
        $r=Invoke-WebRequest -UseBasicParsing -Uri ($u+'api/health?pin='+$enc) -TimeoutSec 3
        if($r.StatusCode -eq 200){$ok=$true}
    }catch{}
    $health += ("{0} [{1}]" -f $u,$(if($ok){'OK'}else{'FAIL'}))
}
$guardian='STOPPED'
try{
    $guardianPath=Join-Path $StateDir 'guardian.pid'
    if(Test-Path -LiteralPath $guardianPath){
        $guardianId=[int](Get-Content -LiteralPath $guardianPath -Raw)
        if(Get-Process -Id $guardianId -ErrorAction SilentlyContinue){$guardian='RUNNING'}
    }
}catch{}
$lines=@(
    "LDPlayer Browser Remote v3 诊断",
    "生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "Guardian: $guardian",
    "PublicPort: $($c['PublicPort'])",
    "InternalBridgePort: $($c['HttpPort'])",
    "Password: ******",
    "",
    "===== Access URLs ====="
) + $health + @("","===== runtime.log =====")
$log=Join-Path $StateDir 'runtime.log'
if(Test-Path -LiteralPath $log){$lines += Get-Content -LiteralPath $log -Tail 250 -Encoding UTF8}else{$lines += '(missing)'}
$lines | Set-Content -LiteralPath $out -Encoding UTF8
Write-Host "后台守护: $guardian" -ForegroundColor $(if($guardian -eq 'RUNNING'){'Green'}else{'Red'})
$health | ForEach-Object { Write-Host $_ -ForegroundColor Cyan }
Write-Host "访问密码: $pw" -ForegroundColor Cyan
Write-Host "诊断日志：$out"
Read-Host "按回车关闭"
