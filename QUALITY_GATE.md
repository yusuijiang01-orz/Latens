# Quality Gate — v3.0.0-alpha5

## Static checks completed in this build workspace

- [x] Browser JavaScript parses with Node `--check`.
- [x] Legacy browser-only six-digit numeric restriction removed.
- [x] 6-64 character password input and legacy PIN compatibility markers present.
- [x] Guardian/background lifecycle scripts present.
- [x] Explicit `start-service.bat`, `stop-service.bat`, and `change-password.bat` present.
- [x] Network discovery covers Tailscale CGNAT and RFC1918 private IPv4 ranges.
- [x] Common unrelated WSL/Hyper-V/VMware/VirtualBox/Docker adapters filtered.
- [x] Firewall rules do not allow arbitrary Internet source addresses.
- [x] ADB/scrcpy bridge remains loopback-only.
- [x] Upgrade/uninstall logic includes Guardian and all `gateway-*.pid` files.
- [x] Diagnostics mask the password in the generated diagnostic log.

## Windows runtime checks still required on the target PC

- [ ] PowerShell 5.1 parses every lifecycle script on the target Windows build.
- [ ] `Bridge.cs` compiles through `Add-Type` on the target machine.
- [ ] The prebuilt gateway accepts a non-numeric custom password through `--pin`.
- [ ] The prebuilt gateway accepts a non-Tailscale private IPv4 through `--tailscale-ip`.
- [ ] Multiple gateway processes can coexist on distinct local IPs while using the fixed WebRTC UDP range.
- [ ] Real Tailscale WebRTC video/control test.
- [ ] Real 蒲公英 WebRTC video/control test.
- [ ] Real physical LAN WebRTC video/control test.
- [ ] Stop -> no automatic child respawn until explicit start/logon.
- [ ] Child crash -> Guardian restart verification.

The package should not be described as fully end-to-end validated until the Windows runtime checks above pass on the actual host.
