# Latens / LDPlayer Browser Remote

Windows 上的雷电模拟器浏览器低延迟远控工具。视频链路使用 scrcpy H.264 + WebRTC，控制链路使用 WebRTC DataChannel + scrcpy Control Protocol。

## v3.0.0-alpha5 主要变化

- 登录 Windows 后通过高权限计划任务**静默后台启动**，不显示 CMD 窗口。
- 新增 `Guardian.ps1` 常驻守护；桥接或网关异常退出后自动拉起。
- 新增 `stop-service.bat`、`start-service.bat`。
- 自动枚举有效私网 IPv4，并为 Tailscale、蒲公英/VPN、普通局域网分别启动访问入口。
- Windows 防火墙只允许 `100.64.0.0/10`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16` 来源，不对任意公网地址开放。
- 浏览器认证升级为 **6–64 位自定义访问密码**；原 6 位数字 PIN 继续兼容。
- 新增 `change-password.bat`，修改密码后自动重启后台服务。
- 内部 scrcpy/ADB 仍只监听本机回环地址，不暴露给局域网或虚拟组网。

## 安装

以管理员身份运行 `install-and-start.bat`。首次安装会提示设置 6–64 位访问密码；直接留空则自动生成旧版兼容的 6 位数字 PIN。

安装完成后会生成 `iPhone连接信息.txt`，列出当前所有可用地址，例如：

```text
http://100.x.x.x:17920/      # Tailscale
http://172.16.x.x:17920/     # 蒲公英/VPN（示例）
http://192.168.1.x:17920/    # 普通局域网
```

> `192.168.1.1` 只有在运行本程序的 Windows 电脑自身就是该地址时才应该使用；很多家庭网络中它实际是路由器地址。

## 后台服务

- `start-service.bat`：静默启动后台守护。
- `stop-service.bat`：停止 Guardian、Bridge 与所有网关实例；不会卸载自动启动任务。
- `restart-service.bat`：停止后重新启动后台守护。
- Windows 下次登录时，计划任务会再次自动启动服务。

## 自定义密码

运行 `change-password.bat`。当前允许：

```text
A-Z a-z 0-9 . _ ~ ! @ # % + = -
```

长度 6–64 位。

配置文件仍位于：

```text
C:\ProgramData\LDPlayer-Browser-Remote-v3\config.ini
```

由于本包中的 `webrtc-gateway.exe` 是既有预编译二进制，网关启动时仍需要获得明文访问凭据，因此当前密码会保存在本机配置文件中并传入网关进程。`BridgeKey` 已预留用于未来拥有 Go 网关源码后进一步拆分内部桥接凭据。

## 网络范围

Guardian 会忽略 WSL、Hyper-V、VMware、VirtualBox、Docker 等常见无关虚拟网卡，同时允许 Tailscale、VPN/蒲公英以及物理私网接口。网络变化后会在轮询周期内自动增减对应网关实例。

## 预编译网关

仓库不提交 `webrtc-gateway.exe`，只保留其 SHA-256。完整可运行 ZIP 包含从用户提供的 alpha4 基线继承的原始网关 EXE。Go 网关源码不在该基线中，因此 alpha5 的多网络能力由 Guardian 的多实例方式实现。

## 安全边界

此版本面向可信的 Tailscale、蒲公英 VPN 和受控局域网环境，不应直接做公网端口映射。防火墙规则限制的是来源地址范围，并不能替代 VPN ACL、Wi-Fi 隔离、路由器访问控制等网络安全策略。

## 验证状态

已完成前端 JavaScript 静态语法检查和配置/脚本一致性检查。目标 Windows 主机上的 PowerShell 5.1、Bridge `Add-Type` 编译，以及 Tailscale / 蒲公英 / LAN 三条真实链路仍需实机验证；详见 `QUALITY_GATE.md`。
