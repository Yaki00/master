#!/usr/bin/env bash
# À lancer UNE FOIS sur yaki-pc (demande ton mot de passe sudo)
# ssh yaki@100.77.151.74
# bash ~/code/Master/deploy/pc/bootstrap-pc.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  sudo usermod -aG docker "$USER"
  echo "Docker installé — déconnecte/reconnecte SSH pour le groupe docker"
fi

echo "==> Node 22"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | tr -d v | cut -d. -f1)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi

echo "==> Outils screenshot"
sudo apt-get install -y -qq scrot imagemagick || true

docker --version
node -v
npm -v
echo "OK — ensuite: cd ~/code/Master/deploy/pc && cp .env.example .env && edit WORKER_TOKEN"
