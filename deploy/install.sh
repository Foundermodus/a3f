#!/usr/bin/env bash
# One-shot installer for the A3F backend on albumyoo.
# Idempotent — safe to re-run after a `git pull`.
set -euo pipefail

REPO="${REPO:-https://github.com/Foundermodus/a3f.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/a3f}"
RUN_USER="${RUN_USER:-a3f}"

need_root() { [[ $EUID -eq 0 ]] || { echo "run as root: sudo $0"; exit 1; }; }
need_root

# 1. Service user
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$RUN_USER"
fi

# 2. Code
if [[ ! -d "$APP_DIR/.git" ]]; then
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
else
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi

# 3. Env file
if [[ ! -f "$APP_DIR/backend/.env" ]]; then
  cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env"
  ADMIN_KEY="$(head -c 24 /dev/urandom | base64 | tr -d '+/=' )"
  sed -i "s|ADMIN_KEY=.*|ADMIN_KEY=$ADMIN_KEY|" "$APP_DIR/backend/.env"
  echo ">> generated ADMIN_KEY in $APP_DIR/backend/.env"
fi
chmod 600 "$APP_DIR/backend/.env"
chown "$RUN_USER:$RUN_USER" "$APP_DIR/backend/.env"

# 4. Dependencies
mkdir -p "$APP_DIR/backend/data" "$APP_DIR/backend/uploads"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
sudo -u "$RUN_USER" -H bash -c "cd $APP_DIR/backend && npm ci --omit=dev"

# 5. systemd unit
install -m 0644 "$APP_DIR/deploy/a3f.service" /etc/systemd/system/a3f.service
systemctl daemon-reload
systemctl enable --now a3f.service

# 6. Health probe
sleep 1
if curl -fsS http://127.0.0.1:3300/health >/dev/null; then
  echo ">> a3f backend running on 127.0.0.1:3300"
else
  echo "!! health check failed — see: journalctl -u a3f -n 50"
  exit 1
fi

cat <<EOF

Next:
  1. Edit /opt/a3f/backend/.env  (CORS_ORIGIN, PUBLIC_BASE_URL)
     systemctl restart a3f
  2. Copy deploy/a3f.nginx.conf to /etc/nginx/sites-available/a3f.conf
     ln -s /etc/nginx/sites-available/a3f.conf /etc/nginx/sites-enabled/
     certbot --nginx -d a3f.<your-domain>
     systemctl reload nginx
  3. ADMIN_KEY (for DELETE):
     grep ^ADMIN_KEY /opt/a3f/backend/.env
EOF
