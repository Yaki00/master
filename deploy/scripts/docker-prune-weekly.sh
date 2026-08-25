#!/usr/bin/env bash
# Nettoyage Docker hebdomadaire — cache build + images orphelines (sans volumes)
set -euo pipefail

LOG="/var/log/docker-prune.log"
exec >> "$LOG" 2>&1

echo "=== $(date -Is) docker-prune-weekly ==="
echo "Avant: $(df -h / | tail -1)"

# Cache de build > 7 jours (ou tout si vide)
docker builder prune -af --filter 'until=168h' 2>/dev/null || docker builder prune -af

# Images non utilisées par un container > 7 jours
docker image prune -af --filter 'until=168h'

# Containers arrêtés
docker container prune -f

# Tronquer les logs container > 50 Mo
find /var/lib/docker/containers -name '*-json.log' -size +50M -exec truncate -s 10M {} \; 2>/dev/null || true

echo "Après: $(df -h / | tail -1)"
docker system df
echo ""
