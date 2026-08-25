#!/usr/bin/env bash
# Relance EchoWork après standby
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/echowork/docker}"

echo "==> EchoWork resume"
cd "$COMPOSE_DIR"
docker compose up -d
echo "✅ EchoWork démarré"
docker compose ps
