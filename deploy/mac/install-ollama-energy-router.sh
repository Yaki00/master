#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST_SRC="$ROOT/deploy/mac/com.pixelbrain.ollama-energy-router.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.pixelbrain.ollama-energy-router.plist"
mkdir -p "$HOME/Library/Logs/ollama-energy-router"
cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/com.pixelbrain.ollama-energy-router" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
echo "Installed com.pixelbrain.ollama-energy-router"
curl -sf http://127.0.0.1:11435/health | python3 -m json.tool
