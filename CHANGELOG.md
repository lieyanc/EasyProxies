# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Health Check Slow-Retest Queue**: Failed probes no longer mark a node down immediately
  - Startup and periodic sweeps queue failed nodes for a serial (single-worker) retest with doubled timeout after the main sweep, eliminating false negatives from probe congestion
  - New `management.initial_check_concurrency` option (default 20) makes the startup sweep concurrency adjustable from the WebUI
- **Round-Robin Entry**: Optional username-selected round-robin entry on the pool listener
  - `pool.round_robin_entry: true` exposes `<listener.username>-rr` (or a custom `pool.round_robin_username`) on the same port
  - Always schedules round-robin regardless of `pool.mode`, sharing node health state and blacklists with the main pool
  - Shown in WebUI connection addresses and plain-text export
- **Cloudflare WARP**: Register ordinary single-layer WARP accounts from the WebUI and use them as WireGuard pool nodes without wgcf, Google Play/FCM, or Gool Pair
- **Log Rotation**: Configurable log file rotation with size limits, backup count, and compression
  - New `log` section in config with `output`, `file`, `max_size`, `max_backups`, `max_age`, `compress` options
  - Uses lumberjack for automatic log rotation
  - Defaults: 50MB max size, 3 backups, 7 days retention
- **WebUI Console**: Real-time log streaming in the dashboard
  - In-memory ring buffer captures last 1000 log lines
  - WebSocket-based live log streaming to browser
  - Console tab in WebUI for instant log viewing
- **AnyTLS Protocol**: Support for AnyTLS outbound protocol
  - Parse `anytls://` URIs from subscriptions
  - Full TLS configuration support
- **TUIC Protocol**: Support for TUIC outbound protocol
  - Parse `tuic://` URIs with UUID and password authentication
  - Congestion control and UDP relay mode configuration
  - Full TLS/ALPN support
- **Clash API Integration**: Embedded Clash API controller
  - Internal controller at `127.0.0.1:9092`
  - Enables Clash-compatible tooling integration

### Changed
- **Health Probe**: Probes now request the path configured in `probe_target` (previously hardcoded `/generate_204`), honor the caller's timeout for read/write deadlines, and run exit-IP/GeoIP detection in the background so it no longer slows health-check sweeps
- **Subscription Parsing**: Improved Clash YAML format detection
  - User-Agent changed to `clash-verge/v2.2.3` for better compatibility
  - YAML detection sample size increased from 200 to 16384 characters
  - Better support for modern proxy types (AnyTLS, TUIC) in Clash format
- **Docker Entrypoint**: Fixed bind-mount permission issues
  - Uses gosu for privilege dropping
  - Ensures proper file ownership for nodes.txt and logs

### Fixed
- Docker nodes.txt permission denied on bind-mount
- VMess node name extraction from base64 payload
- Cross-platform file locking for Windows support

## [2.0.0] - 2025-01-XX

### Added
- SOCKS5 inbound protocol support via Mixed type
- Cross-platform file locking for Windows support
- GeoIP database auto-download and hot-reload
- Hysteria2 (hy2://) protocol support
- Comprehensive security and performance improvements

### Changed
- Major protocol, performance and UI overhaul
- Improved subscription parsing with better error handling
- Enhanced dashboard with real-time statistics

## [1.1.0] - 2024-12-XX

### Added
- GeoIP region routing and dashboard statistics
- Global skip_cert_verify option
- Node port assignment persistence across reloads
- ARM64 support for Docker image

### Fixed
- Hybrid mode export credentials
- Settings save permission issues
- Health check timing after node registration

## [1.0.0] - 2024-11-XX

### Added
- Initial release
- Pool, multi-port, and hybrid runtime modes
- Support for vmess, vless, trojan, ss, hysteria2, socks5, http protocols
- Subscription support (Base64/plain text/Clash YAML)
- Web dashboard with node management
- Automatic health checks and blacklist recovery
- Configurable DNS resolver
