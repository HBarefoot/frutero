#!/usr/bin/env bash
# Idempotent installer for the mushroom grow chamber automation.
# Run from the repo root: ./install.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
SERVICE_FILE="$ROOT_DIR/mushroom-automation.service"
SERVICE_NAME="mushroom-automation"

log() { printf '\033[1;36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Node.js 20 via NodeSource if missing.
if ! command -v node >/dev/null 2>&1; then
  log "Node.js not found. Installing Node.js 20 LTS from NodeSource."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  log "Node.js already installed: $(node --version)"
fi

# build-essential is needed so better-sqlite3 and @iiot2k/gpiox compile.
if ! dpkg -s build-essential >/dev/null 2>&1; then
  log "Installing build-essential (needed for native module compile)."
  sudo apt-get install -y build-essential python3
fi

# 2. Backend deps.
log "Installing backend dependencies."
cd "$BACKEND_DIR"
npm install --omit=optional
# Install DHT sensor lib opportunistically — non-fatal if it fails.
if ! npm install node-dht-sensor 2>/dev/null; then
  warn "node-dht-sensor install failed — that's fine while SENSOR_AVAILABLE=false. Retry when wiring the sensor."
fi
cd "$ROOT_DIR"

# 3. Frontend deps + build.
log "Installing frontend dependencies."
cd "$FRONTEND_DIR"
npm install
log "Building frontend."
npm run build
cd "$ROOT_DIR"

# 4. Copy built frontend into backend/public.
log "Publishing frontend to backend/public."
rm -rf "$BACKEND_DIR/public"
mkdir -p "$BACKEND_DIR/public"
cp -r "$FRONTEND_DIR/dist/." "$BACKEND_DIR/public/"

# 5. Seed the database (safe to re-run).
log "Seeding SQLite database."
node "$BACKEND_DIR/scripts/seed.js"

# 6. Install systemd unit.
if [ -r "$SERVICE_FILE" ]; then
  log "Installing systemd service ($SERVICE_NAME)."
  sudo cp "$SERVICE_FILE" "/etc/systemd/system/${SERVICE_NAME}.service"
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME" >/dev/null
  sudo systemctl restart "$SERVICE_NAME"
  log "Service status: $(systemctl is-active "$SERVICE_NAME")"
else
  fail "Missing service file at $SERVICE_FILE"
fi

# 7. Print access URL.
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$IP" ]; then IP="<pi-ip>"; fi
log "Done. Dashboard: http://$IP:3000"
log "Tail logs with: sudo journalctl -u $SERVICE_NAME -f"
