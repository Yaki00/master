#!/usr/bin/env bash
# Migration réseau Docker : docker_ekowrk-network → pixelbrain-net
# ATTENTION: redémarre brièvement la connectivité entre containers.
# Usage: ./deploy/scripts/migrate-docker-network.sh [--dry-run]
set -euo pipefail

OLD_NET="${OLD_NET:-docker_ekowrk-network}"
NEW_NET="${NEW_NET:-pixelbrain-net}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

echo "==> Réseau actuel: $OLD_NET → cible: $NEW_NET"
if ! docker network inspect "$OLD_NET" >/dev/null 2>&1; then
  echo "Réseau source introuvable: $OLD_NET" >&2
  exit 1
fi

CONTAINERS=$(docker network inspect "$OLD_NET" -f '{{range $k,$v := .Containers}}{{$v.Name}} {{end}}')
echo "Containers concernés: $CONTAINERS"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] Créerait $NEW_NET et reconnecterait les containers."
  exit 0
fi

read -r -p "Continuer ? (yes/NO) " ans
[[ "$ans" == "yes" ]] || { echo "Annulé."; exit 1; }

docker network inspect "$NEW_NET" >/dev/null 2>&1 || docker network create --driver bridge "$NEW_NET"

for c in $CONTAINERS; do
  echo "→ reconnect $c"
  docker network connect "$NEW_NET" "$c" 2>/dev/null || true
done

echo ""
echo "✅ $NEW_NET prêt. Mets à jour les compose:"
echo "   networks.proxy.name: $NEW_NET"
echo "   Puis redéploie master-panel / reverse-proxy."
echo "   Une fois stable, déconnecte les containers de $OLD_NET puis:"
echo "   docker network rm $OLD_NET"
