const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, clipboard, dialog } = require('electron');
const { RuntimeService } = require('./runtime-service');

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
    { label: '退出控制中心（服务继续运行）', click: () => { quitting = true; app.quit(); } }
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
  ipcMain.handle('latens:set-auto-start', (_event, enabled) => {
    const value = Boolean(enabled);
    app.setLoginItemSettings({ openAtLogin: value, args: ['--background'] });
    runtime.setUiSetting('startServiceOnLaunch', value);
    return { ok: true, enabled: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle('latens:copy-text', (_event, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
  ipcMain.handle('latens:open-external', async (_event, url) => { await shell.openExternal(String(url)); return { ok: true }; });
  ipcMain.handle('latens:show-window', () => { showMainWindow(); return { ok: true }; });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.latens.remote');
  runtime = new RuntimeService(app);
  registerIpc();
  createWindow();
  createTray();

  if (process.argv.includes('--background') && runtime.getUiSetting('startServiceOnLaunch', false)) {
    try { await runtime.startService(); } catch (_) {}
  }

  if (process.platform !== 'win32') {
    dialog.showMessageBox({ type: 'warning', title: 'Latens', message: '当前版本仅支持 Windows。' });
  }
});

app.on('activate', () => showMainWindow());
app.on('window-all-closed', (event) => {
  if (process.platform !== 'darwin') event.preventDefault?.();
});
app.on('before-quit', () => { quitting = true; });
