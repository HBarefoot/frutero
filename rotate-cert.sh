#!/usr/bin/env bash
# Regenerate the self-signed TLS cert with the current network state
# (LAN IP + Tailscale IP + Cloudflare hostname, if present). Useful
# after enrolling Tailscale post-install or changing tunnel config —
# the cert needs to cover those names/IPs for browser TLS validation
# AND service worker registration to succeed.
#
# Wraps install.sh's cert section without re-running the whole installer.
# Run as: sudo ./rotate-cert.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(id -u)" != "0" ]; then
  echo "[rotate-cert] re-running with sudo"
  exec sudo "$0" "$@"
fi

ROTATE_CERT=true bash "$ROOT_DIR/install.sh"
