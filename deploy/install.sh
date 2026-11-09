#!/usr/bin/env bash
# One-click installer for Debian/Ubuntu VPS.
#   sudo PORT=3000 bash deploy/install.sh
#   or: curl -fsSL https://raw.githubusercontent.com/YOU/REPO/main/deploy/install.sh | sudo REPO_URL=https://github.com/YOU/REPO.git PORT=3000 bash
set -euo pipefail
PORT="${PORT:-3000}"
APP_DIR=/opt/ovpn-backend
REPO_URL="${REPO_URL:-}"
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Packages"
echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
apt-get update -y
apt-get install -y curl ca-certificates git ufw iptables iptables-persistent openssl

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  echo "==> Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Backend files"
SRC=""
if [ -f "${BASH_SOURCE[0]:-/nonexistent}" ] && [ -d "$(dirname "${BASH_SOURCE[0]}")/../backend" ]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../backend" && pwd)"
elif [ -n "$REPO_URL" ]; then
  TMP=$(mktemp -d); git clone --depth 1 "$REPO_URL" "$TMP"; SRC="$TMP/backend"
else
  echo "Set REPO_URL=<your git repo> or run from a cloned repo"; exit 1
fi
id ovpn >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin ovpn
mkdir -p "$APP_DIR"
[ -f "$APP_DIR/.env" ] && cp "$APP_DIR/.env" /tmp/ovpn.env.bak
cp -r "$SRC"/. "$APP_DIR"/
if [ -f /tmp/ovpn.env.bak ]; then mv /tmp/ovpn.env.bak "$APP_DIR/.env"
else
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  KEY=$(openssl rand -hex 16)
  sed -i "s/^PORT=.*/PORT=$PORT/; s/^API_KEY=.*/API_KEY=$KEY/" "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"
(cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
chown -R ovpn:ovpn "$APP_DIR"
PORT=$(grep '^PORT=' "$APP_DIR/.env" | cut -d= -f2)

echo "==> systemd service"
cat > /etc/systemd/system/ovpn-backend.service <<UNIT
[Unit]
Description=Fast OpenVPN picker backend
After=network-online.target
Wants=network-online.target
[Service]
User=ovpn
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable ovpn-backend
systemctl restart ovpn-backend

echo "==> Firewall (ufw + iptables)"
SSH_PORT=$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true); SSH_PORT=${SSH_PORT:-22}
ufw allow "${SSH_PORT}/tcp"     # keep SSH open first to avoid lock-out
ufw allow "${PORT}/tcp"
ufw --force enable
for p in "$SSH_PORT" "$PORT"; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport "$p" -j ACCEPT
  ip6tables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || ip6tables -I INPUT -p tcp --dport "$p" -j ACCEPT
done
netfilter-persistent save >/dev/null

IP=$(curl -fsS https://ifconfig.me 2>/dev/null || echo YOUR_VPS_IP)
echo
echo "================ DONE ================"
echo "Health  : http://$IP:$PORT/health"
echo "Best    : http://$IP:$PORT/api/best   (header x-api-key)"
echo "API key : $(grep '^API_KEY=' "$APP_DIR/.env" | cut -d= -f2)"
echo "Logs    : journalctl -u ovpn-backend -f"
echo "Also open port $PORT in your cloud provider's firewall/security group if it has one."
