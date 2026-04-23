const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const config = require('./config');
const { Q } = require('./database');

// Known I²C device address → suspected chip. Multiple chips can share an
// address (e.g. SHT31 0x44 and SHT35 0x44); we report all candidates.
const I2C_KNOWN = {
  0x40: ['HTU21D / SHT21', 'INA219'],
  0x44: ['SHT31', 'SHT35'],
  0x45: ['SHT31 (alt)'],
  0x48: ['ADS1115', 'PCF8591'],
  0x4a: ['ADS1115 (alt)'],
  0x50: ['EEPROM'],
  0x57: ['EEPROM'],
  0x5c: ['BH1750', 'AM2320'],
  0x5d: ['BH1750 (alt)'],
  0x62: ['SCD41 / SCD40 (CO₂)'],
  0x68: ['DS3231 RTC', 'MPU6050'],
  0x76: ['BME280 / BMP280'],
  0x77: ['BME280 / BMP280 (alt)'],
};

// Pi BCM pins reserved by the Pi itself or by other hardware on this build.
// NOT exhaustive — just the ones we don't want users assigning to relays.
const RESERVED_PINS = {
  2: 'I²C SDA (system)',
  3: 'I²C SCL (system)',
  4: 'DHT22 (configured)',
  14: 'UART TX',
  15: 'UART RX',
};

const ALL_GPIO_PINS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, 26, 27,
];

// ---------------- I²C ----------------

function listI2cBuses() {
  let entries;
  try { entries = fs.readdirSync('/dev'); }
  catch { return []; }
  return entries
    .filter((n) => /^i2c-\d+$/.test(n))
    .map((n) => ({
      path: `/dev/${n}`,
      bus: parseInt(n.slice(4), 10),
    }))
    .sort((a, b) => a.bus - b.bus);
}

function detectI2cAddresses(busNumber) {
  // Returns list of detected 7-bit addresses on a bus, or null if i2cdetect
  // isn't available / the bus isn't readable.
  try {
    const out = execFileSync('i2cdetect', ['-y', String(busNumber)], {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return parseI2cdetectOutput(out);
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'i2cdetect_not_installed' : (err.message || 'detect_failed') };
  }
}

function parseI2cdetectOutput(text) {
  const found = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-f]{2}):\s*(.+)$/i);
    if (!m) continue;
    const rowBase = parseInt(m[1], 16);
    const cells = m[2].trim().split(/\s+/);
    cells.forEach((cell, i) => {
      if (cell === '--' || cell === 'UU' || cell === '') return;
      const addr = rowBase + i;
      if (/^[0-9a-f]{2}$/i.test(cell)) {
        found.push(addr);
      }
    });
  }
  return [...new Set(found)].sort((a, b) => a - b);
}

function scanI2C() {
  // Read-only probe — safe to run regardless of GPIO_STUB.
  const buses = listI2cBuses();
  const result = buses.map((b) => {
    const detect = detectI2cAddresses(b.bus);
    if (detect && typeof detect === 'object' && 'error' in detect) {
      return { ...b, error: detect.error, devices: [] };
    }
    return {
      ...b,
      devices: detect.map((addr) => ({
        addr,
        hex: '0x' + addr.toString(16).padStart(2, '0'),
        candidates: I2C_KNOWN[addr] || ['unknown'],
      })),
    };
  });
  return { stub: false, buses: result };
}

// ---------------- 1-Wire ----------------

function scan1Wire() {
  const dir = '/sys/bus/w1/devices';
  if (!fs.existsSync(dir)) {
    return {
      stub: false,
      enabled: false,
      hint: 'Add `dtoverlay=w1-gpio` to /boot/firmware/config.txt and reboot to enable 1-Wire on GPIO 4. Note: GPIO 4 is currently used by DHT22 in this build.',
      devices: [],
    };
  }
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch (err) { return { stub: false, enabled: true, error: err.message, devices: [] }; }

  const devices = entries
    .filter((n) => n !== 'w1_bus_master1')
    .map((id) => {
      let kind = 'unknown';
      if (id.startsWith('28-')) kind = 'DS18B20 (temperature)';
      else if (id.startsWith('22-')) kind = 'DS1822';
      else if (id.startsWith('10-')) kind = 'DS18S20';
      return { id, kind };
    });
  return { stub: false, enabled: true, devices };
}

// ---------------- Video ----------------

function listVideoNodes() {
  let entries;
  try { entries = fs.readdirSync('/dev'); }
  catch { return []; }
  return entries
    .filter((n) => /^video\d+$/.test(n))
    .map((n) => ({ path: `/dev/${n}`, index: parseInt(n.slice(5), 10) }))
    .sort((a, b) => a.index - b.index);
}

function v4lInfo(devPath) {
  try {
    const out = spawnSync('v4l2-ctl', ['--device', devPath, '--all'], {
      timeout: 3000,
      encoding: 'utf-8',
    });
    if (out.status !== 0) return { error: out.stderr?.trim() || 'v4l2-ctl_failed' };
    const text = out.stdout || '';
    const cardMatch = text.match(/Card type\s*:\s*(.+)/i);
    const driverMatch = text.match(/Driver name\s*:\s*(.+)/i);
    const busMatch = text.match(/Bus info\s*:\s*(.+)/i);

    // UVC webcams expose two nodes: one for Video Capture (the actual
    // frame source) and one for Metadata Capture. Device Caps distinguishes
    // them — we only want the capture source for the live feed feature.
    const deviceCaps = text.match(/Device Caps[\s\S]*?(?=\n\n|\nMedia|\nPriority|\n\s*$)/i);
    const capturesVideo = deviceCaps
      ? /Video Capture(?!\s+Multiplanar)/i.test(deviceCaps[0])
      : false;

    return {
      card: cardMatch ? cardMatch[1].trim() : null,
      driver: driverMatch ? driverMatch[1].trim() : null,
      bus: busMatch ? busMatch[1].trim() : null,
      captures_video: capturesVideo,
    };
  } catch (err) {
    return { error: err.code === 'ENOENT' ? 'v4l2-ctl_not_installed' : (err.message || 'failed') };
  }
}

function scanVideo() {
  // USB cameras / CSI nodes are read-only to probe, so we scan for real
  // even in GPIO_STUB dev mode — otherwise plugging in a webcam during
  // development would appear as a fake "Stub Camera".
  const nodes = listVideoNodes();
  const out = nodes.map((n) => {
    const info = v4lInfo(n.path);
    // Usable for the live-feed feature iff (a) index < 10 (exclude Pi CSI/ISP
    // platform nodes), (b) v4l2-ctl worked, and (c) the node actually does
    // Video Capture — filters out UVC metadata-only sibling nodes.
    const usable = n.index < 10 && !info.error && info.captures_video === true;
    return { ...n, ...info, usable };
  });
  return { stub: false, devices: out };
}

// ---------------- GPIO ----------------

function scanGpio() {
  const actuators = Q.listActuators();
  const used = new Map();
  for (const a of actuators) {
    used.set(a.gpio_pin, { kind: 'actuator', key: a.key, name: a.name, inverted: !!a.inverted });
  }
  const pins = ALL_GPIO_PINS.map((pin) => {
    if (used.has(pin)) return { pin, status: 'in-use', ...used.get(pin) };
    if (RESERVED_PINS[pin]) return { pin, status: 'reserved', note: RESERVED_PINS[pin] };
    return { pin, status: 'free' };
  });
  return { pins, mock: config.GPIO_STUB };
}

// ---------------- Combined ----------------

function scanAll() {
  return {
    timestamp: new Date().toISOString(),
    stub: !!config.GPIO_STUB,
    i2c: scanI2C(),
    oneWire: scan1Wire(),
    video: scanVideo(),
    gpio: scanGpio(),
  };
}

module.exports = {
  scanAll,
  scanI2C,
  scan1Wire,
  scanVideo,
  scanGpio,
  RESERVED_PINS,
  ALL_GPIO_PINS,
};
