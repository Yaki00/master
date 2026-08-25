#!/usr/bin/env bash
# Déploie Master Panel sur le VPS Pixel Brain
set -euo pipefail

VPS="${VPS:-yaki@51.210.11.46}"
REMOTE_DIR="/opt/Master"
VPS_IP="51.210.11.46"
DOMAIN="master.pixelbrain.fr"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

AUTH_PASS="${MASTER_AUTH_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)}"
AUTH_SECRET="${NEXTAUTH_SECRET:-$(openssl rand -base64 32)}"

echo "==> Sync repo vers ${VPS}:${REMOTE_DIR}"
ssh "$VPS" "sudo mkdir -p ${REMOTE_DIR} && sudo chown yaki:yaki ${REMOTE_DIR}"
rsync -avz --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude '.env' \
  --exclude '.cursor/secrets' \
  --exclude 'deploy/master-panel/.env' \
  "$ROOT_DIR/" "$VPS:${REMOTE_DIR}/"

echo "==> .env master-panel"
ssh "$VPS" "bash -s" <<REMOTE
set -euo pipefail
ENV_FILE="${REMOTE_DIR}/deploy/master-panel/.env"
if [ -f "\$ENV_FILE" ] && [ -z "${MASTER_AUTH_PASSWORD:-}" ]; then
  echo ".env existant conservé"
else
  cat > "\$ENV_FILE" <<EOF
MASTER_AUTH_PASSWORD=${AUTH_PASS}
MASTER_AUTH_EMAIL=bouchaouradam@gmail.com
NEXTAUTH_SECRET=${AUTH_SECRET}
NEXTAUTH_URL=https://${DOMAIN}
DOCKER_SOCKET=/var/run/docker.sock
EOF
  chmod 600 "\$ENV_FILE"
  echo ".env créé/mis à jour"
fi
REMOTE

echo "==> Build & start Docker"
ssh "$VPS" "cd ${REMOTE_DIR}/deploy/master-panel && docker compose build && docker compose up -d"

echo "==> DNS OVH"
ssh "$VPS" "bash /opt/PixelbrainCard/deploy/scripts/ovh-dns.sh add-a master ${VPS_IP}" || true

echo "==> Nginx HTTP server_name"
ssh "$VPS" "grep -q 'master.pixelbrain.fr' /opt/reverse-proxy/nginx.conf || sed -i 's/secrets.pixelbrain.fr;/secrets.pixelbrain.fr\n            master.pixelbrain.fr;/' /opt/reverse-proxy/nginx.conf"

echo "==> TLS"
ssh "$VPS" "sudo certbot certonly --webroot -w /var/lib/docker/volumes/docker_certbot-webroot/_data -d ${DOMAIN} --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring" || true

echo "==> Nginx vhost"
rsync -avz "$ROOT_DIR/reverse-proxy/conf.d/master.conf" "$VPS:/opt/reverse-proxy/conf.d/master.conf"
ssh "$VPS" "cd /opt/reverse-proxy && docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload"

echo ""
echo "✅ Master Panel déployé : https://${DOMAIN}"
echo "🔑 Mot de passe (note-le) : ${AUTH_PASS}"
echo "   (aussi dans ${REMOTE_DIR}/deploy/master-panel/.env sur le VPS)"
