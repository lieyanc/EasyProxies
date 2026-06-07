#!/bin/sh
# Auto-generate config and fix permissions, then start easy-proxies

CONFIG_DIR="/app"
CONFIG_FILE="$CONFIG_DIR/config.yaml"
NODES_FILE="$CONFIG_DIR/nodes.txt"
EXAMPLE_CONFIG="/app/config.example.yaml"
EXAMPLE_NODES="/app/nodes.example"

# Get current user uid/gid for permission fix
CURRENT_UID=$(id -u 2>/dev/null || echo "10001")
CURRENT_GID=$(id -g 2>/dev/null || echo "10001")

# Auto-generate config.yaml if not exists
if [ ! -f "$CONFIG_FILE" ]; then
    cp "$EXAMPLE_CONFIG" "$CONFIG_FILE"
    echo "[easy-proxies] Generated default config from $EXAMPLE_CONFIG"
fi

# Auto-create nodes.txt if not exists
if [ ! -f "$NODES_FILE" ]; then
    cp "$EXAMPLE_NODES" "$NODES_FILE"
    echo "[easy-proxies] Generated default nodes.txt from $EXAMPLE_NODES"
fi

# Fix ownership of mounted files so the current user can access them
chown -R "$CURRENT_UID:$CURRENT_GID" /app 2>/dev/null || true

exec /app/easy-proxies "$@"
