#!/usr/bin/env bash
# One-time setup on an Oracle Cloud Always Free Ubuntu VM (ARM Ampere A1 or AMD E2.1.Micro).
# Usage (on the VM):  bash setup.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/codewizard26/data-leases.git}"
BRANCH="${BRANCH:-feat/verification-arkiv}"
APP_DIR="${APP_DIR:-$HOME/data-leases}"

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "==> Opening ports 80/443 in the VM firewall (Oracle Ubuntu images ship REJECT rules)"
sudo apt-get install -y iptables-persistent >/dev/null
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save

echo "==> Adding 4G swap (needed on 1 GB E2.1.Micro; harmless on ARM)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Cloning $REPO_URL ($BRANCH)"
if [ ! -d "$APP_DIR/.git" ]; then git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"; fi
cd "$APP_DIR"
mkdir -p data
[ -f .env ] || { cp .env.example .env; chmod 600 .env; echo "Created .env from .env.example - edit it before starting."; }

PUBLIC_IP="$(curl -fsS https://api.ipify.org)"
echo
echo "Done. Next:"
echo "  1. nano $APP_DIR/.env          # fill server-side settings (never commit it)"
echo "  2. cd $APP_DIR/deploy/oracle && sudo DOMAIN=${PUBLIC_IP//./-}.sslip.io docker compose up -d --build"
echo "  3. curl https://${PUBLIC_IP//./-}.sslip.io/api/public/analytics"
