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

# 6. TLS cert — self-signed, 10-year validity, CN = <hostname>.local.
#    Idempotent: skip if an existing cert is already present. Operators
#    who want a real cert (LetsEncrypt, ACM, etc.) just replace the files
#    in-place — no app code changes needed.
TLS_DIR="/etc/frutero"
TLS_KEY="$TLS_DIR/server.key"
TLS_CERT="$TLS_DIR/server.crt"
# Build the SAN list dynamically so the cert covers every address the
# operator might use to reach this Pi: hostname.local, localhost, all
# detected non-loopback IPv4 addresses (including LAN + Tailscale +
# any tunnel interfaces), and the Cloudflare Tunnel hostname when one
# is configured. Anything in the cert SAN list won't trigger a browser
# cert warning AND can register a service worker.
build_sans() {
  local sans="DNS:${PI_HOSTNAME}.local,DNS:localhost,IP:127.0.0.1"
  # All non-loopback IPv4 addresses
  local ip
  for ip in $(hostname -I 2>/dev/null); do
    if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      sans+=",IP:${ip}"
    fi
  done
  # Tailscale: explicit query in case the interface isn't named tailscale0
  if command -v tailscale >/dev/null 2>&1; then
    local ts_ip
    ts_ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
    if [[ "$ts_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ ",${sans}," != *",IP:${ts_ip},"* ]]; then
      sans+=",IP:${ts_ip}"
    fi
    # Tailscale magic DNS hostname (e.g. <hostname>.<tailnet>.ts.net)
    local ts_dns
    ts_dns="$(tailscale status --self --json 2>/dev/null | grep -oE '"DNSName"\s*:\s*"[^"]+"' | head -1 | sed 's/.*"\([^"]\+\)"$/\1/' | sed 's/\.$//' || true)"
    if [ -n "$ts_dns" ]; then
      sans+=",DNS:${ts_dns}"
    fi
  fi
  # Cloudflare Tunnel hostname from the operator's config (if any)
  local cf_yml
  for cf_yml in /etc/cloudflared/config.yml /etc/cloudflared/config.yaml; do
    if [ -f "$cf_yml" ]; then
      local cf_host
      cf_host="$(grep -oE "hostname:\s*['\"]?[a-zA-Z0-9.-]+" "$cf_yml" | head -1 | sed 's/hostname:[[:space:]]*//;s/[\"'\'']//g' || true)"
      if [ -n "$cf_host" ]; then
        sans+=",DNS:${cf_host}"
      fi
      break
    fi
  done
  echo "$sans"
}

PI_HOSTNAME="$(hostname)"
ROTATE_CERT="${ROTATE_CERT:-false}"

if [ "$ROTATE_CERT" = "true" ] || [ ! -f "$TLS_KEY" ] || [ ! -f "$TLS_CERT" ]; then
  if [ -f "$TLS_CERT" ]; then
    log "Rotating TLS cert with current network state."
    sudo mv "$TLS_CERT" "${TLS_CERT}.bak.$(date +%s)"
    sudo mv "$TLS_KEY" "${TLS_KEY}.bak.$(date +%s)" 2>/dev/null || true
  fi
  TLS_SANS="$(build_sans)"
  log "Generating self-signed TLS cert (10 year validity) at $TLS_DIR."
  log "  SANs: $TLS_SANS"
  sudo mkdir -p "$TLS_DIR"
  sudo openssl req -x509 -newkey rsa:4096 -nodes \
    -keyout "$TLS_KEY" -out "$TLS_CERT" \
    -days 3650 \
    -subj "/CN=${PI_HOSTNAME}.local" \
    -addext "subjectAltName=${TLS_SANS}" \
    >/dev/null 2>&1
  # Cert must be group-readable by the service user. When install.sh is
  # invoked via sudo, $USER is 'root' and SUDO_USER is the real user —
  # prefer SUDO_USER so the group ends up matching the admin account.
  SERVICE_USER="${SUDO_USER:-$USER}"
  sudo chown "root:${SERVICE_USER}" "$TLS_KEY" "$TLS_CERT"
  sudo chmod 640 "$TLS_KEY"
  sudo chmod 644 "$TLS_CERT"
else
  log "TLS cert already present at $TLS_CERT (run with ROTATE_CERT=true to regenerate with current network state)."
fi

# 7. Install systemd unit + TLS env drop-in.
if [ -r "$SERVICE_FILE" ]; then
  log "Installing systemd service ($SERVICE_NAME)."
  sudo cp "$SERVICE_FILE" "/etc/systemd/system/${SERVICE_NAME}.service"

  # Drop-in lets us toggle TLS env separately from the shipped unit file.
  DROPIN_DIR="/etc/systemd/system/${SERVICE_NAME}.service.d"
  sudo mkdir -p "$DROPIN_DIR"
  sudo tee "$DROPIN_DIR/tls.conf" >/dev/null <<EOF
[Service]
Environment=TLS_ENABLED=true
Environment=TLS_KEY_PATH=$TLS_KEY
Environment=TLS_CERT_PATH=$TLS_CERT
Environment=HTTPS_PORT=3443
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME" >/dev/null
  sudo systemctl restart "$SERVICE_NAME"
  log "Service status: $(systemctl is-active "$SERVICE_NAME")"
else
  fail "Missing service file at $SERVICE_FILE"
fi

# 7c. Browser terminal (ttyd + dedicated systemd unit + Express proxy).
#     ttyd binds to loopback only; the Express HTTPS proxy at /terminal
#     is the single auth + TLS surface. Idempotent — skips work that's
#     already done.
TTYD_VERSION="1.7.7"
TERMINAL_SERVICE_FILE="$ROOT_DIR/service/frutero-terminal.service"
TERMINAL_SERVICE_NAME="frutero-terminal"
TERMINAL_ENV_FILE="/etc/frutero-terminal.env"

if ! command -v ttyd >/dev/null 2>&1; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    aarch64|arm64) TTYD_ASSET="ttyd.aarch64" ;;
    armv7l|armhf)  TTYD_ASSET="ttyd.armhf" ;;
    x86_64|amd64)  TTYD_ASSET="ttyd.x86_64" ;;
    *) TTYD_ASSET="" ;;
  esac
  if [ -n "$TTYD_ASSET" ]; then
    TTYD_URL="https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/${TTYD_ASSET}"
    log "Downloading ttyd ${TTYD_VERSION} (${ARCH})."
    if sudo curl -fsSL "$TTYD_URL" -o /usr/local/bin/ttyd; then
      sudo chmod +x /usr/local/bin/ttyd
      log "Installed ttyd at /usr/local/bin/ttyd."
    else
      warn "ttyd download failed; browser terminal disabled. Re-run install.sh once network is back."
    fi
  else
    warn "Unrecognized arch '$ARCH' — skipping ttyd. Browser terminal disabled."
  fi
fi

if command -v ttyd >/dev/null 2>&1 && [ -r "$TERMINAL_SERVICE_FILE" ]; then
  # Generate a random password if no env file yet. Persisted across
  # re-runs so the URL stays stable; rotate by deleting the env file
  # and re-running this section.
  if [ ! -f "$TERMINAL_ENV_FILE" ]; then
    log "Generating browser terminal password."
    TERM_PWD="$(openssl rand -hex 16)"
    sudo tee "$TERMINAL_ENV_FILE" >/dev/null <<EOF
TERMINAL_PASSWORD=$TERM_PWD
EOF
    sudo chmod 600 "$TERMINAL_ENV_FILE"
    sudo chown root:root "$TERMINAL_ENV_FILE"
    # Mirror into the Pi's secrets table so the UI can show it copy-
    # paste-able. The backend reads from secrets, not the env file
    # directly, so it doesn't need root permissions.
    SERVICE_USER="${SUDO_USER:-$USER}"
    sudo -u "$SERVICE_USER" node -e "
      const db = require('$BACKEND_DIR/database');
      db.init();
      db.Q.setSecret('terminal_password', '$TERM_PWD');
    " || warn "Could not seed terminal_password into secrets; UI will say 'unknown'."
  fi

  log "Installing systemd service ($TERMINAL_SERVICE_NAME)."
  sudo cp "$TERMINAL_SERVICE_FILE" "/etc/systemd/system/${TERMINAL_SERVICE_NAME}.service"
  sudo systemctl daemon-reload
  sudo systemctl enable "$TERMINAL_SERVICE_NAME" >/dev/null
  sudo systemctl restart "$TERMINAL_SERVICE_NAME" || warn "ttyd failed to start — check journalctl -u $TERMINAL_SERVICE_NAME"
fi

# 7b. Cap journald disk usage so months of uptime don't eat the SD card.
#     Idempotent — only writes if missing. Values chosen to leave plenty of
#     room for investigation while being boring and safe on 16–32GB cards.
JOURNALD_DROPIN="/etc/systemd/journald.conf.d/frutero.conf"
if [ ! -f "$JOURNALD_DROPIN" ]; then
  log "Configuring journald rotation at $JOURNALD_DROPIN."
  sudo mkdir -p /etc/systemd/journald.conf.d
  sudo tee "$JOURNALD_DROPIN" >/dev/null <<'EOF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=30day
RateLimitIntervalSec=30s
RateLimitBurst=1000
EOF
  sudo systemctl restart systemd-journald
else
  log "journald rotation config already in place."
fi

# 8. Enable I²C in the boot config so /api/hardware/i2c can detect sensors.
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

# 9. Ensure the service user is in the gpio group (for libgpiod access
#    without sudo). Under sudo, $USER is 'root'; SUDO_USER is the real
#    account we want to grant the group to.
SERVICE_USER="${SUDO_USER:-$USER}"
if $IS_PI && id -nG "$SERVICE_USER" 2>/dev/null | grep -qvw gpio; then
  log "Adding $SERVICE_USER to the gpio group (log out + back in to activate)."
  sudo usermod -aG gpio "$SERVICE_USER" || warn "gpio group addition failed"
fi

# 10. Print access URL + next steps.
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$IP" ]; then IP="<pi-ip>"; fi
echo
log "Done. Open the dashboard to finish first-run setup:"
log "    https://$IP:3443  (accept the self-signed cert warning)"
log "    http://$IP        (redirects to HTTPS)"
log ""
log "Useful commands:"
log "    sudo journalctl -u $SERVICE_NAME -f     # tail logs"
log "    sudo systemctl restart $SERVICE_NAME    # restart appliance"
log "    sudo systemctl status $SERVICE_NAME     # check health"
if [ "${REBOOT_HINT:-false}" = "true" ]; then
  warn "I²C was just enabled — reboot to expose /dev/i2c-* before the hardware scan will detect sensors."
fi
if $IS_PI && id -nG "$SERVICE_USER" 2>/dev/null | grep -qvw gpio; then
  warn "gpio group membership pending — log out + back in (or reboot) so GPIO access works without sudo."
fi

# 11. Note: 1-Wire (dtoverlay=w1-gpio) is NOT enabled by default — GPIO 4 is
#    also the default DHT22 pin in this build. Enable it manually if you want
#    DS18B20 probes AND have moved the DHT22 to a different pin.
