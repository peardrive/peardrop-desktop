# Changelog

All notable changes to PearDrop are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[SemVer](https://semver.org). While the version is `0.x`, a minor bump is the breaking one.

## 0.31.0 - 2026-11-24

### Added

- **Preview a link before downloading.** Pasting a `peardrop://` link now shows the share's
  name, size, date and file list while PearDrop connects to the sender. If the sender is
  offline, the preview says so and **Download** still queues the transfer and keeps trying.
- A loading card covers the connection step, so the receive flow no longer jumps from the
  paste box straight into a download.

### Fixed

- Big icons view: the remove countdown and **Undo** now fit on the tile instead of spilling
  outside it.

## 0.30.0 - 2026-11-18

First public beta. This is the first version published as installers rather than run from source.

### Added

- Windows (installer and portable `.exe`), macOS (`.dmg` and `.zip`, signed and notarized)
  and Linux (`.AppImage` and `.deb`) builds.
- Peer-to-peer sharing and receiving over Hyperswarm and Hyperdrive, with `peardrop://` links
  and QR codes. Nothing is uploaded to a server.
- Background operation from the tray (menu bar on macOS), a live network panel, 11 themes,
  resumable downloads and a waiting-for-sender queue that survives a restart.
