#!/usr/bin/env bash
# Installe le prune Docker hebdomadaire (dimanche 04:30)
set -euo pipefail

SCRIPT_SRC="${1:-/opt/Master/deploy/scripts/docker-prune-weekly.sh}"
SCRIPT_DST="/usr/local/sbin/docker-prune-weekly.sh"
CRON_LINE="30 4 * * 0 root $SCRIPT_DST"

if [ ! -f "$SCRIPT_SRC" ]; then
  echo "Script introuvable: $SCRIPT_SRC" >&2
  exit 1
fi

sudo install -m 755 "$SCRIPT_SRC" "$SCRIPT_DST"
echo "$CRON_LINE" | sudo tee /etc/cron.d/docker-prune-weekly >/dev/null
sudo chmod 644 /etc/cron.d/docker-prune-weekly

echo "✅ Cron installé: $CRON_LINE"
echo "   Log: /var/log/docker-prune.log"
echo "   Test manuel: sudo $SCRIPT_DST"
