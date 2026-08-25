#!/usr/bin/env bash
# Durcissement sécurité VPS Pixel Brain
# - fail2ban (sans whitelist IP utilisateur — IP dynamique OK)
# - SSH hardening
# - Postgres localhost only
# - Permissions .env
set -euo pipefail

echo "==> fail2ban"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban

sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
[DEFAULT]
# Pas de whitelist IP perso (IP dynamique) — Tailscale exempté
ignoreip = 127.0.0.1/8 ::1 100.64.0.0/10
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd
banaction = ufw

[sshd]
enabled  = true
port     = ssh
filter   = sshd
maxretry = 4
bantime  = 24h
findtime = 10m
EOF

sudo systemctl enable fail2ban
sudo systemctl restart fail2ban

echo "==> SSH hardening"
sudo tee /etc/ssh/sshd_config.d/99-pixelbrain-hardening.conf >/dev/null <<'EOF'
# Pixel Brain — durcissement SSH
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding yes
AllowUsers yaki
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

sudo sshd -t
sudo systemctl reload sshd

echo "==> Compte ubuntu verrouillé (non utilisé)"
sudo usermod -L ubuntu 2>/dev/null || true
sudo passwd -l ubuntu 2>/dev/null || true

echo "==> Postgres pb-postgres — localhost uniquement"
PB_COMPOSE="/opt/Pixel-Brain/n8n/postgres/docker-compose.yml"
if [ -f "$PB_COMPOSE" ]; then
  if grep -q '"5433:5432"' /opt/PixelbrainCard/docker-compose.yml 2>/dev/null; then
    :
  fi
  sudo sed -i 's/- "${POSTGRES_PORT:-5432}:5432"/- "127.0.0.1:${POSTGRES_PORT:-5432}:5432"/' "$PB_COMPOSE" || true
  sudo sed -i 's/- "5433:5432"/- "127.0.0.1:5433:5432"/' /opt/PixelbrainCard/docker-compose.yml 2>/dev/null || true
  if [ -d /opt/Pixel-Brain/n8n/postgres ]; then
    cd /opt/Pixel-Brain/n8n/postgres
    docker compose up -d postgres 2>/dev/null || docker compose up -d 2>/dev/null || true
  fi
fi

echo "==> UFW — refuser Postgres externe (filet de sécurité)"
sudo ufw deny 5433/tcp comment 'Postgres no public' 2>/dev/null || true
sudo ufw deny 5432/tcp comment 'Postgres no public' 2>/dev/null || true

echo "==> Permissions .env sensibles"
sudo find /opt -name '.env' -type f ! -perm 600 -exec chmod 600 {} \; 2>/dev/null || true

echo "==> unattended-upgrades actif"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades apt-listchanges 2>/dev/null || true
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | sudo debconf-set-selections
sudo DEBIAN_FRONTEND=noninteractive dpkg-reconfigure -f noninteractive unattended-upgrades 2>/dev/null || true

echo ""
echo "✅ Durcissement terminé"
echo ""
sudo fail2ban-client status sshd 2>/dev/null || sudo fail2ban-client status
sudo ss -tlnp | grep -E ':22|:5433|:5432' || true
