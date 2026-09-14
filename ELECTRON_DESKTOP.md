# Latens v3.1.0 Electron Desktop

本分支将 alpha5.1 的命令行/脚本操作面收拢到一个纯中文 Electron 控制中心，同时保持现有 WebRTC、scrcpy、H.264、DataChannel 和 Gateway 协议逻辑不变。

## 当前 beta1 能力

- 纯中文桌面 UI：主页、网络、服务、设置、诊断、日志。
- 关闭窗口后缩到 Windows 系统托盘，不弹 CMD。
- 托盘支持启动、停止、重启远控服务。
- 自动识别并展示 Tailscale、蒲公英/VPN、普通私有局域网地址。
- 地址支持一键复制和浏览器打开。
- 显示 Guardian、Bridge、Gateway、雷电主实例状态。
- UI 内查看/修改 6–64 位访问密码；保存后自动重启服务。
- UI 内修改雷电实例号、最大分辨率、最大 FPS、视频码率。
- Windows 登录自启开关同时同步 Electron 自启和 alpha5.1 旧计划任务，避免关闭开关后旧任务仍启动服务。
- 一键健康诊断：逐个访问当前网络入口的 `/api/health`。
- UI 内读取 UTF-8 `runtime.log` 与 `setup.log`。
- Renderer 启用 `contextIsolation`，禁用 `nodeIntegration`，所有系统操作只通过 preload 暴露的最小 IPC API。

## 当前迁移策略

beta1 直接管理已经安装在：

```text
C:\ProgramData\LDPlayer-Browser-Remote-v3
```

的 alpha5.1 运行时。因此它不复制、不替换 `webrtc-gateway.exe`、Bridge 或 scrcpy 链路，也不会重写现有视频/控制协议。

如果没有检测到已安装运行时，UI 会明确提示先用 alpha5.1 完整包完成一次安装，而不是伪装成可用状态。

## 为什么 beta1 先这样做

当前 GitHub 仓库没有提交预编译 `webrtc-gateway.exe`，只有其 SHA-256；Go 网关源码也不在 alpha4/alpha5 基线中。先让 Electron 管理现有、已验证过的运行时，可以把 UI、托盘、配置和生命周期管理从底层视频链路中隔离出来，降低一次性重构风险。

后续独立阶段再把 alpha5.1 的首次初始化逻辑和网关二进制一起纳入 Electron 安装器，使最终用户只需要 `Latens-Setup.exe`。

## 本地开发

```powershell
npm install
npm run test:syntax
npm start
```

Windows 安装包：

```powershell
npm run build:win
```

输出目录默认是 `dist/`。

## 关闭行为

- 点击窗口右上角关闭：隐藏到系统托盘，服务继续运行。
- 托盘“退出控制中心（服务继续运行）”：只退出 Electron 控制中心。
- 托盘“停止服务并退出 Latens”：停止 Guardian/Bridge/Gateway 后退出。

## 版本边界

v3.1.0-beta.1 不修改：

- scrcpy-server 版本与启动参数
- H.264 编码参数
- WebRTC RTP / ICE 实现
- DataChannel 控制协议
- `Bridge.cs` 的视频与触控逻辑
- 预编译 `webrtc-gateway.exe`

上述底层能力继续以 alpha5.1 为运行基线。
