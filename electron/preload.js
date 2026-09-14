const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('latens', {
  getSnapshot: () => ipcRenderer.invoke('latens:get-snapshot'),
  startService: () => ipcRenderer.invoke('latens:start-service'),
  stopService: () => ipcRenderer.invoke('latens:stop-service'),
  restartService: () => ipcRenderer.invoke('latens:restart-service'),
  getPassword: () => ipcRenderer.invoke('latens:get-password'),
  changePassword: (password) => ipcRenderer.invoke('latens:change-password', password),
  getLogs: (lines) => ipcRenderer.invoke('latens:get-logs', lines),
  runDiagnostics: () => ipcRenderer.invoke('latens:run-diagnostics'),
  getSettings: () => ipcRenderer.invoke('latens:get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('latens:save-settings', settings),
  setAutoStart: (enabled) => ipcRenderer.invoke('latens:set-auto-start', enabled),
  copyText: (text) => ipcRenderer.invoke('latens:copy-text', text),
  openExternal: (url) => ipcRenderer.invoke('latens:open-external', url),
  showWindow: () => ipcRenderer.invoke('latens:show-window')
});
