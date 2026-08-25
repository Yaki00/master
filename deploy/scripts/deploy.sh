#!/usr/bin/env bash
# Déploiement Infisical sur le VPS Pixel Brain
set -euo pipefail

VPS="${VPS:-yaki@51.210.11.46}"
REMOTE_DIR="/opt/infisical"
DOMAIN="secrets.pixelbrain.fr"
VPS_IP="51.210.11.46"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "==> Sync deploy/ vers ${VPS}:${REMOTE_DIR}"
ssh "$VPS" "mkdir -p ${REMOTE_DIR}"
rsync -avz \
  "$ROOT_DIR/deploy/docker-compose.yml" \
  "$VPS:${REMOTE_DIR}/docker-compose.yml"

echo "==> Génération .env sur le VPS (si absent)"
ssh "$VPS" "bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/infisical
if [ ! -f .env ]; then
  ENC=$(openssl rand -hex 16)
  AUTH=$(openssl rand -base64 32)
  PG=$(openssl rand -hex 24)
  cat > .env <<EOF
ENCRYPTION_KEY=${ENC}
AUTH_SECRET=${AUTH}
POSTGRES_PASSWORD=${PG}
POSTGRES_USER=infisical
POSTGRES_DB=infisical
DB_CONNECTION_URI=postgres://infisical:${PG}@db:5432/infisical
REDIS_URL=redis://redis:6379
SITE_URL=https://secrets.pixelbrain.fr
EOF
  chmod 600 .env
  echo ".env créé."
else
  echo ".env existe déjà — conservé."
fi
REMOTE

echo "==> Démarrage Infisical (Docker)"
ssh "$VPS" "cd ${REMOTE_DIR} && docker compose pull && docker compose up -d"

echo "==> DNS OVH (A record secrets -> ${VPS_IP})"
ssh "$VPS" "OVH_ENV_FILE=/opt/PixelbrainCard/secrets/ovh.env /opt/PixelbrainCard/deploy/scripts/ovh-dns.sh add-a secrets ${VPS_IP}" || echo "DNS: record peut-être déjà existant"

echo "==> Nginx: ajout ${DOMAIN} au bloc HTTP"
ssh "$VPS" "bash -s" <<'REMOTE'
set -euo pipefail
NGINX_CONF=/opt/reverse-proxy/nginx.conf
if ! grep -q 'secrets.pixelbrain.fr' "$NGINX_CONF"; then
  sed -i 's/platform.card.pixelbrain.fr;/platform.card.pixelbrain.fr\n            secrets.pixelbrain.fr;/' "$NGINX_CONF"
  echo "server_name HTTP mis à jour."
fi
REMOTE

echo "==> Certificat TLS Let's Encrypt"
ssh "$VPS" "sudo certbot certonly --webroot -w /var/lib/docker/volumes/docker_certbot-webroot/_data -d secrets.pixelbrain.fr --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring" \
  || echo "Certbot: certificat déjà présent ou échec — vérifier manuellement"

echo "==> Nginx: vhost Infisical"
rsync -avz "$ROOT_DIR/reverse-proxy/conf.d/infisical.conf" "$VPS:/opt/reverse-proxy/conf.d/infisical.conf"
ssh "$VPS" "cd /opt/reverse-proxy && docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload"

echo ""
echo "✅ Déploiement terminé."
echo "   URL : https://${DOMAIN}"
echo "   Prochaine étape : créer ton compte admin sur le dashboard."
