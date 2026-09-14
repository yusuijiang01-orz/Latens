# Prebuilt WebRTC gateway

The runnable package includes `webrtc-gateway.exe`, inherited unchanged from the supplied v3.0.0-alpha4 baseline.

This repository intentionally tracks the binary SHA-256 sidecar but not the 10+ MB executable itself. The current ChatGPT GitHub connector used for this update can write repository text/source files but cannot upload a binary release asset.

`Setup.ps1` therefore expects `webrtc-gateway.exe` to be present next to the installer scripts, as it is in the complete downloadable ZIP produced from this change.

The Go source for this prebuilt gateway was not present in the supplied baseline ZIP. Multi-network support in alpha5 is implemented by `Guardian.ps1`, which starts one gateway instance per eligible private IPv4 using the gateway's existing `--listen` and `--tailscale-ip` flags.
