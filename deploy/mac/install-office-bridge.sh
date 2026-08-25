#!/usr/bin/env bash
# Installe le LaunchAgent OpenClaw → Master Office (sidecar Mac).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/openclaw-office-bridge"
HOME_DIR="${HOME}"
NODE_BIN="${NVM_BIN:-}"
if [ -z "${NODE_BIN}" ]; then
  if [ -x "${HOME_DIR}/.nvm/versions/node/v24.19.0/bin/node" ]; then
    NODE_BIN="${HOME_DIR}/.nvm/versions/node/v24.19.0/bin"
  elif [ -s "${HOME_DIR}/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    source "${HOME_DIR}/.nvm/nvm.sh"
    nvm use 24 >/dev/null
    NODE_BIN="$(dirname "$(command -v node)")"
  else
    NODE_BIN="$(dirname "$(command -v node)")"
  fi
fi

LABEL="com.pixelbrain.openclaw-office-bridge"
PLIST_SRC="${ROOT_DIR}/deploy/mac/${LABEL}.plist"
PLIST_DST="${HOME_DIR}/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "${HOME_DIR}/Library/LaunchAgents" "${HOME_DIR}/Library/Logs"

if [ ! -f "${APP_DIR}/.env" ]; then
  echo "Manque ${APP_DIR}/.env (copie .env.example et renseigne WORKER_TOKEN)" >&2
  exit 1
fi

cd "${APP_DIR}"
npm install

sed \
  -e "s|__APP_DIR__|${APP_DIR}|g" \
  -e "s|__NODE_BIN__|${NODE_BIN}|g" \
  -e "s|__HOME__|${HOME_DIR}|g" \
  "${PLIST_SRC}" > "${PLIST_DST}"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_DST}"
launchctl enable "gui/$(id -u)/${LABEL}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "✅ LaunchAgent ${LABEL} chargé"
echo "   logs: ${HOME_DIR}/Library/Logs/openclaw-office-bridge.log"
