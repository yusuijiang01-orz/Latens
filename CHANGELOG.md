# Changelog

## v3.0.0-alpha5.1 - packaging cleanup only

- Removed legacy 01-05 launcher BAT files from the release ZIP to avoid duplicate entry points and Chinese filename encoding issues on Windows extractors.
- Removed the pre-generated iPhone connection-info text file; Setup.ps1 continues to generate fresh connection information after installation.
- No network, background-service, authentication, bridge, WebRTC, or UI behavior changed from v3.0.0-alpha5.

## v3.0.0-alpha5 - multi-network background service + custom password

- Added hidden logon-time Guardian process with child restart supervision.
- Added explicit start/stop service BAT files and stop-signal handling.
- Added dynamic Tailscale / VPN / RFC1918 interface discovery.
- Starts one gateway listener per eligible private IPv4 so each path advertises the matching WebRTC host candidate.
- Expanded Windows Firewall scope to Tailscale CGNAT plus RFC1918 private networks without opening arbitrary Internet sources.
- Added 6-64 character custom access passwords while retaining legacy six-digit PIN compatibility.
- Added password-change helper and AccessPassword config compatibility in the scrcpy bridge.
- Reserved BridgeKey for a future gateway build with an independent loopback upstream credential.

## 3.0.0-alpha4

- Added an on-screen real-time connection-quality panel opened from the floating menu.
- Added one-second DataChannel application RTT probes and WebRTC candidate-pair RTT display.
- Added interval packet loss, jitter, receive bitrate, decode FPS, jitter-buffer delay and per-frame decode time.
- Added ten-second diagnostic reports to `runtime.log`, including candidate path and cumulative receive/decode counters.
- Corrected the quality gate after iPhone logs showed 97 lost packets versus 153 received in an early sample.

## 3.0.0-alpha3

- Delayed scrcpy video startup until the WebRTC PeerConnection is fully connected.
- Added scrcpy 4.1 `RESET_VIDEO` recovery from browser retries and RTCP PLI/FIR feedback.
- Forced the Android encoder to Baseline, Level 3.1, 30 fps and a one-second I-frame interval; verified the emitted SPS is `42c01f` before RTP normalization.
- Reset config/keyframe state after every upstream reconnect.
- Added browser WebRTC statistics and iOS user-agent diagnostics to `runtime.log`.
- Preserved the existing six-digit PIN during upgrades.

## 3.0.0-alpha2

- Preserved scrcpy's 12-byte media header so config/keyframe flags and PTS reach the WebRTC gateway.
- Cached SPS/PPS and prepended them to the first IDR access unit.
- Aligned the live SPS and SDP to Safari-compatible H.264 constrained-baseline level 3.1 (`42e01f`).
- Derived RTP sample durations from scrcpy PTS and retained a bounded 30 fps fallback.
- Removed the remaining legacy jMuxer asset route.
- Added an H.264 profile regression test and completed a live LDPlayer-to-browser decoding/control run.

## 3.0.0-alpha1

- Replaced jMuxer/MSE with native Safari WebRTC playback.
- Added a Pion-based Windows H.264 RTP gateway with no STUN or TURN.
- Restricted ICE candidates to the Windows Tailscale IPv4.
- Fixed WebRTC UDP ports to 40000-40100 for a narrow firewall rule.
- Kept the scrcpy-server video and control protocol implementation.
- Added WebRTC/DataChannel diagnostics and v3 lifecycle scripts.
