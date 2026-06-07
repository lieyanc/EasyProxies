#!/usr/bin/env sh
set -eu

CONFIG_PATH="${EASY_PROXIES_CONFIG:-config.yaml}"
NODES_PATH="${EASY_PROXIES_NODES:-nodes.txt}"
BIN_PATH="${EASY_PROXIES_BIN:-./easy-proxies}"
BUILD_TAGS="with_utls with_quic with_grpc with_wireguard with_gvisor with_clash_api"

CONFIG_DIR="$(dirname "$CONFIG_PATH")"
NODES_DIR="$(dirname "$NODES_PATH")"

if [ "$CONFIG_DIR" != "." ]; then
    mkdir -p "$CONFIG_DIR"
fi

if [ "$NODES_DIR" != "." ]; then
    mkdir -p "$NODES_DIR"
fi

if [ ! -f "$CONFIG_PATH" ]; then
    cp config.example.yaml "$CONFIG_PATH"
    echo "[easy-proxies] Generated $CONFIG_PATH from config.example.yaml"
fi

if [ ! -f "$NODES_PATH" ]; then
    cp nodes.example "$NODES_PATH"
    echo "[easy-proxies] Generated $NODES_PATH from nodes.example"
fi

if [ ! -x "$BIN_PATH" ]; then
    if ! command -v go >/dev/null 2>&1; then
        echo "[easy-proxies] $BIN_PATH not found and Go is not installed" >&2
        exit 1
    fi
    echo "[easy-proxies] Building $BIN_PATH"
    CGO_ENABLED="${CGO_ENABLED:-0}" go build -trimpath -tags "$BUILD_TAGS" -ldflags "-s -w" -o "$BIN_PATH" ./cmd/easy-proxies
fi

if [ "$#" -eq 0 ]; then
    set -- -config "$CONFIG_PATH"
fi

exec "$BIN_PATH" "$@"
