#!/usr/bin/env bash
# Smoke office V-pro (CDC-10) — Mac local + Master public
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0
FAIL=0
check() {
  local name="$1"
  shift
  if "$@"; then
    echo "OK  $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "== unit master-web =="
(cd "$ROOT/apps/master-web" && npm test --silent) && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))

echo "== unit bridge =="
(cd "$ROOT/apps/openclaw-office-bridge" && npm test --silent) && PASS=$((PASS + 1)) || FAIL=$((FAIL + 1))

echo "== ollama =="
check "ollama tags" curl -sf -m 5 http://127.0.0.1:11434/api/tags >/dev/null

echo "== openclaw agents =="
check "office listed" bash -c 'openclaw agents list 2>/dev/null | grep -q "office"'
check "chef listed" bash -c 'openclaw agents list 2>/dev/null | grep -q "chef"'
check "mgr-dev listed" bash -c 'openclaw agents list 2>/dev/null | grep -q "mgr-dev"'

echo "== public =="
code=$(curl -sS -o /dev/null -w '%{http_code}' https://master.pixelbrain.fr/login || echo 000)
check "login 200" test "$code" = "200"

echo "== bridge log recent =="
check "bridge log exists" test -f "$HOME/Library/Logs/openclaw-office-bridge.log"

echo "——"
echo "PASS=$PASS FAIL=$FAIL"
test "$FAIL" -eq 0
