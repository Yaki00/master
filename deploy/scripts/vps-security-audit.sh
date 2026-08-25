#!/usr/bin/env bash
# Audit sécurité VPS — lecture seule
set -euo pipefail

echo "========== AUDIT SÉCURITÉ VPS =========="
echo "Date: $(date -Is)"
echo ""

echo "=== SSH ==="
sudo sshd -T 2>/dev/null | grep -E 'permitrootlogin|passwordauthentication|allowusers|maxauthtries|x11forwarding'

echo ""
echo "=== UFW ==="
sudo ufw status numbered 2>/dev/null | head -25

echo ""
echo "=== Ports publics (0.0.0.0) ==="
sudo ss -tlnp | grep '0.0.0.0' | grep -v '127.0.0.1' || echo "(aucun suspect)"

echo ""
echo "=== Fail2ban ==="
sudo fail2ban-client status 2>/dev/null || echo "fail2ban: INACTIF"
sudo fail2ban-client status sshd 2>/dev/null || true

echo ""
echo "=== Docker ports host ==="
docker ps --format '{{.Names}}: {{.Ports}}' | grep -E '0\.0\.0\.0|:::' || echo "(OK — aucun port suspect)"

echo ""
echo "=== .env permissions (non 600) ==="
find /opt -name '.env' ! -perm 600 2>/dev/null | head -10 || echo "(OK)"

echo ""
echo "=== Comptes shell ==="
grep -E '/bin/(bash|sh)$' /etc/passwd
sudo passwd -S root ubuntu yaki 2>/dev/null

echo ""
echo "=== Tailscale ==="
tailscale status 2>/dev/null | head -4 || echo "(non installé)"

echo ""
echo "========================================"
