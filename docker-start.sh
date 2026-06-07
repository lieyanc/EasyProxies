#!/usr/bin/env sh
set -eu

mkdir -p data logs

docker compose pull
docker compose down
docker compose up -d
