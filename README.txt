雷电浏览器低延迟远控 v3.0.0-alpha5.1
=================================

用途
----
通过 iPhone Safari 低延迟查看并控制 Windows 上的雷电模拟器主实例。

访问网络
--------
支持：
- Tailscale 100.64.0.0/10
- 蒲公英 / 其他受信任私有 VPN 网卡
- 普通 10.x / 172.16-31.x / 192.168.x 局域网

后台模式
--------
Windows 登录后由高权限计划任务静默启动 Guardian，不显示 CMD 窗口。
Guardian 监控 scrcpy Bridge 和各网络地址对应的 WebRTC Gateway，异常退出会自动重新启动。

常用脚本
--------
- start-service.bat：静默启动后台服务
- stop-service.bat：停止当前后台服务
- change-password.bat：修改访问密码并重启
- 原有状态/重启/卸载 BAT 继续保留

认证
----
浏览器支持 6-64 位自定义密码；旧版 6 位数字 PIN 继续兼容。
首次安装可输入自定义密码；留空则随机生成 6 位数字 PIN。

安全
----
- 防火墙仅允许 Tailscale CGNAT 和 RFC1918 私网来源。
- 不应把端口直接映射到公网。
- ADB 和 scrcpy 内部桥只监听 127.0.0.1。
- scrcpy-server 4.1 从 Genymobile 官方 Release 下载并校验固定 SHA-256。

连接地址
--------
安装完成后会生成 iPhone连接信息.txt，其中列出当前可用地址。
请使用运行本程序那台 Windows 电脑自己的 IP；192.168.1.1 在很多家庭网络中其实是路由器，而不是电脑。

技术链路
--------
LDPlayer -> scrcpy-server H.264 / Control Protocol -> Windows loopback Bridge
         -> Pion WebRTC Gateway -> Safari WebRTC video + DataChannel control

注意
----
本安装包中的 webrtc-gateway.exe 是既有预编译二进制，Go 源码不在这份 alpha4 基线 ZIP 中。
因此本版通过多网关实例兼容多网络入口，并保留 AccessPassword/Pin 兼容路径。
BridgeKey 已写入配置作为未来独立内部凭据的预留字段；在没有对应 Go 网关源码前，不声称内部凭据已完全独立。
