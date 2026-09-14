#requires -version 5.1
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ProductName = "LDPlayer-Browser-Remote-v3"
$StateDir = Join-Path $env:ProgramData $ProductName
$WebDir = Join-Path $StateDir "www"
$ConfigPath = Join-Path $StateDir "config.ini"
$BridgeDll = Join-Path $StateDir "Bridge.dll"
$BridgeSource = Join-Path $StateDir "Bridge.cs"
$RunServerInstalled = Join-Path $StateDir "RunServer.ps1"
$RunBridgeInstalled = Join-Path $StateDir "RunBridge.ps1"
$GuardianInstalled = Join-Path $StateDir "Guardian.ps1"
$StopSignal = Join-Path $StateDir "stop.signal"
$GatewayExe = Join-Path $StateDir "webrtc-gateway.exe"
$ServerJar = Join-Path $StateDir "scrcpy-server-v4.1"
$GatewayPidPath = Join-Path $StateDir "gateway.pid"
$BridgePidPath = Join-Path $StateDir "bridge.pid"
$SetupLog = Join-Path $StateDir "setup.log"
$RuntimeLog = Join-Path $StateDir "runtime.log"
$TaskName = "LDPlayer-Browser-Remote-v3-AutoStart"
$FirewallRuleTcp = "LDPlayer Browser Remote v3 WebRTC signaling private networks"
$FirewallRuleUdp = "LDPlayer Browser Remote v3 WebRTC media private networks"
$AllowedRemoteRanges = @("100.64.0.0/10","10.0.0.0/8","172.16.0.0/12","192.168.0.0/16")
$ScrcpyUrl = "https://github.com/Genymobile/scrcpy/releases/download/v4.1/scrcpy-server-v4.1"
$ScrcpySha = "deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae"

New-Item -ItemType Directory -Force -Path $StateDir,$WebDir | Out-Null

function Log([string]$Text) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Text
    Write-Host $line
    Add-Content -LiteralPath $SetupLog -Value $line -Encoding UTF8
}
function Fail([string]$Text) {
    Log ("ERROR: " + $Text)
    Write-Host ""
    Write-Host "配置未完成：$Text" -ForegroundColor Red
    Write-Host "请把这个窗口截图发给 ChatGPT。"
    Read-Host "按回车退出"
    exit 1
}
function Add-Candidate([System.Collections.Generic.List[string]]$List, [string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    try { $full = [IO.Path]::GetFullPath($Path) } catch { return }
    if (-not $List.Contains($full)) { [void]$List.Add($full) }
}
function Find-Tailscale {
    $cmd = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @("$env:ProgramFiles\Tailscale\tailscale.exe","${env:ProgramFiles(x86)}\Tailscale\tailscale.exe")) {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
    return $null
}
function Get-TailscaleIPv4([string]$Exe) {
    try {
        foreach ($line in (& $Exe ip -4 2>$null)) {
            $s = ([string]$line).Trim()
            if ($s -match '^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$') { return $s }
        }
    } catch {}
    return $null
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
    foreach ($ip in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue) {
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
        $items.Add([pscustomobject]@{IP=[string]$ip.IPAddress;Name=$name.Trim();Rank=$rank}) | Out-Null
    }
    return @($items | Sort-Object Rank,IP -Unique)
}
function Secure-ToPlain([Security.SecureString]$Value) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function New-AccessPassword([string]$Existing) {
    if ($Existing -match '^[A-Za-z0-9._~!@#%+=-]{6,64}$') {
        Log "升级安装：保留现有访问密码。"
        return $Existing
    }
    Write-Host ""
    Write-Host "设置访问密码（6-64 位；允许字母、数字及 . _ ~ ! @ # % + = -）。" -ForegroundColor Cyan
    Write-Host "直接按回车则自动生成兼容旧版的 6 位数字 PIN。" -ForegroundColor DarkGray
    $secure = Read-Host "自定义密码" -AsSecureString
    $plain = Secure-ToPlain $secure
    if ([string]::IsNullOrEmpty($plain)) { return ("{0:D6}" -f (Get-Random -Minimum 0 -Maximum 1000000)) }
    if ($plain -notmatch '^[A-Za-z0-9._~!@#%+=-]{6,64}$') { Fail "访问密码格式不符合要求。" }
    return $plain
}
function Find-LDConsole {
    $list = New-Object 'System.Collections.Generic.List[string]'
    foreach ($n in @("ldconsole.exe","dnconsole.exe")) {
        $c = Get-Command $n -ErrorAction SilentlyContinue
        if ($c) { Add-Candidate $list $c.Source }
    }

    foreach ($procName in @("dnplayer","ldplayer","LDPlayer","dnconsole","ldconsole")) {
        try {
            foreach ($p in Get-Process -Name $procName -ErrorAction SilentlyContinue) {
                if ($p.Path) {
                    $d = Split-Path -Parent $p.Path
                    foreach ($n in @("ldconsole.exe","dnconsole.exe")) { Add-Candidate $list (Join-Path $d $n) }
                }
            }
        } catch {}
    }

    foreach ($rp in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )) {
        try {
            foreach ($i in Get-ItemProperty $rp -ErrorAction SilentlyContinue) {
                if (($i.DisplayName -match 'LDPlayer|雷电') -or ($i.Publisher -match 'LDPlayer|雷电')) {
                    $dirs = @()
                    if ($i.InstallLocation) { $dirs += $i.InstallLocation }
                    if ($i.DisplayIcon) {
                        $icon = ([string]$i.DisplayIcon).Trim('"')
                        if ($icon -match '^(.*?\.exe)') { $icon = $Matches[1] }
                        if (Test-Path -LiteralPath $icon) { $dirs += (Split-Path -Parent $icon) }
                    }
                    foreach ($d in $dirs) {
                        foreach ($n in @("ldconsole.exe","dnconsole.exe")) { Add-Candidate $list (Join-Path $d $n) }
                    }
                }
            }
        } catch {}
    }

    try { $roots = (Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Root -match '^[A-Z]:\\$'}).Root } catch { $roots = @() }
    foreach ($r in $roots) {
        foreach ($rel in @(
            "leidian\LDPlayer14",
            "LDPlayer\LDPlayer14",
            "leidian\LDPlayer9",
            "LDPlayer\LDPlayer9",
            "ChangZhi\LDPlayer",
            "Program Files\LDPlayer\LDPlayer14",
            "Program Files\LDPlayer\LDPlayer9"
        )) {
            $d = Join-Path $r $rel
            foreach ($n in @("ldconsole.exe","dnconsole.exe")) { Add-Candidate $list (Join-Path $d $n) }
        }
    }

    foreach ($f in $list) { if (Test-Path -LiteralPath $f) { return $f } }
    return $null
}
function Find-Adb([string]$LDConsole) {
    $d = Split-Path -Parent $LDConsole
    foreach ($p in @(
        (Join-Path $d "adb.exe"),
        (Join-Path $d "adb\adb.exe"),
        (Join-Path $d "platform-tools\adb.exe")
    )) {
        if (Test-Path -LiteralPath $p) { return $p }
    }
    try {
        $f = Get-ChildItem -LiteralPath $d -Filter adb.exe -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($f) { return $f.FullName }
    } catch {}
    $c = Get-Command adb.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    return $null
}
function Test-LDRunning([string]$LDConsole,[int]$Index) {
    try {
        $out = (& $LDConsole list2 2>$null | Out-String)
        foreach ($line in ($out -split "`r?`n")) {
            $s = ([string]$line).Trim()
            if (-not $s) { continue }
            $parts = $s -split ','
            if ($parts.Count -lt 5) { continue }
            $idx = 0
            if (-not [int]::TryParse($parts[0].Trim(), [ref]$idx)) { continue }
            if ($idx -ne $Index) { continue }
            return ($parts[4].Trim() -eq "1")
        }
    } catch {}
    return $false
}

function Test-ListenPort([string]$IP,[int]$Port) {
    $l = $null
    try {
        $l = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Parse($IP),$Port)
        $l.Start()
        $l.Stop()
        return $true
    } catch {
        try { if ($l) { $l.Stop() } } catch {}
        return $false
    }
}
function Choose-Port([string]$IP,[int]$Start,[int]$End) {
    foreach ($p in $Start..$End) { if (Test-ListenPort $IP $p) { return $p } }
    return $null
}
function Read-ExistingValue([string]$Key) {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { return $null }
    try {
        foreach ($line in Get-Content -LiteralPath $ConfigPath -Encoding UTF8) {
            if ($line -match ('^' + [regex]::Escape($Key) + '=(.*)$')) { return $Matches[1].Trim() }
        }
    } catch {}
    return $null
}
function Stop-Existing {
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
    try { New-Item -ItemType File -Path $StopSignal -Force | Out-Null } catch {}
    Start-Sleep -Milliseconds 500
    $pidFiles = @($GatewayPidPath,$BridgePidPath,(Join-Path $StateDir "guardian.pid"))
    $pidFiles += @(Get-ChildItem -LiteralPath $StateDir -Filter "gateway-*.pid" -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    foreach ($pidFile in $pidFiles) {
      if (Test-Path -LiteralPath $pidFile) {
        try {
            $oldPid = [int](Get-Content -LiteralPath $pidFile -Raw)
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        } catch {}
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      }
    }
    Remove-Item -LiteralPath $StopSignal -Force -ErrorAction SilentlyContinue
}
function Stop-LegacyV2 {
    $legacy = Join-Path $env:ProgramData "LDPlayer-Browser-Remote-v2"
    $legacyPid = Join-Path $legacy "server.pid"
    if (Test-Path -LiteralPath $legacyPid) {
        try { Stop-Process -Id ([int](Get-Content -LiteralPath $legacyPid -Raw)) -Force -ErrorAction SilentlyContinue } catch {}
    }
    Unregister-ScheduledTask -TaskName "LDPlayer-Browser-Remote-v2-AutoStart" -Confirm:$false -ErrorAction SilentlyContinue
    Get-NetFirewallRule -DisplayName "LDPlayer Browser Remote v2 via Tailscale" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    Log "已停止 v2 服务和自动启动项；旧版文件保留，可手动回滚。"
}
function Download-File([string]$Url,[string]$Dest) {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Dest -TimeoutSec 90
}
function Ensure-ScrcpyServer {
    $good = $false
    if (Test-Path -LiteralPath $ServerJar) {
        try {
            $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $ServerJar).Hash.ToLowerInvariant()
            $good = ($h -eq $ScrcpySha)
        } catch {}
    }
    if ($good) { return }

    Log "下载官方 scrcpy-server v4.1..."
    $tmp = "$ServerJar.download"
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    Download-File $ScrcpyUrl $tmp

    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLowerInvariant()
    if ($hash -ne $ScrcpySha) {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        Fail "scrcpy-server SHA-256 校验失败。为安全起见已停止安装。"
    }
    Move-Item -LiteralPath $tmp -Destination $ServerJar -Force
}
try { Add-Content -LiteralPath $RuntimeLog -Encoding UTF8 -Value ("[{0}] v3 alpha5 setup starting" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) } catch {}
Log "=== v3.0.0-alpha5 多网络后台版一键配置开始 ==="

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail "必须使用管理员权限。请双击 01_双击_一键安装并启动.bat。"
}

$previousPassword = Read-ExistingValue "AccessPassword"
if (-not $previousPassword) { $previousPassword = Read-ExistingValue "Pin" }
Stop-Existing
Stop-LegacyV2

$tailscale = Find-Tailscale
if ($tailscale) {
    try { Start-Service Tailscale -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Milliseconds 500
}
$networkInterfaces = @(Get-EligibleIPv4)
if ($networkInterfaces.Count -eq 0) { Fail "没有找到可用的 Tailscale / 蒲公英 / 私有局域网 IPv4 地址。请先连接至少一种网络。" }
foreach ($n in $networkInterfaces) { Log ("可用访问网卡: {0}  {1}" -f $n.IP,$n.Name) }

$ld = Find-LDConsole
if (-not $ld) { Fail "没有自动找到雷电模拟器 ldconsole.exe/dnconsole.exe。" }
$adb = Find-Adb $ld
if (-not $adb) { Fail "找到了雷电模拟器，但没有找到 adb.exe。" }
Log "LDConsole: $ld"
Log "ADB: $adb"

if (Test-LDRunning $ld 0) {
    Log "雷电主实例 index 0 已在运行：跳过 launch，避免把老板键隐藏后的窗口重新拉到前台。"
} else {
    try { & $ld launch --index 0 | Out-Null } catch {}
    Log "雷电主实例未运行：已自动启动 index 0。"
}

Ensure-ScrcpyServer

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "webrtc-gateway.exe"))) { Fail "安装包缺少 webrtc-gateway.exe。" }

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "index.html") -Destination (Join-Path $WebDir "index.html") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "manifest.webmanifest") -Destination (Join-Path $WebDir "manifest.webmanifest") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Bridge.cs") -Destination $BridgeSource -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "RunServer.ps1") -Destination $RunServerInstalled -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "RunBridge.ps1") -Destination $RunBridgeInstalled -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Guardian.ps1") -Destination $GuardianInstalled -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "webrtc-gateway.exe") -Destination $GatewayExe -Force

$publicPort = Choose-Port "0.0.0.0" 17920 17939
if (-not $publicPort) { Fail "本机 17920-17939 公共访问端口全部被占用。" }
$httpPort = Choose-Port "127.0.0.1" 17940 17959
if (-not $httpPort) { Fail "本机内部桥接端口 17940-17959 全部被占用。" }
$forwardPort = Choose-Port "127.0.0.1" 27183 27220
if (-not $forwardPort) { Fail "本机 27183-27220 端口全部被占用。" }

$password = New-AccessPassword $previousPassword
$bridgeKey = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
$scid = "{0:x8}" -f (Get-Random -Minimum 1 -Maximum 2147483647)

$config = @"
# LDPlayer Browser Remote v3
PublicPort=$publicPort
HttpPort=$httpPort
ForwardPort=$forwardPort
AccessPassword=$password
Pin=$password
BridgeKey=$bridgeKey
LDConsole=$ld
AdbExe=$adb
ScrcpyServer=$ServerJar
Scid=$scid
InstanceIndex=0
MaxSize=1280
MaxFps=30
VideoBitRate=3000000
"@
$config | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

Remove-Item -LiteralPath $BridgeDll -Force -ErrorAction SilentlyContinue
Log "编译 Windows 实时桥接组件..."
$src = Get-Content -LiteralPath $BridgeSource -Raw -Encoding UTF8
try {
    Add-Type -TypeDefinition $src -Language CSharp `
        -ReferencedAssemblies @("System.dll","System.Core.dll") `
        -OutputAssembly $BridgeDll -OutputType Library
} catch {
    Fail ("Bridge.cs 编译失败：" + $_.Exception.Message)
}
if (-not (Test-Path -LiteralPath $BridgeDll)) { Fail "Bridge.dll 未生成。" }

foreach ($name in @(
    $FirewallRuleTcp,$FirewallRuleUdp,
    "LDPlayer Browser Remote v3 WebRTC signaling via Tailscale",
    "LDPlayer Browser Remote v3 WebRTC media via Tailscale"
)) { Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue }
New-NetFirewallRule -DisplayName $FirewallRuleTcp `
    -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $publicPort -RemoteAddress $AllowedRemoteRanges -Profile Any | Out-Null
New-NetFirewallRule -DisplayName $FirewallRuleUdp `
    -Direction Inbound -Action Allow -Protocol UDP `
    -LocalPort "40000-40100" -RemoteAddress $AllowedRemoteRanges -Profile Any | Out-Null
Log "防火墙允许 Tailscale 100.64/10 与 RFC1918 私网访问；未向公网任意地址开放。"

try {
    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $GuardianInstalled)
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Log "已创建 Windows 登录后静默后台守护任务。"
} catch {
    Log "警告：自动启动任务创建失败，但本次仍继续启动服务。"
}

Remove-Item -LiteralPath $StopSignal -Force -ErrorAction SilentlyContinue
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $GuardianInstalled)
Start-Sleep -Seconds 3

$accessIPs = @(Get-EligibleIPv4 | ForEach-Object { $_.IP })
$urls = @($accessIPs | ForEach-Object { "http://{0}:{1}/" -f $_,$publicPort })
$healthy = $false
$encodedPassword = [uri]::EscapeDataString($password)
foreach ($url in $urls) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri ("{0}api/health?pin={1}" -f $url,$encodedPassword) -TimeoutSec 4
        if ($r.StatusCode -eq 200) { $healthy = $true; break }
    } catch {}
}
$urlText = ($urls -join "`r`n")
$info = @"
雷电浏览器低延迟远控 v3.0.0-alpha5
=================================

可用 Safari 地址（使用当前所在网络对应的那个地址）：
$urlText

访问密码：
$password

连接方式：
- Tailscale：使用 100.64.0.0/10 范围内本机地址
- 蒲公英：使用蒲公英虚拟网卡地址
- 普通局域网：使用运行本程序电脑的 10.x / 172.16-31.x / 192.168.x 地址

说明：192.168.1.1 只有在运行本程序的电脑自身就是该地址时才应使用；多数家庭网络中它是路由器地址。

后台服务：
- Windows 登录后由计划任务静默启动，不弹 CMD 窗口
- Guardian 会监控桥接和各网卡网关实例，异常退出会自动重新拉起
- stop-service.bat 可明确停止本次后台服务
- start-service.bat 可重新静默启动
- change-password.bat 可修改访问密码

安全：
- Windows 防火墙只允许 Tailscale 100.64/10 与 RFC1918 私网来源
- 不向任意公网来源开放
- 浏览器访问需要 6-64 位密码；旧 6 位 PIN 继续兼容
- ADB 和 scrcpy 内部桥只监听 127.0.0.1

注意：当前安装包内的 webrtc-gateway.exe 是已有预编译版本，因此内部桥接仍兼容外部访问密码。
BridgeKey 已预留在配置中，待后续拥有 Go 网关源码时可彻底拆分为独立内部凭据。
"@
$infoPath = Join-Path $PSScriptRoot "iPhone连接信息.txt"
$info | Set-Content -LiteralPath $infoPath -Encoding UTF8
try { (($urls -join "`r`n") + "`r`nPassword: " + $password) | Set-Clipboard } catch {}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
if ($healthy) {
    Write-Host " v3 WebRTC 实时远控服务已启动" -ForegroundColor Green
} else {
    Write-Host " v3 已安装，后台服务仍在启动/等待" -ForegroundColor Yellow
}
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "iPhone Safari：" -ForegroundColor White
foreach ($u in $urls) { Write-Host $u -ForegroundColor Cyan }
Write-Host "访问密码：$password" -ForegroundColor Cyan
Write-Host ""
Write-Host "连接信息已生成：$infoPath"
Write-Host "以后 Windows 登录后会静默启动后台守护服务。"
Write-Host ""
Log "=== v3.0.0-alpha5 配置完成 ==="
Read-Host "按回车关闭窗口"
