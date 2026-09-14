const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const PASSWORD_RE = /^[A-Za-z0-9._~!@#%+=-]{6,64}$/;

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

  updateConfig(updates) {
    if (!this.exists(this.configPath)) throw new Error('尚未安装 Latens 后台运行组件。');
    const original = fs.readFileSync(this.configPath, 'utf8').replace(/^\uFEFF/, '');
    const pending = new Map(Object.entries(updates).map(([k, v]) => [k, String(v)]));
    const lines = original.split(/\r?\n/).map((raw) => {
      const i = raw.indexOf('=');
      if (i <= 0) return raw;
      const key = raw.slice(0, i).trim();
      if (!pending.has(key)) return raw;
      const value = pending.get(key);
      pending.delete(key);
      return `${key}=${value}`;
    });
    for (const [key, value] of pending) lines.push(`${key}=${value}`);
    const tmp = `${this.configPath}.tmp`;
    fs.writeFileSync(tmp, lines.join('\r\n'), 'utf8');
    fs.renameSync(tmp, this.configPath);
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

  async getSnapshot() {
    const config = this.readConfig();
    const installed = this.exists(this.configPath) && this.exists(path.join(this.stateDir, 'Guardian.ps1'));
    const guardian = this.getPidStatus(path.join(this.stateDir, 'guardian.pid'));
    const bridge = this.getPidStatus(path.join(this.stateDir, 'bridge.pid'));
    const gateways = this.getGatewayStatuses();
    const aliveGateways = gateways.filter((g) => g.alive).length;
    const publicPort = Number(config.PublicPort || 0);
    const addresses = this.getAddresses(publicPort);
    const ldplayer = await this.getLdPlayerStatus(config);
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
      autoStart: this.app.getLoginItemSettings().openAtLogin,
      hasPassword: Boolean(config.AccessPassword || config.Pin)
    };
  }

  spawnHiddenPowerShell(script) {
    const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
    child.unref();
  }

  async startService() {
    const guardian = path.join(this.stateDir, 'Guardian.ps1');
    if (!this.exists(guardian)) throw new Error('未检测到后台组件。请先使用 alpha5.1 完整包完成一次安装。');
    try { fs.rmSync(path.join(this.stateDir, 'stop.signal'), { force: true }); } catch (_) {}
    const current = this.getPidStatus(path.join(this.stateDir, 'guardian.pid'));
    if (!current.alive) this.spawnHiddenPowerShell(guardian);
    await new Promise((resolve) => setTimeout(resolve, 900));
    return this.getSnapshot();
  }

  async killPid(pid) {
    if (!pid || !this.isProcessAlive(pid)) return;
    try { await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }); } catch (_) {}
  }

  async stopService() {
    if (!this.exists(this.stateDir)) return this.getSnapshot();
    try { fs.writeFileSync(path.join(this.stateDir, 'stop.signal'), '', 'utf8'); } catch (_) {}
    const pidFiles = ['guardian.pid', 'bridge.pid', 'gateway.pid'];
    try { pidFiles.push(...fs.readdirSync(this.stateDir).filter((n) => /^gateway-.*\.pid$/i.test(n))); } catch (_) {}
    const pids = new Set(pidFiles.map((n) => this.readPid(path.join(this.stateDir, n))).filter(Boolean));
    for (const pid of pids) await this.killPid(pid);
    for (const name of pidFiles) { try { fs.rmSync(path.join(this.stateDir, name), { force: true }); } catch (_) {} }
    await new Promise((resolve) => setTimeout(resolve, 400));
    return this.getSnapshot();
  }

  async restartService() {
    await this.stopService();
    try { fs.rmSync(path.join(this.stateDir, 'stop.signal'), { force: true }); } catch (_) {}
    return this.startService();
  }

  async changePassword(password) {
    const value = String(password || '');
    if (!PASSWORD_RE.test(value)) throw new Error('密码必须为 6–64 位，只允许字母、数字及 . _ ~ ! @ # % + = -');
    this.updateConfig({ AccessPassword: value, Pin: value });
    await this.restartService();
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
    this.updateConfig({ MaxSize: maxSize, MaxFps: maxFps, VideoBitRate: videoBitRate, InstanceIndex: instanceIndex });
    await this.restartService();
    return { ok: true, settings: this.getSettings() };
  }
}

module.exports = { RuntimeService };
