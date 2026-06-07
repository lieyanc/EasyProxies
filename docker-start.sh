#!/usr/bin/env sh
set -eu

mkdir -p logs

if [ ! -f config.yaml ]; then
    cp config.example.yaml config.yaml
fi

if [ ! -f nodes.txt ]; then
    cp nodes.example nodes.txt
fi

docker compose pull
docker compose down
docker compose up -d
