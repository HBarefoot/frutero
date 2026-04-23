#!/usr/bin/env bash
# Idempotent installer for the frutero grow chamber automation appliance.
# Run from the repo root: ./install.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
SERVICE_FILE="$ROOT_DIR/mushroom-automation.service"
SERVICE_NAME="mushroom-automation"
BOOT_CONFIG=""

log() { printf '\033[1;36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; exit 1; }

# 0. Distro + platform detection.
if [ -r /etc/os-release ]; then
  . /etc/os-release
  log "Detected: ${PRETTY_NAME:-unknown}"
  case "$ID" in
    raspbian|debian|ubuntu) : ;;
    *) warn "Untested distro '$ID' — script targets Debian/Raspberry Pi OS. Proceeding anyway." ;;
  esac
fi
IS_PI=false
if [ -e /sys/firmware/devicetree/base/model ]; then
  MODEL="$(tr -d '\0' </sys/firmware/devicetree/base/model)"
  case "$MODEL" in
    Raspberry\ Pi*) IS_PI=true; log "Hardware: $MODEL" ;;
  esac
fi

# Bookworm moved boot config to /boot/firmware; older Pi OS keeps /boot.
if [ -f /boot/firmware/config.txt ]; then
  BOOT_CONFIG=/boot/firmware/config.txt
elif [ -f /boot/config.txt ]; then
  BOOT_CONFIG=/boot/config.txt
fi

# 1. Node.js 20 via NodeSource if missing.
if ! command -v node >/dev/null 2>&1; then
  log "Node.js not found. Installing Node.js 20 LTS from NodeSource."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  log "Node.js already installed: $(node --version)"
fi

# 1b. System packages the appliance relies on at runtime.
#   ffmpeg     — camera snapshot + MJPEG stream
#   v4l-utils  — /api/hardware/video (v4l2-ctl)
#   i2c-tools  — /api/hardware/i2c (i2cdetect)
#   build-essential / python3 — better-sqlite3 + @iiot2k/gpiox native compile
SYSTEM_PKGS=(build-essential python3 ffmpeg v4l-utils i2c-tools)
MISSING_PKGS=()
for pkg in "${SYSTEM_PKGS[@]}"; do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    MISSING_PKGS+=("$pkg")
  fi
done
if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
  log "Installing: ${MISSING_PKGS[*]}"
  sudo apt-get update -qq
  sudo apt-get install -y "${MISSING_PKGS[@]}"
else
  log "System packages already present."
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

# 7. Enable I²C in the boot config so /api/hardware/i2c can detect sensors.
#    Idempotent — only appends if the line isn't already present.
if [ -n "$BOOT_CONFIG" ] && $IS_PI; then
  if ! grep -qE '^\s*dtparam=i2c_arm=on' "$BOOT_CONFIG"; then
    log "Enabling I²C in $BOOT_CONFIG (reboot required to take effect)."
    echo 'dtparam=i2c_arm=on' | sudo tee -a "$BOOT_CONFIG" >/dev/null
    REBOOT_HINT=true
  else
    log "I²C already enabled in $BOOT_CONFIG."
  fi
  # Load the module immediately so the current boot sees /dev/i2c-*.
  sudo modprobe i2c-dev 2>/dev/null || true
fi

# 8. Ensure admin is in the gpio group (for libgpiod access without sudo).
if $IS_PI && id -nG "$USER" 2>/dev/null | grep -qvw gpio; then
  log "Adding $USER to the gpio group (log out + back in to activate)."
  sudo usermod -aG gpio "$USER" || warn "gpio group addition failed"
fi

# 9. Print access URL + next steps.
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$IP" ]; then IP="<pi-ip>"; fi
echo
log "Done. Open the dashboard to finish first-run setup:"
log "    http://$IP:3000"
log ""
log "Useful commands:"
log "    sudo journalctl -u $SERVICE_NAME -f     # tail logs"
log "    sudo systemctl restart $SERVICE_NAME    # restart appliance"
log "    sudo systemctl status $SERVICE_NAME     # check health"
if [ "${REBOOT_HINT:-false}" = "true" ]; then
  warn "I²C was just enabled — reboot to expose /dev/i2c-* before the hardware scan will detect sensors."
fi
if $IS_PI && id -nG "$USER" 2>/dev/null | grep -qvw gpio; then
  warn "gpio group membership pending — log out + back in (or reboot) so GPIO access works without sudo."
fi

# 10. Note: 1-Wire (dtoverlay=w1-gpio) is NOT enabled by default — GPIO 4 is
#    also the default DHT22 pin in this build. Enable it manually if you want
#    DS18B20 probes AND have moved the DHT22 to a different pin.
