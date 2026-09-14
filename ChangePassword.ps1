#requires -version 5.1
$ErrorActionPreference = "Stop"
$StateDir = Join-Path $env:ProgramData "LDPlayer-Browser-Remote-v3"
$ConfigPath = Join-Path $StateDir "config.ini"
if(-not(Test-Path -LiteralPath $ConfigPath)){Write-Host '尚未安装。' -ForegroundColor Red;Read-Host '按回车关闭';exit 1}
function ToPlain([Security.SecureString]$s){$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}}
Write-Host '请输入新的 6-64 位访问密码。允许英文字母、数字及 . _ ~ ! @ # % + = -' -ForegroundColor Cyan
$pw=ToPlain (Read-Host '新密码' -AsSecureString)
if($pw -notmatch '^[A-Za-z0-9._~!@#%+=-]{6,64}$'){Write-Host '密码格式不符合要求，未修改。' -ForegroundColor Red;Read-Host '按回车关闭';exit 2}
$lines=Get-Content -LiteralPath $ConfigPath -Encoding UTF8
$done=$false
for($i=0;$i-lt$lines.Count;$i++){if($lines[$i]-match '^AccessPassword='){$lines[$i]='AccessPassword='+$pw;$done=$true};if($lines[$i]-match '^Pin='){$lines[$i]='Pin='+$pw}}
if(-not$done){$lines += 'AccessPassword='+$pw}
$lines|Set-Content -LiteralPath $ConfigPath -Encoding UTF8
& (Join-Path $PSScriptRoot 'Restart.ps1')
Write-Host '访问密码已修改并重新启动后台服务。' -ForegroundColor Green
