#!/usr/bin/env bash
# Playbook orga CDC-04 — preuve nesting (peut être long / kill announce)
set -euo pipefail
echo "T1 secrétaire"
openclaw agent --agent office --session-key agent:office:playbook --model ollama-mac/qwen2.5:7b \
  --thinking off --local --timeout 40 --json --message 'Réponds UNIQUEMENT: PB-SEC-OK' \
  | tee /tmp/pb1.json | grep -q PB-SEC-OK
echo "T2 chef"
openclaw agent --agent chef --session-key agent:chef:playbook --model ollama-mac/qwen2.5:7b \
  --thinking off --local --timeout 40 --json --message 'Réponds UNIQUEMENT: PB-CHEF-OK' \
  | tee /tmp/pb2.json | grep -q PB-CHEF-OK
echo "T3 mgr-dev"
openclaw agent --agent mgr-dev --session-key agent:mgr-dev:playbook --model ollama-mac/qwen2.5:7b \
  --thinking off --local --timeout 45 --json --message 'Réponds UNIQUEMENT: PB-MGR-OK' \
  | tee /tmp/pb3.json | grep -q PB-MGR-OK
echo "PLAYBOOK OK"
