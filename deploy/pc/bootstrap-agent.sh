#!/usr/bin/env bash
# Bootstrap Ollama + UI tools for Master PC Agent (run on the PC).
set -euo pipefail

echo "==> Ollama"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
systemctl --user enable --now ollama 2>/dev/null || true
# system install often uses system service:
sudo systemctl enable --now ollama 2>/dev/null || true

echo "==> Pull models (peut être long)"
ollama pull llama3.2:3b
ollama pull qwen2.5:7b
ollama pull llava:7b

echo "==> UI tools"
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y xdotool scrot xclip imagemagick || true
fi

mkdir -p "$HOME/.master-pc-agent/skills"
if [[ ! -f "$HOME/.master-pc-agent/models.json" ]]; then
  cp "$(dirname "$0")/../../apps/pc-worker/models.example.json" "$HOME/.master-pc-agent/models.json" 2>/dev/null \
    || cat > "$HOME/.master-pc-agent/models.json" <<'EOF'
{
  "fast": "llama3.2:3b",
  "reason": "qwen2.5:7b",
  "vision": "llava:7b"
}
EOF
fi

echo "==> systemd user unit"
mkdir -p "$HOME/.config/systemd/user"
cp "$(dirname "$0")/pc-worker.service" "$HOME/.config/systemd/user/pc-worker.service"
systemctl --user daemon-reload
echo "Ensuite: systemctl --user enable --now pc-worker"
echo "OK"
