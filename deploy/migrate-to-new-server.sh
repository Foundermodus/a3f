#!/usr/bin/env bash
# Restore the A3F backend on a fresh server from a data tarball.
# Run AFTER: sudo bash /opt/a3f/deploy/install.sh has been run (or while running it).
#
# Usage:  sudo bash migrate-to-new-server.sh /path/to/data.tar.gz
set -euo pipefail

TARBALL="${1:-}"
APP_DIR="${APP_DIR:-/opt/a3f}"
RUN_USER="${RUN_USER:-a3f}"

[[ -z "$TARBALL" || ! -f "$TARBALL" ]] && { echo "usage: sudo $0 <data.tar.gz>"; exit 1; }
[[ $EUID -ne 0 ]] && { echo "run as root"; exit 1; }

# 1. Bring repo up & install if not yet there
if [[ ! -d "$APP_DIR/.git" ]]; then
  apt-get update && apt-get install -y nodejs npm git curl
  git clone --branch main --quiet https://github.com/Foundermodus/a3f.git "$APP_DIR"
  bash "$APP_DIR/deploy/install.sh"
fi

systemctl stop a3f.service 2>/dev/null || true

# 2. Restore data + .env from tarball
tar xzf "$TARBALL" -C "$APP_DIR/backend/"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR/backend/data" "$APP_DIR/backend/uploads"
chown "$RUN_USER:$RUN_USER" "$APP_DIR/backend/.env"
chmod 600 "$APP_DIR/backend/.env"

# 3. Start
systemctl start a3f.service
sleep 2
curl -fsS http://127.0.0.1:3301/health >/dev/null && echo "✓ a3f.service active on 127.0.0.1:3301"

# 4. Show counts
ROWS=$(curl -sS http://127.0.0.1:3301/api/stats | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])" 2>/dev/null || echo "?")
FILES=$(ls "$APP_DIR/backend/uploads/"*.jpg 2>/dev/null | wc -l)
echo "  participants in DB:  $ROWS"
echo "  photo files:         $FILES"
echo
echo "Next:"
echo "  1) sudo apt-get install -y cloudflared"
echo "  2) sudo cloudflared service install <YOUR_TUNNEL_TOKEN>"
echo "  3) sudo systemctl enable --now cloudflared"
echo "  4) Im Cloudflare-Dashboard: Public Hostname a3f-api.<deine-domain> → http://localhost:3301"
echo "  5) frontend/config.js auf neue Subdomain anpassen + push"
echo "  6) CORS_ORIGIN bleibt https://foundermodus.github.io"
echo "Siehe /opt/a3f/HANDOFF.md für Details."
