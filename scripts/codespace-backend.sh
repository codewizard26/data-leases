#!/usr/bin/env bash
# Run the Data Leases backend (agent-gateway + 10 provider agents) in GitHub Codespaces
# and expose only the gateway (port 3000) publicly for the Vercel web console.
# Usage: bash scripts/codespace-backend.sh [start|stop|restart|status|url|logs]
set -euo pipefail
cd "$(dirname "$0")/.."

LOG=data/tmp/backend.log
PID=data/tmp/backend.pid
PORT=3000
mkdir -p data/tmp

gateway_url() {
  if [ -n "${CODESPACE_NAME:-}" ]; then
    echo "https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  else
    echo "http://127.0.0.1:${PORT}"
  fi
}

running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }

start() {
  if running; then echo "Backend already running (pid $(cat "$PID"))."; status; return; fi
  # .env is optional here: Codespaces secrets arrive as environment variables, and Node's
  # --env-file never overrides variables that are already set in the environment.
  if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; echo "Created .env from .env.example (secrets come from Codespaces secrets)."; fi
  export WEB_ORIGINS="${WEB_ORIGINS:-https://data-leases.vercel.app}"
  export START_WEB=false BUYER_DEV_LOGIN=false BUYER_ALLOW_LOCAL_HTTP=false
  # setsid + nohup: keep running after the dev container postStartCommand returns.
  if command -v setsid >/dev/null; then setsid nohup node --env-file=.env --import tsx scripts/dev.ts >"$LOG" 2>&1 < /dev/null &
  else nohup node --env-file=.env --import tsx scripts/dev.ts >"$LOG" 2>&1 < /dev/null &
  fi
  echo $! >"$PID"
  echo "Starting backend (pid $(cat "$PID")), logs: $LOG"
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:${PORT}/api/auth/session" >/dev/null 2>&1 && break
    running || { echo "Backend exited; last log lines:"; tail -n 30 "$LOG"; exit 1; }
    sleep 1
  done
  make_public
  status
}

make_public() {
  # Only the gateway is public; provider ports stay private to the codespace.
  if [ -n "${CODESPACE_NAME:-}" ] && command -v gh >/dev/null; then
    gh codespace ports visibility "${PORT}:public" -c "$CODESPACE_NAME" >/dev/null 2>&1 \
      && echo "Port ${PORT} is public." \
      || echo "Could not set port ${PORT} public automatically. In the Ports tab: right-click ${PORT} > Port Visibility > Public."
  fi
}

stop() {
  if running; then kill "$(cat "$PID")" && echo "Stopped backend."; else echo "Backend not running."; fi
  rm -f "$PID"
}

status() {
  if running; then
    local providers
    providers=$(grep -c "provider ready" "$LOG" 2>/dev/null || true)
    echo "Backend: running · providers ready: ${providers:-0} · gateway: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/auth/session")"
  else
    echo "Backend: stopped"
  fi
  echo "GATEWAY_URL for Vercel: $(gateway_url)"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 2; start ;;
  status) status ;;
  url) gateway_url ;;
  logs) tail -n 100 -f "$LOG" ;;
  *) echo "usage: $0 [start|stop|restart|status|url|logs]"; exit 2 ;;
esac
