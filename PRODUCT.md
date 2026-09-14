# Product

Project goal: control the primary LDPlayer instance from iPhone Safari with low-latency H.264 WebRTC video and DataChannel input.

Supported access paths in v3.0.0-alpha5:
- Tailscale (100.64.0.0/10)
- trusted VPN/private adapters such as 蒲公英
- ordinary RFC1918 LAN addresses (10/8, 172.16/12, 192.168/16)

Core value: keep scrcpy's proven capture/control path while replacing only its desktop renderer with Safari.

MVP: H.264 WebRTC video, DataChannel controls, 6-64 character access password with legacy six-digit PIN compatibility, minimal full-screen UI, hidden background lifecycle scripts, diagnostics.

Technical direction: scrcpy sockets stay on loopback; a hidden Guardian launches one prebuilt Pion WebRTC gateway instance per eligible private IPv4 and supervises child processes. Windows Firewall permits only Tailscale CGNAT and RFC1918 source ranges.
