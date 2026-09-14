const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const PASSWORD_RE = /^[A-Za-z0-9._~!@#%+=-]{6,64}$/;
const TASK_NAME = 'LDPlayer-Browser-Remote-v3-AutoStart';

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

class RuntimeService {
  constructor(app) {
    this.app = app;
    this.stateDir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'LDPlayer-Browser-Remote-v3');
    this.configPath = path.join(this.stateDir, 'config.ini');
    this.runtimeLog = path.join(this.stateDir, 'runtime.log');
    this.setupLog = path.join(this.stateDir, 'setup.log');
    this.uiSettingsPath = path.join(app.getPath('userData'), 'latens-ui.json');
  }

  exists(file) {
    try { return fs.existsSync(file); } catch (_) { return false; }
  }

  readConfig() {
    if (!this.exists(this.configPath)) return {};
    const text = fs.readFileSync(this.configPath, 'utf8').replace(/^\uFEFF/, '');
    const result = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i <= 0) continue;
      result[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return result;
  }

  getPassword() {
    const c = this.readConfig();
    return c.AccessPassword || c.Pin || '';
  }

  readUiSettings() {
    try {
      if (!this.exists(this.uiSettingsPath)) return {};
      return JSON.parse(fs.readFileSync(this.uiSettingsPath, 'utf8'));
    } catch (_) { return {}; }
  }

  writeUiSettings(settings) {
    fs.mkdirSync(path.dirname(this.uiSettingsPath), { recursive: true });
    const tmp = `${this.uiSettingsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmp, this.uiSettingsPath);
  }

  getUiSetting(key, fallback) {
    const s = this.readUiSettings();
    return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : fallback;
  }

  setUiSetting(key, value) {
    const s = this.readUiSettings();
    s[key] = value;
    this.writeUiSettings(s);
  }

  isAllowedIPv4(address) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }

  classifyInterface(name, address) {
    const text = String(name || '');
    if (/^100\./.test(address) || /tailscale/i.test(text)) return { type: 'tailscale', label: 'Tailscale', rank: 0 };
    if (/蒲公英|pgy|oray|vpn/i.test(text)) return { type: 'vpn', label: '蒲公英 / VPN', rank: 1 };
    if (/^192\.168\./.test(address)) return { type: 'lan', label: '局域网', rank: 2 };
    return { type: 'private', label: '私有网络', rank: 3 };
  }

  getAddresses(publicPort) {
    const result = [];
    const interfaces = os.networkInterfaces();
    for (const [name, items] of Object.entries(interfaces)) {
      const allowedVirtual = /tailscale|蒲公英|pgy|oray|vpn/i.test(name);
      const noise = /vEthernet|WSL|Hyper-V|VMware|VirtualBox|Docker|Npcap|Loopback|Bluetooth|Teredo|isatap/i.test(name);
      if (noise && !allowedVirtual) continue;
      for (const item of items || []) {
        if (item.family !== 'IPv4' || item.internal || !this.isAllowedIPv4(item.address)) continue;
        const kind = this.classifyInterface(name, item.address);
        result.push({
          name,
          address: item.address,
          type: kind.type,
          label: kind.label,
          rank: kind.rank,
          url: publicPort ? `http://${item.address}:${publicPort}/` : ''
        });
      }
    }
    const seen = new Set();
    return result
      .sort((a, b) => a.rank - b.rank || a.address.localeCompare(b.address))
      .filter((item) => !seen.has(item.address) && seen.add(item.address));
  }

  readPid(file) {
    try {
      const value = Number(fs.readFileSync(file, 'utf8').trim());
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch (_) { return null; }
  }

  isProcessAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (e) { return e && e.code === 'EPERM'; }
  }

  getPidStatus(file) {
    const pid = this.readPid(file);
    return { pid, alive: this.isProcessAlive(pid) };
  }

  getGatewayStatuses() {
    if (!this.exists(this.stateDir)) return [];
    let names = [];
    try { names = fs.readdirSync(this.stateDir).filter((n) => /^gateway-.*\.pid$/i.test(n)); } catch (_) {}
    return names.map((name) => ({ name, ...this.getPidStatus(path.join(this.stateDir, name)) }));
  }

  async getLdPlayerStatus(config) {
    const exe = config.LDConsole;
    const index = Number(config.InstanceIndex || 0);
    if (!exe || !this.exists(exe)) return { detected: false, running: false, index };
    try {
      const { stdout } = await execFileAsync(exe, ['list2'], { windowsHide: true, timeout: 3500, maxBuffer: 1024 * 1024 });
      for (const raw of String(stdout).split(/\r?\n/)) {
        const p = raw.trim().split(',');
        if (p.length < 5 || Number(p[0]) !== index) continue;
        return { detected: true, running: p[4].trim() === '1', index, name: p[1] || `实例 ${index}` };
      }
      return { detected: true, running: false, index };
    } catch (_) { return { detected: true, running: false, index }; }
  }

  async getLegacyTaskAutoStart() {
    try {
      const { stdout } = await execFileAsync('schtasks.exe', ['/Query', '/TN', TASK_NAME, '/XML'], { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 });
      const text = String(stdout || '');
      const match = text.match(/<Enabled>\s*(true|false)\s*<\/Enabled>/i);
      return { present: true, enabled: match ? match[1].toLowerCase() === 'true' : true };
    } catch (_) {
      return { present: false, enabled: false };
    }
  }

  async getSnapshot() {
    const config = this.readConfig();
    const installed = this.exists(this.configPath) && this.exists(path.join(this.stateDir, 'Guardian.ps1'));
    const guardian = this.getPidStatus(path.join(this.stateDir, 'guardian.pid'));
    const bridge = this.getPidStatus(path.join(this.stateDir, 'bridge.pid'));
    const gateways = this.getGatewayStatuses();
    const aliveGateways = gateways.filter((g) => g.alive).length;
    const publicPort = Number(config.PublicPort || 0);
    const addresses = this.getAddresses(publicPort);
    const [ldplayer, legacyTask] = await Promise.all([this.getLdPlayerStatus(config), this.getLegacyTaskAutoStart()]);
    const appAutoStart = this.app.getLoginItemSettings().openAtLogin;
    let serviceState = 'stopped';
    if (guardian.alive && bridge.alive && aliveGateways > 0) serviceState = 'running';
    else if (guardian.alive || bridge.alive || aliveGateways > 0) serviceState = 'degraded';

    return {
      version: this.app.getVersion(),
      installed,
      stateDir: this.stateDir,
      serviceState,
      guardian,
      bridge,
      gateways,
      aliveGateways,
      addresses,
      ldplayer,
      publicPort,
      config: {
        maxSize: Number(config.MaxSize || 1280),
        maxFps: Number(config.MaxFps || 30),
        videoBitRate: Number(config.VideoBitRate || 3000000),
        instanceIndex: Number(config.InstanceIndex || 0)
      },
      autoStart: appAutoStart || legacyTask.enabled,
      appAutoStart,
      legacyTask,
      hasPassword: Boolean(config.AccessPassword || config.Pin)
    };
  }

  async runElevatedScript(scriptText, timeout = 60000) {
    const temp = path.join(os.tmpdir(), `latens-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
    fs.writeFileSync(temp, `\uFEFF${scriptText}`, 'utf8');
    const argLine = `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${temp.replace(/"/g, '""')}"`;
    const launcher = `$p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '${psQuote(argLine)}'; exit $p.ExitCode`;
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', launcher], { windowsHide: true, timeout });
    } catch (error) {
      throw new Error(`管理员操作失败或已取消：${error.message || error}`);
    } finally {
      try { fs.rmSync(temp, { force: true }); } catch (_) {}
    }
  }

  lifecycleScript(action) {
    const state = psQuote(this.stateDir);
    const task = psQuote(TASK_NAME);
    const common = `$ErrorActionPreference='Stop'\n$state='${state}'\n$task='${task}'\n$stop=Join-Path $state 'stop.signal'\nfunction Stop-Latens {\n  New-Item -ItemType File -Path $stop -Force | Out-Null\n  try { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue } catch {}\n  Start-Sleep -Milliseconds 500\n  $files=@((Join-Path $state 'guardian.pid'),(Join-Path $state 'bridge.pid'),(Join-Path $state 'gateway.pid'))\n  $files += @(Get-ChildItem -LiteralPath $state -Filter 'gateway-*.pid' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })\n  foreach($f in $files){ if(Test-Path -LiteralPath $f){ try { Stop-Process -Id ([int](Get-Content -LiteralPath $f -Raw)) -Force -ErrorAction SilentlyContinue } catch {}; Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue } }\n}\nfunction Start-Latens {\n  Remove-Item -LiteralPath $stop -Force -ErrorAction SilentlyContinue\n  $guardian=Join-Path $state 'Guardian.ps1'\n  if(-not(Test-Path -LiteralPath $guardian)){ exit 2 }\n  $alive=$false\n  $pidFile=Join-Path $state 'guardian.pid'\n  if(Test-Path -LiteralPath $pidFile){ try { $gp=[int](Get-Content -LiteralPath $pidFile -Raw); if(Get-Process -Id $gp -ErrorAction SilentlyContinue){$alive=$true} } catch {} }\n  if(-not $alive){ try { Start-ScheduledTask -TaskName $task -ErrorAction Stop } catch { $a='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$guardian+'"'; Start-Process powershell.exe -WindowStyle Hidden -ArgumentList $a } }\n}\n`;
    if (action === 'start') return `${common}\nStart-Latens\n`;
    if (action === 'stop') return `${common}\nStop-Latens\n`;
    return `${common}\nStop-Latens\nStart-Sleep -Milliseconds 350\nStart-Latens\n`;
  }

  async startService() {
    const guardian = path.join(this.stateDir, 'Guardian.ps1');
    if (!this.exists(guardian)) throw new Error('未检测到后台组件。请先使用 alpha5.1 完整包完成一次安装。');
    const current = this.getPidStatus(path.join(this.stateDir, 'guardian.pid'));
    if (!current.alive) await this.runElevatedScript(this.lifecycleScript('start'));
    await new Promise((resolve) => setTimeout(resolve, 900));
    return this.getSnapshot();
  }

  async stopService() {
    if (!this.exists(this.stateDir)) return this.getSnapshot();
    await this.runElevatedScript(this.lifecycleScript('stop'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    return this.getSnapshot();
  }

  async restartService() {
    if (!this.exists(path.join(this.stateDir, 'Guardian.ps1'))) throw new Error('未检测到后台组件。');
    await this.runElevatedScript(this.lifecycleScript('restart'));
    await new Promise((resolve) => setTimeout(resolve, 900));
    return this.getSnapshot();
  }

  configScript(updates) {
    const pairs = Object.entries(updates).map(([key, value]) => `  '${psQuote(key)}'='${psQuote(value)}'`).join("\n");
    return `$ErrorActionPreference='Stop'\n$config='${psQuote(this.configPath)}'\nif(-not(Test-Path -LiteralPath $config)){ exit 3 }\n$updates=[ordered]@{\n${pairs}\n}\n$lines=@(Get-Content -LiteralPath $config -Encoding UTF8)\nforeach($key in @($updates.Keys)){\n  $found=$false\n  for($i=0;$i -lt $lines.Count;$i++){\n    if($lines[$i] -match ('^'+[regex]::Escape($key)+'=')){ $lines[$i]=$key+'='+$updates[$key]; $found=$true }\n  }\n  if(-not $found){ $lines += ($key+'='+$updates[$key]) }\n}\n$lines | Set-Content -LiteralPath $config -Encoding UTF8\n`;
  }

  async changePassword(password) {
    const value = String(password || '');
    if (!PASSWORD_RE.test(value)) throw new Error('密码必须为 6–64 位，只允许字母、数字及 . _ ~ ! @ # % + = -');
    await this.runElevatedScript(`${this.configScript({ AccessPassword: value, Pin: value })}\n${this.lifecycleScript('restart')}`);
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { ok: true };
  }

  getLogs(lines = 250) {
    const count = Math.max(20, Math.min(2000, Number(lines) || 250));
    const readTail = (file) => {
      try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-count).join('\n'); }
      catch (_) { return ''; }
    };
    return { runtime: readTail(this.runtimeLog), setup: readTail(this.setupLog) };
  }

  healthCheck(url, password) {
    return new Promise((resolve) => {
      if (!url || !password) return resolve({ ok: false, error: '缺少地址或密码' });
      const target = `${url}api/health?pin=${encodeURIComponent(password)}`;
      const started = Date.now();
      const req = http.get(target, { timeout: 2500 }, (res) => {
        res.resume();
        resolve({ ok: res.statusCode === 200, statusCode: res.statusCode, ms: Date.now() - started });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (error) => resolve({ ok: false, error: error.message, ms: Date.now() - started }));
    });
  }

  async runDiagnostics() {
    const snapshot = await this.getSnapshot();
    const password = this.getPassword();
    const checks = [];
    for (const item of snapshot.addresses) checks.push({ ...item, ...(await this.healthCheck(item.url, password)) });
    return {
      generatedAt: new Date().toISOString(),
      snapshot,
      checks,
      logs: this.getLogs(120)
    };
  }

  getSettings() {
    const c = this.readConfig();
    return {
      maxSize: Number(c.MaxSize || 1280),
      maxFps: Number(c.MaxFps || 30),
      videoBitRate: Number(c.VideoBitRate || 3000000),
      instanceIndex: Number(c.InstanceIndex || 0),
      publicPort: Number(c.PublicPort || 0),
      autoStart: this.app.getLoginItemSettings().openAtLogin
    };
  }

  validateInteger(name, value, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 必须在 ${min}–${max} 范围内。`);
    return n;
  }

  async saveSettings(settings) {
    const maxSize = this.validateInteger('最大分辨率', settings.maxSize, 480, 4096);
    const maxFps = this.validateInteger('最大帧率', settings.maxFps, 15, 120);
    const videoBitRate = this.validateInteger('视频码率', settings.videoBitRate, 500000, 30000000);
    const instanceIndex = this.validateInteger('雷电实例编号', settings.instanceIndex, 0, 99);
    const updates = { MaxSize: maxSize, MaxFps: maxFps, VideoBitRate: videoBitRate, InstanceIndex: instanceIndex };
    await this.runElevatedScript(`${this.configScript(updates)}\n${this.lifecycleScript('restart')}`);
    await new Promise((resolve) => setTimeout(resolve, 900));
    return { ok: true, settings: this.getSettings() };
  }
}

module.exports = { RuntimeService };
