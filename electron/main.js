const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard, dialog } = require('electron');
const { RuntimeService } = require('./runtime-service');

const execFileAsync = promisify(execFile);
const LEGACY_TASK = 'LDPlayer-Browser-Remote-v3-AutoStart';

let mainWindow = null;
let tray = null;
let quitting = false;
let runtime = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

function createTrayImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#111827"/><path d="M8 7h5v13h11v5H8z" fill="#60a5fa"/><circle cx="22.5" cy="9.5" r="3.5" fill="#34d399"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`).resize({ width: 18, height: 18 });
}

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.restore();
  mainWindow.focus();
}

async function setLegacyTaskAutoStart(enabled) {
  const flag = enabled ? '/ENABLE' : '/DISABLE';
  const args = ['/Change', '/TN', LEGACY_TASK, flag];
  try {
    await execFileAsync('schtasks.exe', args, { windowsHide: true, timeout: 8000 });
    return { present: true, elevated: false };
  } catch (error) {
    const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
    if (/cannot find|找不到|不存在/i.test(output)) return { present: false, elevated: false };
    const command = `$p=Start-Process -FilePath 'schtasks.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('/Change','/TN','${LEGACY_TASK}','${flag}'); exit $p.ExitCode`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true, timeout: 30000 });
    return { present: true, elevated: true };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 660,
    show: !process.argv.includes('--background'),
    title: 'Latens 控制中心',
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip('Latens 控制中心');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Latens', click: showMainWindow },
    { type: 'separator' },
    { label: '启动远控服务', click: () => runtime.startService().catch(() => {}) },
    { label: '停止远控服务', click: () => runtime.stopService().catch(() => {}) },
    { label: '重启远控服务', click: () => runtime.restartService().catch(() => {}) },
    { type: 'separator' },
    { label: '退出控制中心（服务继续运行）', click: () => { quitting = true; app.quit(); } },
    { label: '停止服务并退出 Latens', click: async () => { try { await runtime.stopService(); } finally { quitting = true; app.quit(); } } }
  ]));
  tray.on('double-click', showMainWindow);
}

function registerIpc() {
  ipcMain.handle('latens:get-snapshot', () => runtime.getSnapshot());
  ipcMain.handle('latens:start-service', () => runtime.startService());
  ipcMain.handle('latens:stop-service', () => runtime.stopService());
  ipcMain.handle('latens:restart-service', () => runtime.restartService());
  ipcMain.handle('latens:get-password', () => runtime.getPassword());
  ipcMain.handle('latens:change-password', (_event, password) => runtime.changePassword(password));
  ipcMain.handle('latens:get-logs', (_event, lines) => runtime.getLogs(lines));
  ipcMain.handle('latens:run-diagnostics', () => runtime.runDiagnostics());
  ipcMain.handle('latens:get-settings', () => runtime.getSettings());
  ipcMain.handle('latens:save-settings', (_event, settings) => runtime.saveSettings(settings));
  ipcMain.handle('latens:set-auto-start', async (_event, enabled) => {
    const value = Boolean(enabled);
    const previous = app.getLoginItemSettings().openAtLogin;
    try {
      app.setLoginItemSettings({ openAtLogin: value, args: ['--background'] });
      runtime.setUiSetting('startServiceOnLaunch', value);
      const legacyTask = await setLegacyTaskAutoStart(value);
      return { ok: true, enabled: app.getLoginItemSettings().openAtLogin, legacyTask };
    } catch (error) {
      app.setLoginItemSettings({ openAtLogin: previous, args: ['--background'] });
      runtime.setUiSetting('startServiceOnLaunch', previous);
      throw new Error(`修改登录自启失败：${error.message || error}`);
    }
  });
  ipcMain.handle('latens:copy-text', (_event, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
  ipcMain.handle('latens:open-external', async (_event, url) => {
    const target = new URL(String(url));
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('只允许打开 HTTP/HTTPS 地址。');
    await shell.openExternal(target.toString());
    return { ok: true };
  });
  ipcMain.handle('latens:show-window', () => { showMainWindow(); return { ok: true }; });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.latens.remote');
  runtime = new RuntimeService(app);

  const uiSettings = runtime.readUiSettings();
  const legacyTask = await runtime.getLegacyTaskAutoStart();
  if (!Object.prototype.hasOwnProperty.call(uiSettings, 'autoStartMigrated') && legacyTask.present) {
    app.setLoginItemSettings({ openAtLogin: legacyTask.enabled, args: ['--background'] });
    runtime.setUiSetting('startServiceOnLaunch', legacyTask.enabled);
    runtime.setUiSetting('autoStartMigrated', true);
  }

  registerIpc();
  createWindow();
  createTray();

  if (process.platform !== 'win32') {
    dialog.showMessageBox({ type: 'warning', title: 'Latens', message: '当前版本仅支持 Windows。' });
  }
});

app.on('activate', () => showMainWindow());
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; });
