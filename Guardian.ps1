#requires -version 5.1
$ErrorActionPreference = "Stop"
$StateDir = Join-Path $env:ProgramData "LDPlayer-Browser-Remote-v3"
$ConfigPath = Join-Path $StateDir "config.ini"
$RuntimeLog = Join-Path $StateDir "runtime.log"
$GuardianPid = Join-Path $StateDir "guardian.pid"
$BridgePid = Join-Path $StateDir "bridge.pid"
$StopSignal = Join-Path $StateDir "stop.signal"

function Log([string]$Text) {
    try { Add-Content -LiteralPath $RuntimeLog -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Text) } catch {}
}
function Read-Config {
    $m = @{}
    foreach ($line in Get-Content -LiteralPath $ConfigPath -Encoding UTF8) {
        if ($line -match '^([^#=]+)=(.*)$') { $m[$Matches[1].Trim()] = $Matches[2].Trim() }
    }
    return $m
}
function Get-AccessPassword($Config) {
    if ($Config.ContainsKey('AccessPassword') -and -not [string]::IsNullOrEmpty($Config['AccessPassword'])) { return [string]$Config['AccessPassword'] }
    return [string]$Config['Pin']
}
function Alive([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        try {
            $id = [int](Get-Content -LiteralPath $Path -Raw)
            return [bool](Get-Process -Id $id -ErrorAction SilentlyContinue)
        } catch {}
    }
    return $false
}
function Stop-PidFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    try { Stop-Process -Id ([int](Get-Content -LiteralPath $Path -Raw)) -Force -ErrorAction SilentlyContinue } catch {}
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}
function Test-AllowedIPv4([string]$IP) {
    $addr = $null
    if (-not [Net.IPAddress]::TryParse($IP, [ref]$addr)) { return $false }
    $b = $addr.GetAddressBytes()
    if ($b.Length -ne 4) { return $false }
    if ($b[0] -eq 10) { return $true }
    if ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) { return $true }
    if ($b[0] -eq 192 -and $b[1] -eq 168) { return $true }
    if ($b[0] -eq 100 -and $b[1] -ge 64 -and $b[1] -le 127) { return $true }
    return $false
}
function Get-EligibleIPv4 {
    $items = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($ip in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop) {
            if ($ip.AddressState -ne 'Preferred') { continue }
            if (-not (Test-AllowedIPv4 $ip.IPAddress)) { continue }
            $adapter = Get-NetAdapter -InterfaceIndex $ip.InterfaceIndex -ErrorAction SilentlyContinue
            if ($adapter -and $adapter.Status -ne 'Up') { continue }
            $name = if ($adapter) { ([string]$adapter.Name + ' ' + [string]$adapter.InterfaceDescription) } else { [string]$ip.InterfaceAlias }
            $allowedVirtual = $name -match '(?i)tailscale|蒲公英|pgy|oray|vpn'
            $knownNoise = $name -match '(?i)vEthernet|WSL|Hyper-V|VMware|VirtualBox|Docker|Npcap|Loopback|Bluetooth|Teredo|isatap'
            if ($knownNoise -and -not $allowedVirtual) { continue }
            $rank = 3
            if ($ip.IPAddress -match '^100\.') { $rank = 0 }
            elseif ($name -match '(?i)蒲公英|pgy|oray|vpn') { $rank = 1 }
            elseif ($ip.IPAddress -match '^192\.168\.') { $rank = 2 }
            $items.Add([pscustomobject]@{ IP = [string]$ip.IPAddress; Name = $name.Trim(); Rank = $rank }) | Out-Null
        }
    } catch { Log ("network enumeration failed: " + $_.Exception.Message) }
    return @($items | Sort-Object Rank,IP -Unique)
}
function Gateway-PidPath([string]$IP) { return (Join-Path $StateDir ("gateway-{0}.pid" -f ($IP -replace '[^0-9A-Za-z]','_'))) }
function Start-Bridge {
    if (Alive $BridgePid) { return }
    Stop-PidFile $BridgePid
    $p = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $StateDir 'RunBridge.ps1'))
    Set-Content -LiteralPath $BridgePid -Value $p.Id -Encoding ASCII
    Log ("bridge started pid={0}" -f $p.Id)
    Start-Sleep -Milliseconds 700
}
function Start-Gateway([string]$IP, $Config, [string]$Password) {
    $pidPath = Gateway-PidPath $IP
    if (Alive $pidPath) { return }
    Stop-PidFile $pidPath
    $gatewayArgs = @(
        '--listen', ('{0}:{1}' -f $IP,$Config['PublicPort']),
        '--tailscale-ip', $IP,
        '--pin', $Password,
        '--web-root', (Join-Path $StateDir 'www'),
        '--upstream', ('127.0.0.1:{0}' -f $Config['HttpPort']),
        '--log', $RuntimeLog
    )
    $p = Start-Process (Join-Path $StateDir 'webrtc-gateway.exe') -WindowStyle Hidden -PassThru -ArgumentList $gatewayArgs
    Set-Content -LiteralPath $pidPath -Value $p.Id -Encoding ASCII
    Log ("gateway started ip={0} port={1} pid={2}" -f $IP,$Config['PublicPort'],$p.Id)
}
function Stop-UndesiredGateways([string[]]$Desired) {
    foreach ($f in Get-ChildItem -LiteralPath $StateDir -Filter 'gateway-*.pid' -File -ErrorAction SilentlyContinue) {
        $keep = $false
        foreach ($ip in $Desired) { if ((Gateway-PidPath $ip) -eq $f.FullName) { $keep = $true; break } }
        if (-not $keep) { Stop-PidFile $f.FullName; Log ("stopped obsolete gateway pid file " + $f.Name) }
    }
}
function Stop-Children {
    foreach ($f in Get-ChildItem -LiteralPath $StateDir -Filter 'gateway-*.pid' -File -ErrorAction SilentlyContinue) { Stop-PidFile $f.FullName }
    Stop-PidFile (Join-Path $StateDir 'gateway.pid')
    Stop-PidFile $BridgePid
}

if (-not (Test-Path -LiteralPath $ConfigPath)) { exit 2 }
if (Alive $GuardianPid) { exit 0 }
Remove-Item -LiteralPath $StopSignal -Force -ErrorAction SilentlyContinue
Set-Content -LiteralPath $GuardianPid -Value $PID -Encoding ASCII
Log ("guardian started pid={0}" -f $PID)

try {
    while (-not (Test-Path -LiteralPath $StopSignal)) {
        $c = Read-Config
        $password = Get-AccessPassword $c
        if ([string]::IsNullOrEmpty($password)) { throw 'AccessPassword/Pin is empty.' }
        Start-Bridge
        $interfaces = @(Get-EligibleIPv4)
        $desired = @($interfaces | ForEach-Object { $_.IP })
        Stop-UndesiredGateways $desired
        foreach ($n in $interfaces) { Start-Gateway $n.IP $c $password }
        if ($desired.Count -eq 0) { Log 'no eligible Tailscale/VPN/LAN IPv4 address is currently up; guardian will retry' }
        Start-Sleep -Seconds 5
    }
} catch {
    Log ("guardian fatal: " + $_.Exception)
} finally {
    Stop-Children
    Remove-Item -LiteralPath $GuardianPid -Force -ErrorAction SilentlyContinue
    Log 'guardian stopped'
}
