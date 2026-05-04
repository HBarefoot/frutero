# Frutero

**Open-source mushroom farm controller for Raspberry Pi.**

Run your monotub fruiting chamber on a Pi 4B — schedules, automations, sensor logging, live camera, and an AI advisor — all on your local network, no account required. Built for indie growers who want a real controller without paying SaaS rent for a chamber sitting on their kitchen counter.

---

## What you can do with it

- **Run grow lights on a 12/12 photoperiod** (or any cron) with auto-recovery if the Pi reboots mid-cycle — boot-time state restore reads your schedule and brings actuators back to their desired state.
- **Mist the chamber when humidity drops** below your threshold, with safety clamps so an ultrasonic atomizer disc never dry-fires (max-on, min-off, daily-cap, all enforced in the GPIO layer).
- **Stream the chamber from a USB cam** to your phone over LAN, take snapshots from the dashboard, and get an auto-generated timelapse when you archive a batch.
- **Get an AI advisor** (Anthropic Claude or self-hosted Ollama) that reads your sensor trends + camera observations and flags contamination risk or pinning issues early. Configurable cadence, your own API key.
- **Track grow batches end-to-end** — phase transitions (inoculation → colonization → pinning → fruiting → harvest), per-batch yield, and an AI retrospective when you archive.
- **Get pinged when something's wrong** via Telegram, email, webhook, or browser push — sensor silence, temp drift, contamination warnings, mister safety blocks.
- **Share the dashboard with your team** with three roles (owner / operator / viewer). Bring in a co-grower as viewer or operator without giving them root.
- **Browser-based SSH into the Pi** from inside the dashboard (admin-only, password-gated) — handy when you're a few rooms away from the chamber and don't want to dig out a laptop.

---

## Quick start

```bash
git clone https://github.com/HBarefoot/frutero
cd frutero
./install.sh
```

Open `https://<pi-ip>:3443` (accept the self-signed cert), create your owner account, and you're live.

The installer is idempotent — safe to re-run anytime. It installs Node.js 20 if missing, builds the frontend, seeds the SQLite database, generates an ECDSA TLS cert, installs `mushroom-automation` as a systemd unit, and rotates journald to keep your SD card from filling up. Adds your user to the `gpio` group and bootstraps a browser terminal (`ttyd`) for in-dashboard SSH.

---

## Hardware

This runs on a Raspberry Pi 4B with a small bill of materials — a 2-channel relay module, a DHT22 temperature/humidity sensor, and optionally a USB camera and an ultrasonic mister. Full wiring + GPIO pinout: **[docs/hardware.md](./docs/hardware.md)**.

---

## Connect to the cloud (optional)

Frutero is fully featured on its own. You can run a chamber forever without ever signing up for anything. But if you're running more than one chamber, want notifications when you're off the LAN, or want fleet-wide AI insights, the **Frutero Fleet** cloud picks up where the Pi leaves off.

**What the cloud adds:**

- **Multi-chamber dashboard** — every Pi you own on one screen
- **Cross-chamber compare** — overlay temp/humidity from any 2–8 chambers
- **Yield rankings** — which chamber is winning, by species, over time
- **Fleet-wide AI advisor** — insights that span chambers, not just one
- **Web push to your phone, anywhere** — not just on your home LAN
- **Browser terminal that works from outside your house**
- **Team, audit log, and billing** for small-farm operators

**Tiers:** Hobby (1 chamber, free) → Grower (per-chamber/month) → Farm (unlimited).

**To connect:**

1. Sign up at <https://frutero-fleet-production.up.railway.app>.
2. From the cloud dashboard, click *Add chamber* and copy the one-time enrollment code.
3. On your Pi dashboard, go to **Security → Fleet**. Paste the cloud URL, the enrollment code, and an optional chamber name. Click *Enroll this Pi*.
4. The Fleet card flips to "Connected" within ~60s. Done.

The Pi only ever talks **outbound** to the cloud — no inbound ports opened, no tunneling required. You can disconnect from the same card any time, and the Pi keeps running standalone.

---

## Service management

```bash
sudo systemctl status mushroom-automation
sudo systemctl restart mushroom-automation
sudo journalctl -u mushroom-automation -f
```

## Updating

```bash
git pull
./install.sh
```

The installer is idempotent, so re-running it picks up new dependencies, rebuilds the frontend, and restarts the service in place.

## Recovery

For SD-card failure, DB corruption, sensor silence, mid-photoperiod restart, fleet-agent disconnects, hardware swaps, and schema drift — see **[docs/recovery.md](./docs/recovery.md)**.

## Development

Run the backend and frontend with stubbed hardware so you can hack on a laptop or a second-Pi dev box without touching the real chamber:

```bash
cd backend && npm run dev:stub   # PORT=3001, GPIO_STUB=true, SENSOR_STUB=true, dev.db
cd frontend && npm run dev       # Vite on :5173 with /api + /ws proxied
```

The stub backend runs side-by-side with prod on a different port and database, so you can iterate on UI without disturbing a live grow.
