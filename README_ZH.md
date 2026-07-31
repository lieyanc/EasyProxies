# easy-proxies

[English](README.md) | 简体中文

easy-proxies 是一个基于 sing-box 的代理池管理工具。

目标是把大量上游节点统一成稳定的本地 HTTP/SOCKS5 代理入口，同时支持按节点独立端口访问。

## 当前能力

- 运行模式：`pool`、`multi-port`、`hybrid`。
- 实际构建的上游协议：Cloudflare `warp`、`vmess`、`vless`、`trojan`、`ss/shadowsocks`、`hysteria2/hy2`、`socks5/socks`、`http/https`、`anytls`、`tuic`。
- 节点来源：
  - `config.yaml` 的 `nodes`
  - `nodes_file`（每行一个 URI）
  - `subscriptions`（支持 Base64/纯文本/Clash YAML 解析）
- 自动健康检查、失败熔断和黑名单恢复。
- Web 管理面板 + API：
  - 节点状态/探测/导出
  - **手动拉黑/解封节点**
  - 动态设置（`external_ip`、`probe_target`、`skip_cert_verify`、`geoip`）
  - 节点配置增删改查 + 重载
  - 订阅状态查询 + 手动刷新 + **保存即时生效**
  - **实时日志控制台**（最近 1000 行，WebSocket 流式传输）
- 新增可配置 DNS 解析器（对 VMess 域名节点非常关键）。
- 可选 GeoIP 标记与用户名地域分流（支持 JP/KR/US/HK/TW/SG 地域分区，HTTP/SOCKS 同端口可用，地区池延迟优先）。
- **可配置日志轮转**，支持大小限制、备份数量和压缩。
- **二进制优先部署**：发布 amd64/arm64 Linux 静态二进制，Docker 作为可选运行方式保留。

## 快速开始

### 1）下载二进制（推荐）

根据服务器架构下载发布包：

```bash
# amd64
curl -L -o easy-proxies-linux-amd64.tar.gz \
  https://github.com/lieyanc/easy-proxies/releases/latest/download/easy-proxies-linux-amd64.tar.gz

# arm64
curl -L -o easy-proxies-linux-arm64.tar.gz \
  https://github.com/lieyanc/easy-proxies/releases/latest/download/easy-proxies-linux-arm64.tar.gz
```

解压发布包。发布目录里已经把 `easy-proxies`、`config.yaml`、`nodes.txt` 放在同一目录：

```bash
tar -xzf easy-proxies-linux-amd64.tar.gz
cd easy-proxies-*-linux-amd64
```

### 2）准备配置

编辑当前目录的 `config.yaml`，并配置节点来源（`nodes.txt` / `subscriptions` / `nodes`）。

### 3）启动

直接运行：

```bash
./easy-proxies
```

也可以安装发布包里的 systemd 服务：

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

### 4）从源码构建

```bash
cp config.example.yaml config.yaml
cp nodes.example nodes.txt
make build
./easy-proxies -config config.yaml
```

源码目录下的 `start.sh` 会优先使用本地二进制；不存在时自动构建：

```bash
./start.sh
```

## 最小配置示例（Pool）

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
  health_check_interval: 5m
  health_check_concurrency: 0  # 0 表示 CPU 核心数
  password: ""

dns:
  server: 223.5.5.5
  port: 53
  strategy: prefer_ipv4

nodes_file: nodes.txt
```

## DNS 配置说明

`dns` 会同时影响 sing-box DNS 客户端和 VMess 域名拨号解析：

```yaml
dns:
  server: 223.5.5.5
  fallback_servers:    # 备用 DNS 服务器（主 DNS 解析失败时使用）
    - 8.8.8.8
    - 1.1.1.1
  port: 53
  strategy: prefer_ipv4
```

`strategy` 可选值：

- `as_is`
- `prefer_ipv4`
- `prefer_ipv6`
- `ipv4_only`
- `ipv6_only`

如果日志中出现 `lookup <domain>: empty result`，请优先检查该 DNS 配置是否可达且策略合理。

## 运行模式

- `pool`：所有节点共享一个本地 HTTP/SOCKS5 入口。
- `multi-port`：每个节点一个独立本地 HTTP/SOCKS5 端口。
- `hybrid`：同时启用 pool + multi-port。

### 轮询入口（可选）

`pool.mode` 使用 `latency` 等模式时，可在同一端口额外开启一个强制轮询的用户名入口（`pool.round_robin_entry: true`）。
入口用户名默认为 `<listener.username>-rr`（未设置 listener 用户名时为 `rr`），密码复用 `listener.password`，可用 `pool.round_robin_username` 自定义。
例如 `curl -x http://user-rr:pass@localhost:2323 ...` 即按请求轮换节点，默认用户名入口仍走 latency 调度。

## 节点来源行为

- 配置了 `subscriptions` 时：
  - 会抓取订阅节点并追加到运行节点列表
  - `nodes_file` 作为订阅节点写入路径
  - 启动阶段不再从 `nodes_file` 读取节点
- `nodes`（内联节点）只要存在就会参与运行。

## 协议支持注意事项

运行时真正支持的协议：

- `warp`（Cloudflare WARP，单层 WireGuard）
- `vmess`
- `vless`
- `trojan`
- `ss` / `shadowsocks`
- `hysteria2` / `hy2`
- `socks5` / `socks`
- `http` / `https`
- `anytls`
- `tuic`

### Cloudflare WARP

在 WebUI 的“节点管理”中点击“注册 WARP”即可。EasyProxies 会在本地生成 WireGuard 密钥，通过 Cloudflare 接口注册一个普通 WARP 设备，保存为 `warp://` 节点，并自动重载核心。整个流程不需要 wgcf、Google Play/FCM token，也不需要 Gool Pair。

内部 URI 格式：

```text
warp://PRIVATE_KEY@endpoint:port?peer_public_key=KEY&ipv4=PREFIX&ipv6=PREFIX&reserved=A,B,C&mtu=1280#name
```

URI 包含 WireGuard 私钥，请勿公开 `config.yaml`、`nodes.txt`、导出内容、日志或截图。当前仅支持普通单层 WARP，不实现 WARP-in-WARP/Gool Pair。

订阅解析阶段可能识别到更多 URI 前缀（兼容输入），但不在上述列表中的协议会在构建阶段被跳过。

## 管理 API（核心）

- `POST /api/auth`
- `GET|PUT /api/settings`
- `GET /api/nodes`
- `POST /api/nodes/{tag}/probe`
- `POST /api/nodes/{tag}/release`
- `POST /api/nodes/{tag}/blacklist`
- `POST /api/nodes/probe-all`（SSE）
- `GET /api/export`
- `GET|PUT /api/subscription/config`
- `GET|POST /api/subscription/status|refresh`
- `GET|POST|PUT|DELETE /api/nodes/config[...]`
- `POST /api/warp/register`（注册并启用普通 WARP 节点）
- `POST /api/reload`
- `GET /api/version`
- `GET /api/update/status`
- `POST /api/update/check`
- `POST /api/update/apply`
- `POST /api/update/dismiss`

`management.password` 为空时，Web/API 不要求登录，但仅允许监听本机地址；绑定公网或局域网地址时必须设置密码。

## 二进制部署说明

发布包只包含服务器运行需要的文件：

- `easy-proxies`：静态链接的 Linux 主程序。
- `config.yaml`：与主程序同目录的运行配置。
- `nodes.txt`：与主程序同目录的节点列表/缓存。
- `config.example.yaml`：完整配置示例。
- `nodes.example`：节点文件示例。
- `easy-proxies.service`：可选 systemd 服务。
- `README.md` / `README_ZH.md`：部署和使用说明。

WebUI 已通过 Go `embed` 内嵌进二进制，sing-box 也作为 Go 依赖链接进主程序，不需要额外安装 sing-box 进程。

常用构建和安装命令：

```bash
make build          # 构建当前平台 ./easy-proxies
make package        # 在 dist/ 生成 OTA 二进制、sha256 和安装包
make install        # 安装主程序和同目录配置到 /opt/easy-proxies
make install-systemd
```

常见运行文件：

| 路径 | 用途 |
|------|------|
| `/opt/easy-proxies/easy-proxies` | 安装后的主程序 |
| `/opt/easy-proxies/config.yaml` | 与主程序同目录的主配置文件 |
| `/opt/easy-proxies/nodes.txt` | 与主程序同目录的节点列表/缓存 |
| `/etc/systemd/system/easy-proxies.service` | 可选 systemd 服务 |

## OTA 与 CI

在 `config.yaml` 或 WebUI 设置页中启用 `update.enabled` 后，easy-proxies 可以从 GitHub Releases 自更新。

- `stable` 通道检查最新正式版，下载并校验 SHA256 后自动应用。
- `dev` 通道跟踪固定的 `dev` 预发布 tag；检查时直接从该 tag 的 release 下载地址读取 `version.json`，再下载校验二进制并等待 WebUI 或 `POST /api/update/apply` 确认。
- OTA 使用裸二进制资产：`easy-proxies-linux-amd64` / `easy-proxies-linux-arm64`，并要求同时存在 `.sha256`。
- OTA 下载直接使用 GitHub Releases 下载地址；`proxy_base_url` 仅保留用于兼容旧配置。
- 可开启 `update.use_fastest_node`，让 OTA 检查和下载走当前最低延迟节点。
- 人工安装继续使用 `easy-proxies-linux-amd64.tar.gz` / `easy-proxies-linux-arm64.tar.gz`。
- 构建时会注入版本信息，可通过 `easy-proxies -version` 和 `GET /api/version` 查看。

CI 工作流 [`.github/workflows/release.yml`](.github/workflows/release.yml) 会运行测试、交叉编译 Linux amd64/arm64、在推送 `main`/`master` 时刷新 `dev` 预发布、在推送 `v*` tag 时发布正式版，并继续构建 Docker 镜像。

正式版发布示例：

```bash
git tag v1.0.0
git push origin v1.0.0
```

使用 GitHub CLI 拉取最新构建：

```bash
./scripts/fetch-latest-build.sh --download-only
./scripts/fetch-latest-build.sh --stable --download-only
```

端口：

| 端口 | 用途 |
|------|------|
| 2323 | Pool/Hybrid 模式的代理池入口和 GeoIP 用户名地域分流入口 |
| 9091 | WebUI 和管理 API |
| 24000+ | Multi-port 模式，每个节点一个端口 |

## Docker 部署（可选）

Docker 仍然可用，适合希望用容器管理生命周期的场景：

```bash
./docker-start.sh
# 或
docker compose up -d
```

Docker 模式下默认使用 host 网络，并把 `./config.yaml`、`./nodes.txt` 挂载到容器内 `/app`，与 `/app/easy-proxies` 同目录。请优先使用 `docker-start.sh`，它会在启动 Compose 前生成这两个文件；手动执行 `docker compose up -d` 前需要先创建 `config.yaml` 和 `nodes.txt`。

## 重要运行说明

- 重载（`/api/reload` 或订阅刷新）会中断现有连接。
- Settings API 会把配置写回 `config.yaml`；部分设置需要重载后才能完全生效。
- 省略项默认值可在 `internal/config/config.go` 中查看。
- 日志轮转通过 `log` 配置段设置；当 `output: file` 时，日志同时写入控制台和文件，并自动轮转。

## 更新日志

详见 [CHANGELOG.md](CHANGELOG.md)。

## 开发验证

```bash
make test
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lieyanc/easy-proxies&type=Date)](https://star-history.com/#lieyanc/easy-proxies&Date)

## 致谢

本项目基于 [sing-box](https://github.com/SagerNet/sing-box) 构建 —— 底层所有协议实现、传输层与拨号逻辑都由 sing-box 提供。特别感谢 SagerNet 团队及所有贡献者的卓越工作。

## 许可证

MIT License
