# Mushroom Grow Chamber Automation

Full-stack automation for a monotub fruiting chamber on a Raspberry Pi 4B. Controls grow lights and exhaust/FAE fans via a 2-channel relay module, logs DHT22 temperature/humidity, and serves a dark-themed mobile-friendly web dashboard over the local network.

## Hardware

| Pin        | Function                          |
| ---------- | --------------------------------- |
| GPIO 17    | Relay K1 → LED grow lights (AC)   |
| GPIO 18    | Relay K2 → 2x 80mm fans (12V DC)  |
| GPIO 4     | DHT22 data (sensor stubbed until connected) |
| Pin 1 (3V3)| DHT22 VCC                         |
| Pin 9 (GND)| DHT22 GND                         |

Relay module is **low-level trigger** — GPIO `LOW` = relay ON, GPIO `HIGH` = relay OFF. Inversion is handled inside `backend/gpio.js`; the rest of the code uses boolean `on`/`off` semantics.

## Install

```bash
./install.sh
```

The installer is idempotent. It installs Node.js 20 if missing, builds the frontend, seeds the SQLite database, and installs a `mushroom-automation` systemd service that starts on boot.

Once installed, the dashboard is reachable at `http://<pi-ip>:3000` from any device on the same network.

## Activating the real DHT22

When the sensor is wired up:

1. Edit `backend/config.js` and set `SENSOR_AVAILABLE: true`.
2. `sudo systemctl restart mushroom-automation`.

The "Simulated data" badge disappears and the dashboard switches to real readings. No other changes required.

## Service management

```bash
sudo systemctl status mushroom-automation
sudo systemctl restart mushroom-automation
sudo journalctl -u mushroom-automation -f
```

## Development

Run the backend and frontend separately with hot reload:

```bash
cd backend && npm run dev     # Express on :3000 with --watch
cd frontend && npm run dev    # Vite on :5173 with /api + /ws proxied to :3000
```
