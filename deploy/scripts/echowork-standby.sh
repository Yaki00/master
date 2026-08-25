#!/usr/bin/env bash
# Met EchoWork en standby — arrête les containers, conserve les volumes (postgres + uploads)
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/echowork/docker}"

echo "==> EchoWork standby"
cd "$COMPOSE_DIR"
docker compose down
echo "✅ EchoWork arrêté (volumes postgres-data et api-uploads conservés)"
echo "   Reprendre : ./deploy/scripts/echowork-resume.sh"
