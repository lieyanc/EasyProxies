# easy-proxies

[简体中文](README_ZH.md)

> A sing-box based proxy pool manager -- aggregate many upstream proxy nodes into one stable, health-checked, load-balanced local proxy endpoint.

## Features

- **Three runtime modes**: `pool` (single-port load balancing), `multi-port` (one port per node), and `hybrid` (both simultaneously)
- **Wide protocol support**: VLESS, VMess, Trojan, Shadowsocks, Hysteria2, TUIC, AnyTLS, SOCKS5, HTTP/HTTPS
- **Automatic health checking** with configurable failure thresholds and blacklist duration, plus manual blacklist/release from the dashboard
- **GeoIP region routing**: classify nodes by country and route traffic through a specific region via a dedicated HTTP proxy endpoint
- **Multiple node sources**: inline config, `nodes.txt` file, or subscription URLs (Base64, plain text, Clash YAML)
- **Subscription auto-refresh with hot-reload**: periodically fetches subscription updates and reloads without restart
- **WebUI dashboard**: real-time node status, traffic charts, diagnostics, log console, and full settings management
- **Management API**: RESTful endpoints for node CRUD, probing, blacklisting, subscription management, and config reload
- **Configurable DNS resolver** with fallback servers and IPv4/IPv6 strategy control
- **Log rotation**: size-based rotation with configurable backup count, age, and compression
- **Binary-first deployment**: static Linux binaries for amd64 and arm64; Docker remains available as an optional wrapper

## Quick Start

### 1. Download a Binary (Recommended)

Download the release archive for your server architecture:

```bash
# amd64
curl -L -o easy-proxies-linux-amd64.tar.gz \
  https://github.com/lieyanc/easy-proxies/releases/latest/download/easy-proxies-linux-amd64.tar.gz

# arm64
curl -L -o easy-proxies-linux-arm64.tar.gz \
  https://github.com/lieyanc/easy-proxies/releases/latest/download/easy-proxies-linux-arm64.tar.gz
```

Unpack the archive. The release folder already contains `easy-proxies`, `config.yaml`, and `nodes.txt` in the same directory:

```bash
tar -xzf easy-proxies-linux-amd64.tar.gz
cd easy-proxies-*-linux-amd64
```

### 2. Prepare Configuration

Edit `config.yaml` in the current directory and add your proxy nodes (inline nodes, `nodes.txt` file, or subscription URLs).

### 3. Start the Service

Run directly:

```bash
./easy-proxies
```

Or install the packaged systemd unit:

```bash
cd ..
sudo mkdir -p /opt/easy-proxies
sudo cp -a easy-proxies-*-linux-amd64/. /opt/easy-proxies/
sudo install -Dm644 /opt/easy-proxies/easy-proxies.service /etc/systemd/system/easy-proxies.service
sudo useradd --system --no-create-home --shell /usr/sbin/nologin easy-proxies 2>/dev/null || true
sudo chown -R easy-proxies:easy-proxies /opt/easy-proxies
sudo systemctl daemon-reload
sudo systemctl enable --now easy-proxies
```

### 4. Build from Source

```bash
cp config.example.yaml config.yaml
cp nodes.example nodes.txt
make build
./easy-proxies -config config.yaml
```

The helper script does the same local-first setup and builds the binary if needed:

```bash
./start.sh
```

### 5. Access WebUI

Open `http://localhost:9091` in your browser.

## Configuration

### Runtime Modes

| Mode | Description |
|------|-------------|
| `pool` | Single port proxy pool. All nodes share one port with load balancing |
| `multi-port` | One local port per node for direct access |
| `hybrid` | Both pool + multi-port simultaneously |

### Pool Scheduling

| Algorithm | Description |
|-----------|-------------|
| `sequential` | Round-robin through healthy nodes |
| `random` | Random node selection |
| `balance` | Least-connections balancing |

### Minimal Config Example

```yaml
mode: pool

listener:
  address: 0.0.0.0
  port: 2323
  username: user
  password: pass

pool:
  mode: sequential    # sequential / random / balance / latency
  failure_threshold: 3
  blacklist_duration: 24h

management:
  enabled: true
  listen: 127.0.0.1:9091
  probe_target: http://cp.cloudflare.com/generate_204
  password: ""

dns:
  server: 223.5.5.5
  port: 53
  strategy: prefer_ipv4

nodes_file: nodes.txt
```

### Full Config Reference

See [config.example.yaml](config.example.yaml) for the full documented configuration with all available options.

## GeoIP Region Routing

### Overview

When GeoIP is enabled, easy-proxies automatically classifies your proxy nodes by geographic region and provides a separate HTTP proxy endpoint that lets you route traffic through nodes in a specific country/region.

### Supported Regions

| Code | Region |
|------|--------|
| `jp` | Japan 🇯🇵 |
| `kr` | South Korea 🇰🇷 |
| `us` | United States 🇺🇸 |
| `hk` | Hong Kong 🇭🇰 |
| `tw` | Taiwan 🇹🇼 |
| `sg` | Singapore 🇸🇬 |
| `other` | All other regions |

### Configuration

```yaml
geoip:
  enabled: true
  database_path: "./GeoLite2-Country.mmdb"
  listen: "0.0.0.0"          # defaults to listener.address if omitted
  port: 1221                  # defaults to listener.port if omitted
  auto_update_enabled: true   # auto-update the GeoIP database
  auto_update_interval: 24h   # check interval
  download_proxies:           # optional, tried from top to bottom
    - "http://127.0.0.1:7890"
    - "socks5://127.0.0.1:7891"
```

The GeoIP router reuses the `listener.username` and `listener.password` for proxy authentication.

Key behaviors:
- The GeoIP database (MaxMind GeoLite2-Country) is **auto-downloaded** on first startup
- GeoIP database downloads can use configured HTTP(S) or SOCKS5 proxies, retried in list order
- Auto-update is enabled by default (checks every 24h) with hot-reload -- no restart needed
- Node region classification is learned during health checks from each node's observed public egress IP
- Nodes whose egress IP cannot be detected or looked up are placed in the `other` category

### How to Use

The GeoIP router is an HTTP proxy that listens on its own port. You select a region by adding a path prefix to your request.

#### HTTP Requests

Format: `http://<geoip_host>:<geoip_port>/<region>/`

```bash
# Route through Japanese nodes
curl -x http://user:pass@localhost:1221/jp/ http://example.com

# Route through US nodes
curl -x http://user:pass@localhost:1221/us/ http://example.com

# Route through Hong Kong nodes
curl -x http://user:pass@localhost:1221/hk/ http://example.com

# Route through Singapore nodes
curl -x http://user:pass@localhost:1221/sg/ http://example.com

# No region prefix = use global pool (all nodes)
curl -x http://user:pass@localhost:1221/ http://example.com
```

#### HTTPS Requests (CONNECT Tunnel)

For HTTPS, the region prefix goes before the target host in the CONNECT request:

```bash
# Route HTTPS through Japanese nodes
https_proxy=http://user:pass@localhost:1221/jp/ curl https://www.google.com

# Route HTTPS through US nodes
https_proxy=http://user:pass@localhost:1221/us/ curl https://www.google.com

# No region prefix = use global pool
https_proxy=http://user:pass@localhost:1221/ curl https://www.google.com
```

#### Using with Applications

**Environment variables:**

```bash
# Use Japanese nodes for all traffic
export http_proxy=http://user:pass@your-server:1221/jp/
export https_proxy=http://user:pass@your-server:1221/jp/

# Use global pool (all nodes)
export http_proxy=http://user:pass@your-server:1221/
export https_proxy=http://user:pass@your-server:1221/
```

**Browser proxy extensions (SwitchyOmega, FoxyProxy, etc.):**

- Protocol: HTTP
- Server: your-server-ip
- Port: 1221
- Username/Password: as configured in `listener`
- For region-specific routing: set the proxy URL path to include the region prefix (e.g., `/jp/`)

**Python requests:**

```python
import requests

proxies = {
    "http": "http://user:pass@your-server:1221/jp/",
    "https": "http://user:pass@your-server:1221/jp/",
}
r = requests.get("http://example.com", proxies=proxies)
```

**Go net/http:**

```go
proxyURL, _ := url.Parse("http://user:pass@your-server:1221/jp/")
client := &http.Client{
    Transport: &http.Transport{
        Proxy: http.ProxyURL(proxyURL),
    },
}
resp, err := client.Get("http://example.com")
```

### How It Works

1. Health checks dial through each node and detect the node's public egress IP
2. The egress IP is looked up in the MaxMind GeoLite2-Country database and stored on the node
3. The GeoIP router listens on its own port and inspects the request path for a region prefix
4. Matching requests are routed through a dynamic region pool that filters nodes by the latest egress-IP region; unmatched requests use the global pool
5. Each region pool uses the same scheduling algorithm configured in the `pool` section

## Supported Protocols

| Protocol | URI Schemes | Transport |
|----------|-------------|-----------|
| VLESS | `vless://` | TCP, WS, HTTP/2, gRPC, HTTPUpgrade; TLS/Reality/uTLS |
| VMess | `vmess://` | WS, HTTP/2, gRPC, HTTPUpgrade; TLS/uTLS |
| Trojan | `trojan://` | WS, HTTP/2, gRPC, HTTPUpgrade; TLS/Reality/uTLS |
| Shadowsocks | `ss://` | Direct; SIP002 format |
| Hysteria2 | `hysteria2://`, `hy2://` | QUIC-based |
| TUIC | `tuic://` | QUIC-based |
| AnyTLS | `anytls://` | TLS |
| SOCKS5 | `socks5://`, `socks://` | Direct |
| HTTP | `http://`, `https://` | Direct |

## Node Sources

### Inline Nodes

```yaml
nodes:
  - uri: "vless://uuid@server:443?security=tls&type=ws&path=/path#Name"
```

### Nodes File

```yaml
nodes_file: nodes.txt
```

One proxy URI per line. Lines starting with `#` are comments.

### Subscriptions

```yaml
subscriptions:
  - "https://provider.example/api?token=xxx"

subscription_refresh:
  enabled: true
  interval: 1h
```

Supports Base64, plain text, and Clash YAML formats. When subscriptions are configured, fetched nodes are written to `nodes_file`. Subscription changes trigger automatic hot-reload without restart.

## WebUI Dashboard

Access at `http://localhost:9091` by default (configurable via the `management` section).

Features:

- **Dashboard**: Real-time node status, traffic charts, region availability, latency monitoring
- **Node Config**: Add/edit/delete inline nodes and subscription URLs
- **Diagnostics**: Connectivity testing and node state export
- **Console**: Real-time application logs (last 1000 lines, WebSocket streaming)
- **Settings**: All configuration options editable from the browser, changes persist to `config.yaml`

When `management.password` is empty, authentication is bypassed, but the management server may only listen on a loopback address. Set a password before binding it to a LAN or public address.

## Management API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth` | POST | Login with password |
| `/api/settings` | GET, PUT | Read/update settings |
| `/api/nodes` | GET | List all nodes with status |
| `/api/nodes/{tag}/probe` | POST | Test node connectivity |
| `/api/nodes/{tag}/blacklist` | POST | Manually blacklist a node |
| `/api/nodes/{tag}/release` | POST | Release node from blacklist |
| `/api/nodes/probe-all` | POST | Probe all nodes (SSE stream) |
| `/api/export` | GET | Export node configuration |
| `/api/subscription/config` | GET, PUT | Manage subscription URLs |
| `/api/subscription/status` | GET | Check subscription status |
| `/api/subscription/refresh` | POST | Trigger manual refresh |
| `/api/nodes/config` | GET, POST, PUT, DELETE | CRUD for node config |
| `/api/reload` | POST | Reload sing-box instance |
| `/api/version` | GET | Runtime version metadata |
| `/api/update/status` | GET | OTA update status |
| `/api/update/check` | POST | Check for updates |
| `/api/update/apply` | POST | Download/apply or confirm an update |
| `/api/update/dismiss` | POST | Dismiss a pending dev update |

## Binary Deployment

Release archives contain only the runtime pieces needed on a server:

- `easy-proxies`: statically linked Linux binary
- `config.yaml`: editable runtime configuration in the binary directory
- `nodes.txt`: editable node list/cache in the binary directory
- `config.example.yaml`: full documented configuration
- `nodes.example`: example node list
- `easy-proxies.service`: optional systemd unit
- `README.md` / `README_ZH.md`: deployment and usage notes

The WebUI is embedded into the binary with Go `embed`, and sing-box is linked as a Go dependency. There is no separate sing-box process to install.

### Build Targets

```bash
make build          # build ./easy-proxies for the local platform
make package        # create OTA binary + sha256 + install archive under dist/
make install        # install binary and config under /opt/easy-proxies
make install-systemd
```

### Runtime Files

| Path | Purpose |
|------|---------|
| `/opt/easy-proxies/easy-proxies` | Installed binary |
| `/opt/easy-proxies/config.yaml` | Main configuration beside the binary |
| `/opt/easy-proxies/nodes.txt` | Node cache/list beside the binary |
| `/etc/systemd/system/easy-proxies.service` | Optional systemd unit |

## OTA And CI

easy-proxies can self-update from GitHub Releases when `update.enabled` is enabled in `config.yaml` or the WebUI settings page.

- `stable` channel checks the latest non-prerelease release and applies it automatically after download and SHA256 verification.
- `dev` channel tracks the fixed `dev` prerelease tag refreshed from `main`/`master`; it downloads and verifies the binary, then waits for confirmation in the WebUI or `POST /api/update/apply`.
- OTA assets are bare binaries named `easy-proxies-linux-amd64` / `easy-proxies-linux-arm64` plus `.sha256`.
- Manual installation assets remain available as `easy-proxies-linux-amd64.tar.gz` / `easy-proxies-linux-arm64.tar.gz`.
- Version metadata is injected at build time and exposed via `easy-proxies -version` and `GET /api/version`.

The workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) runs tests, cross-compiles Linux amd64/arm64 binaries, publishes the fixed `dev` prerelease on pushes to `main`/`master`, publishes stable releases on `v*` tags, and still builds the Docker image.

Stable release example:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Fetch the latest release asset with GitHub CLI:

```bash
./scripts/fetch-latest-build.sh --download-only
./scripts/fetch-latest-build.sh --stable --download-only
```

### Ports

| Port | Usage |
|------|-------|
| 2323 | Pool proxy entry (pool/hybrid mode) |
| 9091 | WebUI and Management API |
| 1221 | GeoIP region router (when enabled, configurable) |
| 24000+ | Multi-port mode (one per node) |

## Docker Deployment (Optional)

Docker remains supported when you prefer container lifecycle management. The compose setup uses host networking for automatic port management, and `docker-start.sh` creates `config.yaml` and `nodes.txt` before starting Compose:

```yaml
services:
  easy-proxies:
    image: ${EASY_PROXIES_IMAGE:-ghcr.io/lieyanc/easy-proxies:latest}
    container_name: easy-proxies
    restart: unless-stopped
    network_mode: host
    user: "${UID:-10001}:${GID:-10001}"
    volumes:
      - ./config.yaml:/app/config.yaml
      - ./nodes.txt:/app/nodes.txt
      - ./logs:/app/logs
```

Run it with:

```bash
./docker-start.sh
# or manually after creating config.yaml and nodes.txt:
docker compose up -d
```

### Docker Notes

- **Same directory config**: In the container, `/app/easy-proxies`, `/app/config.yaml`, and `/app/nodes.txt` live together.
- **Permissions**: Use `--user $(id -u):$(id -g)` to match your host user for file access.
- **Multi-platform**: Supports amd64 and arm64 architectures.
- **Reload**: `/api/reload` and subscription refresh will interrupt active connections.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Development

```bash
make test
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lieyanc/easy-proxies&type=Date)](https://star-history.com/#lieyanc/easy-proxies&Date)

## Acknowledgements

This project is built on top of [sing-box](https://github.com/SagerNet/sing-box) — a universal proxy platform that powers all the underlying protocol implementations and transports. Huge thanks to the SagerNet team and contributors for their outstanding work.

## License

MIT License
