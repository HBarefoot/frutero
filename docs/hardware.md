# Hardware

The bill of materials and wiring for a Frutero-controlled monotub fruiting chamber. Back to the [main README](../README.md).

This is the reference build. Other configurations (multiple light channels, more relays, alternative humidifiers, additional sensors) are all supported by the actuators registry — add them through the Hardware page in the dashboard once you've installed.

## Bill of materials

- Raspberry Pi 4B (any RAM tier)
- microSD card, 32GB+ (Class 10 / U1 minimum)
- 2-channel 5V relay module — **low-level trigger**
- DHT22 temperature + humidity sensor (with 10kΩ pull-up if your module doesn't include one)
- LED grow light strip + AC power
- 2× 80mm 12V DC fans (intake / exhaust) + 12V supply
- Optional: USB camera (UVC-compatible — Logitech C270/C310/C920 confirmed)
- Optional: NULLLAB 5V ultrasonic mister + atomizer disc (or any 5V-relay-compatible humidifier)

## GPIO pinout

| Pin          | Function                                             |
| ------------ | ---------------------------------------------------- |
| GPIO 17      | Relay K1 → LED grow lights (AC), **NC wiring**       |
| GPIO 18      | Relay K2 → 2× 80mm fans (12V DC), NO wiring          |
| GPIO 4       | DHT22 data line                                      |
| GPIO 27      | Relay K3 → ultrasonic mister (optional)              |
| Pin 1 (3V3)  | DHT22 VCC                                            |
| Pin 9 (GND)  | DHT22 GND                                            |

## Relay polarity

The relay module is **low-level trigger**: GPIO `LOW` = relay ON, GPIO `HIGH` = relay OFF. Inversion is handled inside `backend/gpio.js` via `levelFor(on, inverted)`; the rest of the codebase uses boolean `on` / `off` semantics. If you wire a different relay module, mark the actuator's `inverted` flag accordingly when you create it on the Hardware page — never write GPIO outside `gpio.js`.

The light circuit uses **NC wiring** (so the relay being ON cuts power to the lights, OFF lets them run). The actuator is configured with `inverted=true` to make the dashboard's ON/OFF semantics match what the lights are actually doing.

## Misting safety

The mister actuator ships with conservative safety defaults so you don't dry-fire the atomizer disc:

- `auto_off_seconds: 10` — hard cap on a single pulse
- `max_on_seconds: 30` — never run continuously past 30s
- `min_off_seconds: 30` — minimum gap between pulses
- `daily_max_seconds: 1800` — 30 min total per day

These are enforced in `backend/gpio.js` and surface as HTTP 429 `safety_blocked` from the API when violated. You can tune them per-actuator on the Hardware page after install — just don't disable them.

## Activating the real DHT22

The default install runs the sensor in stub mode so the dashboard works on day one. When you've actually wired the DHT22 in:

1. Edit `backend/config.js` and set `SENSOR_AVAILABLE: true`.
2. `sudo systemctl restart mushroom-automation`.

The "Simulated data" badge disappears and the dashboard switches to real readings. No other config changes required.

## 1-Wire / DS18B20

1-Wire is **NOT enabled by default** because the standard `dtoverlay=w1-gpio` claims GPIO 4 — which is the DHT22 data line in the reference wiring above. If you want DS18B20 temperature probes, either:

- Move the DHT22 to a different GPIO and enable 1-Wire on GPIO 4 by adding `dtoverlay=w1-gpio` to `/boot/firmware/config.txt`, **or**
- Use `dtoverlay=w1-gpio,gpiopin=N` with a different pin and wire the probes there.

Either way, reboot. The Hardware page will then show any detected DS18B20 probes under the Sensors panel.

## What's already enabled

Confirmed enabled on a stock install (Bookworm + the installer):

- libgpiod chardev (`gpiochip0`, 58 lines)
- I²C buses (`/dev/i2c-20`, `/dev/i2c-21`) — installer adds `dtparam=i2c_arm=on` to `/boot/firmware/config.txt`
- V4L2 (`v4l2-ctl`) for USB cameras
- ffmpeg 7.1+ for camera snapshots and timelapse

The Pi CSI/ISP devices (`/dev/video10–31`) exist but are not used by Frutero — only USB UVC cameras are supported.
