const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let snapshot = null;
let currentPage = 'home';
let passwordVisible = false;
let activeLog = 'runtime';
let toastTimer = null;

const pageMeta = {
  home: ['首页', '远控运行状态与快速操作'],
  network: ['网络', 'Tailscale、蒲公英 / VPN 与局域网入口'],
  service: ['服务', '后台守护与运行组件管理'],
  settings: ['设置', '密码、登录自启与运行参数'],
  diagnostics: ['诊断', '检查网络入口与组件健康状态'],
  logs: ['日志', '查看 UTF-8 运行日志与安装日志']
};

function showToast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

function serviceLabel(state) {
  if (state === 'running') return '运行中';
  if (state === 'degraded') return '部分异常';
  return '已停止';
}

function pidLabel(item) {
  return item?.alive ? `运行中 · PID ${item.pid}` : '未运行';
}

function setBadge(el, state, text) {
  el.className = `badge ${state || 'neutral'}`;
  el.textContent = text;
}

function setGlobalState(state) {
  const label = serviceLabel(state);
  $('#globalStatus').className = `status-pill ${state}`;
  $('#globalStatus').textContent = label;
  $('#sideDot').className = `dot ${state}`;
  $('#sideStatus').textContent = label;
}

function setPage(name) {
  currentPage = name;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  $$('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === name));
  const [title, subtitle] = pageMeta[name] || pageMeta.home;
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
  if (name === 'logs') refreshLogs();
  if (name === 'settings') loadSettings();
}

function createAddressRow(item, detailed = false) {
  const row = document.createElement('div');
  row.className = 'address-row';

  const kind = document.createElement('div');
  kind.className = 'address-kind';
  const dot = document.createElement('i');
  dot.className = item.type;
  const label = document.createElement('span');
  label.textContent = item.label;
  kind.append(dot, label);

  if (detailed) {
    const iface = document.createElement('span');
    iface.className = 'muted';
    iface.textContent = item.name;
    row.append(kind, iface);
  } else row.append(kind);

  const url = document.createElement('div');
  url.className = 'address-url';
  url.textContent = item.url || item.address;
  row.append(url);

  const actions = document.createElement('div');
  actions.className = 'address-actions';
  const copy = document.createElement('button');
  copy.textContent = '复制';
  copy.onclick = async () => { await window.latens.copyText(item.url); showToast('地址已复制'); };
  const open = document.createElement('button');
  open.textContent = '打开';
  open.onclick = () => window.latens.openExternal(item.url);
  actions.append(copy, open);
  row.append(actions);
  return row;
}

function renderAddresses() {
  const addresses = snapshot?.addresses || [];
  $('#addressCount').textContent = `${addresses.length} 个`;
  for (const id of ['#homeAddresses', '#networkAddresses']) {
    const container = $(id);
    container.innerHTML = '';
    if (!addresses.length) {
      container.className = id === '#homeAddresses' ? 'address-list empty' : 'network-table';
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = '暂未发现可用私网地址。请检查 Tailscale、蒲公英或局域网连接。';
      container.append(empty);
      continue;
    }
    container.className = id === '#homeAddresses' ? 'address-list' : 'network-table';
    addresses.forEach((item) => container.append(createAddressRow(item, id === '#networkAddresses')));
  }
}

function renderSnapshot() {
  if (!snapshot) return;
  $('#appVersion').textContent = `Latens v${snapshot.version}`;
  $('#notInstalledBanner').classList.toggle('hidden', snapshot.installed);
  setGlobalState(snapshot.serviceState);
  setBadge($('#serviceBadge'), snapshot.serviceState, serviceLabel(snapshot.serviceState));
  $('#serviceDot').className = `big-dot ${snapshot.serviceState}`;
  $('#serviceText').textContent = serviceLabel(snapshot.serviceState);
  $('#serviceDetail').textContent = `Guardian ${snapshot.guardian.alive ? '在线' : '离线'} · Bridge ${snapshot.bridge.alive ? '在线' : '离线'} · Gateway ${snapshot.aliveGateways} 个`;

  const ldState = snapshot.ldplayer?.running ? 'running' : 'stopped';
  setBadge($('#ldBadge'), ldState, snapshot.ldplayer?.running ? '运行中' : '未运行');
  $('#ldTitle').textContent = snapshot.ldplayer?.name || `实例 ${snapshot.ldplayer?.index ?? 0}`;
  $('#ldDetail').textContent = snapshot.ldplayer?.detected ? `雷电实例 ${snapshot.ldplayer.index}` : '未检测到雷电控制程序';

  $('#guardianState').textContent = snapshot.guardian.alive ? '运行中' : '未运行';
  $('#bridgeState').textContent = snapshot.bridge.alive ? '运行中' : '未运行';
  $('#gatewayState').textContent = `${snapshot.aliveGateways} 个运行中`;
  $('#autoStartState').textContent = snapshot.autoStart ? '已开启' : '未开启';
  $('#serviceGuardian').textContent = pidLabel(snapshot.guardian);
  $('#serviceBridge').textContent = pidLabel(snapshot.bridge);
  $('#serviceGateway').textContent = snapshot.aliveGateways ? `${snapshot.aliveGateways} 个运行中` : '未运行';
  $('#serviceLd').textContent = snapshot.ldplayer?.running ? '运行中' : '未运行';
  $('#autoStartToggle').checked = Boolean(snapshot.autoStart);
  renderAddresses();
}

async function refreshSnapshot(silent = false) {
  try {
    snapshot = await window.latens.getSnapshot();
    renderSnapshot();
  } catch (error) {
    if (!silent) showToast(error.message || '读取状态失败', true);
  }
}

async function action(fn, successText) {
  try {
    document.body.style.cursor = 'progress';
    await fn();
    await refreshSnapshot(true);
    if (successText) showToast(successText);
  } catch (error) {
    showToast(error.message || '操作失败', true);
  } finally { document.body.style.cursor = ''; }
}

async function togglePassword() {
  try {
    if (passwordVisible) {
      $('#passwordPreview').textContent = '••••••••••••';
      $('#togglePasswordBtn').textContent = '显示';
      passwordVisible = false;
      return;
    }
    const value = await window.latens.getPassword();
    $('#passwordPreview').textContent = value || '未设置';
    $('#togglePasswordBtn').textContent = '隐藏';
    passwordVisible = true;
  } catch (error) { showToast(error.message || '读取密码失败', true); }
}

async function loadSettings() {
  try {
    const s = await window.latens.getSettings();
    $('#instanceIndex').value = s.instanceIndex;
    $('#maxSize').value = s.maxSize;
    $('#maxFps').value = s.maxFps;
    $('#videoBitRate').value = s.videoBitRate;
    $('#publicPort').value = s.publicPort;
    $('#autoStartToggle').checked = Boolean(s.autoStart);
  } catch (error) { showToast(error.message || '读取设置失败', true); }
}

async function savePassword() {
  const a = $('#newPassword').value;
  const b = $('#confirmPassword').value;
  if (a !== b) return showToast('两次输入的密码不一致', true);
  if (!/^[A-Za-z0-9._~!@#%+=-]{6,64}$/.test(a)) return showToast('密码格式不符合要求', true);
  await action(() => window.latens.changePassword(a), '访问密码已修改，服务已重启');
  $('#newPassword').value = '';
  $('#confirmPassword').value = '';
  passwordVisible = false;
  $('#passwordPreview').textContent = '••••••••••••';
  $('#togglePasswordBtn').textContent = '显示';
}

async function saveRuntimeSettings() {
  const settings = {
    instanceIndex: Number($('#instanceIndex').value),
    maxSize: Number($('#maxSize').value),
    maxFps: Number($('#maxFps').value),
    videoBitRate: Number($('#videoBitRate').value)
  };
  await action(() => window.latens.saveSettings(settings), '运行参数已保存，服务已重启');
}

async function runDiagnostics() {
  $('#diagnosticSummary').textContent = '正在执行诊断…';
  $('#diagnosticChecks').innerHTML = '';
  try {
    const d = await window.latens.runDiagnostics();
    const s = d.snapshot;
    const passed = d.checks.filter((c) => c.ok).length;
    $('#diagnosticSummary').textContent = `服务：${serviceLabel(s.serviceState)}；雷电：${s.ldplayer.running ? '运行中' : '未运行'}；网络健康检查：${passed}/${d.checks.length} 通过。`;
    const box = $('#diagnosticChecks');
    if (!d.checks.length) {
      box.textContent = '没有可检测的私网入口。';
      return;
    }
    for (const check of d.checks) {
      const row = document.createElement('div');
      row.className = 'diag-row';
      const kind = document.createElement('span'); kind.textContent = check.label;
      const url = document.createElement('code'); url.textContent = check.url;
      const result = document.createElement('strong');
      result.className = check.ok ? 'diag-ok' : 'diag-fail';
      result.textContent = check.ok ? `正常 ${check.ms}ms` : '失败';
      row.append(kind, url, result); box.append(row);
    }
  } catch (error) {
    $('#diagnosticSummary').textContent = `诊断失败：${error.message || error}`;
  }
}

async function refreshLogs() {
  try {
    const logs = await window.latens.getLogs(500);
    $('#logViewer').textContent = logs[activeLog] || '暂无日志。';
  } catch (error) { $('#logViewer').textContent = `读取失败：${error.message || error}`; }
}

$$('.nav-item').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
$$('[data-go]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.go)));
$('#refreshBtn').onclick = () => refreshSnapshot();
$('#networkRefreshBtn').onclick = () => refreshSnapshot();
$('#togglePasswordBtn').onclick = togglePassword;

for (const id of ['startBtn', 'serviceStartBtn']) $(id).onclick = () => action(() => window.latens.startService(), '远控服务已启动');
for (const id of ['stopBtn', 'serviceStopBtn']) $(id).onclick = () => action(() => window.latens.stopService(), '远控服务已停止');
for (const id of ['restartBtn', 'serviceRestartBtn']) $(id).onclick = () => action(() => window.latens.restartService(), '远控服务已重启');

$('#savePasswordBtn').onclick = savePassword;
$('#saveRuntimeSettingsBtn').onclick = saveRuntimeSettings;
$('#autoStartToggle').onchange = async (event) => {
  try {
    const result = await window.latens.setAutoStart(event.target.checked);
    event.target.checked = Boolean(result.enabled);
    showToast(result.enabled ? '已开启 Windows 登录自启' : '已关闭 Windows 登录自启');
    await refreshSnapshot(true);
  } catch (error) {
    event.target.checked = !event.target.checked;
    showToast(error.message || '修改自启设置失败', true);
  }
};
$('#diagnoseBtn').onclick = runDiagnostics;
$('#logsRefreshBtn').onclick = refreshLogs;
$$('.log-tabs button').forEach((button) => button.onclick = () => {
  activeLog = button.dataset.log;
  $$('.log-tabs button').forEach((b) => b.classList.toggle('active', b === button));
  refreshLogs();
});

refreshSnapshot();
setInterval(() => refreshSnapshot(true), 2500);
