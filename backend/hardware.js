const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const config = require('./config');
const sensor = require('./sensor');
const { Q } = require('./database');
const platform = require('./platform');

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
// Only consulted when running on a Raspberry Pi; non-Pi hosts get an empty
// reserved set (their pin layouts are board-specific and beyond v1 scope).
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

// USB device-class decoding. `bDeviceClass === 0x00` means "see interface
// descriptors" — for those we walk interface subdirs in scanUSB.
const USB_CLASS_LABELS = {
  0x01: 'Audio',
  0x02: 'CDC Serial',
  0x03: 'HID',
  0x05: 'Physical',
  0x06: 'Image',
  0x07: 'Printer',
  0x08: 'Mass Storage',
  0x09: 'Hub',
  0x0a: 'CDC Data',
  0x0b: 'Smart Card',
  0x0d: 'Content Security',
  0x0e: 'Video / UVC',
  0x0f: 'Personal Healthcare',
  0x10: 'Audio/Video',
  0xdc: 'Diagnostic',
  0xe0: 'Wireless',
  0xef: 'Misc / Composite',
  0xfe: 'App Specific',
  0xff: 'Vendor',
};

// ---------------- I²C ----------------

// On Raspberry Pi only /dev/i2c-1 is the canonical "user" bus exposed by
// `dtparam=i2c_arm=on`. Higher-numbered buses (10+) are internal — most
// notably /dev/i2c-20/21 are HDMI DDC, which respond to every probed
// address and would dump ~100 bogus "devices" into the UI. On generic
// Linux SBCs we trust the kernel's bus list; the I2C_NOISE_THRESHOLD
// guard at scan time still protects against any reflective bus.
function listI2cBuses() {
  let entries;
  try { entries = fs.readdirSync('/dev'); }
  catch { return []; }
  const all = entries
    .filter((n) => /^i2c-\d+$/.test(n))
    .map((n) => ({ path: `/dev/${n}`, bus: parseInt(n.slice(4), 10) }))
    .sort((a, b) => a.bus - b.bus);
  return platform.isRaspberryPi() ? all.filter((b) => b.bus <= 1) : all;
}

const I2C_NOISE_THRESHOLD = 32;

function detectI2cAddresses(busNumber) {
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
  const info = platform.getPlatformInfo();
  if (!info.capabilities.i2c) {
    return {
      available: false,
      reason: info.kind === 'linux'
        ? 'No /dev/i2c-* found or i2cdetect not installed (apt install i2c-tools)'
        : 'I²C is not available on this platform',
      stub: false,
      buses: [],
    };
  }

  const buses = listI2cBuses();
  const hint = buses.length === 0
    ? (info.is_raspberry_pi
        ? 'No user I²C bus found. Enable with `dtparam=i2c_arm=on` in /boot/firmware/config.txt and reboot.'
        : 'No /dev/i2c-* buses found. Enable I²C via your board\'s overlay/devicetree or load the i2c-dev module.')
    : null;

  const result = buses.map((b) => {
    const detect = detectI2cAddresses(b.bus);
    if (detect && typeof detect === 'object' && 'error' in detect) {
      return { ...b, error: detect.error, devices: [] };
    }
    if (detect.length > I2C_NOISE_THRESHOLD) {
      return {
        ...b,
        devices: [],
        note: `Bus returned ${detect.length} addresses — looks like a reflective bus (HDMI DDC?), ignored.`,
      };
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
  return { available: true, stub: false, buses: result, hint };
}

// ---------------- 1-Wire ----------------

function scan1Wire() {
  const dir = '/sys/bus/w1/devices';
  if (!fs.existsSync(dir)) {
    return { available: false, stub: false, enabled: false, devices: [] };
  }
  let entries;
  try { entries = fs.readdirSync(dir); }
  catch (err) { return { available: true, stub: false, enabled: true, error: err.message, devices: [] }; }

  const devices = entries
    .filter((n) => n !== 'w1_bus_master1')
    .map((id) => {
      let kind = 'unknown';
      if (id.startsWith('28-')) kind = 'DS18B20 (temperature)';
      else if (id.startsWith('22-')) kind = 'DS1822';
      else if (id.startsWith('10-')) kind = 'DS18S20';
      return { id, kind };
    });
  return { available: true, stub: false, enabled: true, devices };
}

// ---------------- Sensors (DHT22 + 1-Wire) ----------------

function scanSensors() {
  const latest = sensor.getLatest();
  const hasReading =
    Number.isFinite(latest.temperature) && Number.isFinite(latest.humidity);
  const dht22 = {
    kind: 'DHT22',
    pin: config.DHT22_PIN,
    available: !!config.SENSOR_AVAILABLE,
    simulated: hasReading ? !!latest.simulated : !config.SENSOR_AVAILABLE,
    reading: hasReading
      ? {
          temperature: latest.temperature,
          humidity: latest.humidity,
          timestamp: latest.timestamp,
        }
      : null,
  };
  return { dht22, oneWire: scan1Wire() };
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

function scanVideoLinux() {
  const info = platform.getPlatformInfo();
  if (!info.capabilities.v4l2) {
    return {
      available: false,
      reason: 'No /dev/video* found or v4l2-ctl not installed (apt install v4l-utils)',
      stub: false,
      devices: [],
    };
  }
  // USB cameras / CSI nodes are read-only to probe, so we scan for real
  // even in GPIO_STUB dev mode — otherwise plugging in a webcam during
  // development would appear as a fake "Stub Camera".
  const nodes = listVideoNodes();
  const devices = nodes.map((n) => {
    const v = v4lInfo(n.path);
    // Usable for the live-feed feature iff (a) index < 10 (exclude Pi CSI/ISP
    // platform nodes), (b) v4l2-ctl worked, and (c) the node actually does
    // Video Capture — filters out UVC metadata-only sibling nodes.
    const usable = n.index < 10 && !v.error && v.captures_video === true;
    return { ...n, ...v, usable };
  });
  return { available: true, stub: false, devices };
}

function scanVideoMacOS() {
  // system_profiler -json gives us the AVFoundation camera list. macOS dev
  // never serves the live-feed endpoint, so path is null — that signals
  // the frontend "informational only".
  try {
    const out = spawnSync('system_profiler', ['SPCameraDataType', '-json'], {
      timeout: 5000, encoding: 'utf-8',
    });
    if (out.status !== 0) {
      return { available: false, reason: out.stderr?.trim() || 'system_profiler failed', stub: false, devices: [] };
    }
    const parsed = JSON.parse(out.stdout || '{}');
    const items = parsed?.SPCameraDataType || [];
    const devices = items.map((item, i) => ({
      path: null,
      index: i,
      card: item._name || null,
      driver: 'AVFoundation',
      bus: item.spcamera_unique_id || item['spcamera_model-id'] || null,
      captures_video: true,
      usable: false, // live-feed not supported on macOS dev
    }));
    return { available: true, stub: false, devices };
  } catch (err) {
    return { available: false, reason: err.message || 'system_profiler error', stub: false, devices: [] };
  }
}

function scanVideo() {
  const info = platform.getPlatformInfo();
  if (info.kind === 'linux') return scanVideoLinux();
  if (info.kind === 'darwin') return scanVideoMacOS();
  return { available: false, reason: `Camera enumeration not supported on ${info.kind}`, stub: false, devices: [] };
}

// ---------------- GPIO ----------------

function listGpioChips() {
  // Each /dev/gpiochipN has a sibling sysfs node at /sys/class/gpio/gpiochipN
  // that exposes label + ngpio (line count). Read both for a richer picture
  // when running on non-Pi SBCs.
  try {
    const entries = fs.readdirSync('/dev').filter((n) => /^gpiochip\d+$/.test(n));
    return entries.map((name) => {
      const out = { path: `/dev/${name}`, label: null, lines: null };
      try {
        out.label = fs.readFileSync(`/sys/class/gpio/${name}/label`, 'utf8').trim();
      } catch { /* optional */ }
      try {
        const n = parseInt(fs.readFileSync(`/sys/class/gpio/${name}/ngpio`, 'utf8').trim(), 10);
        if (Number.isFinite(n)) out.lines = n;
      } catch { /* optional */ }
      return out;
    });
  } catch {
    return [];
  }
}

function scanGpio() {
  const info = platform.getPlatformInfo();
  if (!info.capabilities.gpio && !config.GPIO_STUB) {
    return {
      available: false,
      reason: 'No GPIO controller present on this host',
      mock: !!config.GPIO_STUB,
      pins: [],
    };
  }
  const chips = listGpioChips();

  // On a Raspberry Pi (or in stub mode) we render the BCM 2-27 picker the
  // actuator dialog depends on. On other libgpiod hosts we surface the chip
  // list informationally — pin assignment UI is Pi-specific in v1.
  if (info.is_raspberry_pi || config.GPIO_STUB) {
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
    return { available: true, mock: !!config.GPIO_STUB, pins, chips };
  }

  return {
    available: true,
    mock: false,
    pins: [],
    chips,
    reason: 'GPIO controller detected — pin assignment UI is Raspberry-Pi specific in v1.',
  };
}

// ---------------- USB ----------------

function readSysfsFile(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); }
  catch { return null; }
}

function decodeClass(code) {
  if (code == null) return null;
  return USB_CLASS_LABELS[code] || `Class 0x${code.toString(16).padStart(2, '0')}`;
}

function scanUsbLinux() {
  const root = '/sys/bus/usb/devices';
  let entries;
  try { entries = fs.readdirSync(root); }
  catch (err) {
    return { available: false, reason: err.message || 'sysfs USB unavailable', source: null, devices: [] };
  }

  // Filter rule: skip interface entries (contain ':') and root hubs (`usbN`).
  const targets = entries.filter((n) => !n.includes(':') && !/^usb\d+$/.test(n));

  const devices = [];
  for (const name of targets) {
    const dir = path.join(root, name);
    const vidStr = readSysfsFile(path.join(dir, 'idVendor'));
    const pidStr = readSysfsFile(path.join(dir, 'idProduct'));
    if (!vidStr || !pidStr) continue;
    const vid = parseInt(vidStr, 16);
    const pid = parseInt(pidStr, 16);
    if (!Number.isFinite(vid) || !Number.isFinite(pid)) continue;

    let classCode = parseInt(readSysfsFile(path.join(dir, 'bDeviceClass')) || '', 16);
    if (!Number.isFinite(classCode)) classCode = null;

    // Class 0x00 ("see interface descriptors") and 0xef (Misc / IAD
    // composite — common for UVC cameras and CDC ACM devices) both bury
    // the useful class in the interface descriptors. Walk them and pick
    // the first non-Hub class so the UI label is informative.
    if (classCode === 0x00 || classCode === 0xef) {
      try {
        const ifaces = fs.readdirSync(dir).filter((n) => n.startsWith(`${name}:`));
        for (const iface of ifaces) {
          const ic = parseInt(readSysfsFile(path.join(dir, iface, 'bInterfaceClass')) || '', 16);
          if (Number.isFinite(ic) && ic !== 0x09 && ic !== 0xef) { classCode = ic; break; }
        }
      } catch { /* leave as composite */ }
    }

    if (classCode === 0x09) continue; // skip hubs entirely

    devices.push({
      vid,
      pid,
      vid_hex: vidStr.toLowerCase(),
      pid_hex: pidStr.toLowerCase(),
      vendor_name: readSysfsFile(path.join(dir, 'manufacturer')),
      product_name: readSysfsFile(path.join(dir, 'product')),
      serial: readSysfsFile(path.join(dir, 'serial')),
      class_code: classCode,
      class_label: decodeClass(classCode) || 'USB Device',
      bus_path: name,
      speed: readSysfsFile(path.join(dir, 'speed')),
      is_hub: false,
    });
  }

  devices.sort((a, b) => a.bus_path.localeCompare(b.bus_path, undefined, { numeric: true }));

  const result = { available: true, source: 'sysfs', devices };
  const info = platform.getPlatformInfo();
  if (!info.capabilities.lsusb && devices.some((d) => !d.vendor_name)) {
    result.hint = 'Install usbutils for vendor/product names (apt install usbutils)';
  }
  return result;
}

function inferMacOsClass(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/(camera|webcam|isight|facetime)/.test(n)) return 0x0e;
  if (/(keyboard|mouse|trackpad|gamepad|controller|joystick)/.test(n)) return 0x03;
  if (/(disk|drive|storage|usb stick|ssd)/.test(n)) return 0x08;
  if (/(audio|microphone|speaker|headphone)/.test(n)) return 0x01;
  if (/(serial|uart|usb-to-serial|ftdi|cp210|ch340|arduino|esp32|esp8266)/.test(n)) return 0x02;
  if (/hub/.test(n)) return 0x09;
  return null;
}

function flattenSpItems(items, out) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item && typeof item === 'object') {
      if (item.vendor_id && item.product_id) out.push(item);
      if (Array.isArray(item._items)) flattenSpItems(item._items, out);
    }
  }
}

function scanUsbMacOS() {
  try {
    const out = spawnSync('system_profiler', ['SPUSBDataType', '-json'], {
      timeout: 8000, encoding: 'utf-8',
    });
    if (out.status !== 0) {
      return { available: false, reason: out.stderr?.trim() || 'system_profiler failed', source: null, devices: [] };
    }
    const parsed = JSON.parse(out.stdout || '{}');
    const flat = [];
    flattenSpItems(parsed?.SPUSBDataType || [], flat);

    const devices = [];
    for (const item of flat) {
      const vidMatch = /0x([0-9a-fA-F]{1,4})/.exec(item.vendor_id || '');
      const pidMatch = /0x([0-9a-fA-F]{1,4})/.exec(item.product_id || '');
      if (!vidMatch || !pidMatch) continue;
      const vid = parseInt(vidMatch[1], 16);
      const pid = parseInt(pidMatch[1], 16);
      const inferred = inferMacOsClass(item._name);
      if (inferred === 0x09) continue;
      devices.push({
        vid,
        pid,
        vid_hex: vidMatch[1].toLowerCase().padStart(4, '0'),
        pid_hex: pidMatch[1].toLowerCase().padStart(4, '0'),
        vendor_name: item.manufacturer || null,
        product_name: item._name || null,
        serial: item.serial_num || null,
        class_code: inferred,
        class_label: decodeClass(inferred) || 'USB Device',
        bus_path: item.location_id || null,
        speed: item.device_speed || null,
        is_hub: false,
      });
    }
    return { available: true, source: 'system_profiler', devices };
  } catch (err) {
    return { available: false, reason: err.message || 'system_profiler error', source: null, devices: [] };
  }
}

function scanUSB() {
  const info = platform.getPlatformInfo();
  if (info.kind === 'linux') {
    if (info.capabilities.sysfs_usb) return scanUsbLinux();
    return { available: false, reason: '/sys/bus/usb/devices missing', source: null, devices: [] };
  }
  if (info.kind === 'darwin') {
    if (info.capabilities.avfoundation) return scanUsbMacOS();
    return { available: false, reason: 'system_profiler not available', source: null, devices: [] };
  }
  return { available: false, reason: `USB enumeration not supported on ${info.kind}`, source: null, devices: [] };
}

// ---------------- Serial ----------------

function udevadmEnrich(devPath) {
  // Best-effort enrichment. Failure is silent — we always have at least
  // the path itself.
  try {
    const out = spawnSync('udevadm', ['info', '--query=property', `--name=${devPath}`], {
      timeout: 500, encoding: 'utf-8',
    });
    if (out.status !== 0) return {};
    const props = {};
    for (const line of (out.stdout || '').split('\n')) {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m) props[m[1]] = m[2];
    }
    return {
      vid_hex: props.ID_VENDOR_ID || null,
      pid_hex: props.ID_MODEL_ID || null,
      vendor_name: props.ID_VENDOR ? props.ID_VENDOR.replace(/_/g, ' ') : null,
      product_name: props.ID_MODEL ? props.ID_MODEL.replace(/_/g, ' ') : null,
      serial: props.ID_SERIAL_SHORT || null,
      driver: props.ID_USB_DRIVER || null,
    };
  } catch {
    return {};
  }
}

function scanSerialLinux() {
  let entries;
  try { entries = fs.readdirSync('/dev'); }
  catch (err) {
    return { available: false, reason: err.message, ports: [] };
  }
  const matches = entries.filter((n) => /^tty(USB|ACM)\d+$/.test(n)).sort();
  const info = platform.getPlatformInfo();
  const enrich = info.capabilities.udevadm;
  const ports = matches.map((n) => {
    const devPath = `/dev/${n}`;
    const base = { path: devPath, vid_hex: null, pid_hex: null, vendor_name: null, product_name: null, serial: null, driver: null };
    return enrich ? { ...base, ...udevadmEnrich(devPath) } : base;
  });
  return { available: true, ports };
}

function scanSerialMacOS() {
  let entries;
  try { entries = fs.readdirSync('/dev'); }
  catch (err) {
    return { available: false, reason: err.message, ports: [] };
  }
  // Skip /dev/cu.* — same hardware as /dev/tty.* exposed as callout. One row
  // per physical port is plenty.
  const matches = entries
    .filter((n) => /^tty\.(usb|wchusb|usbserial|usbmodem)/i.test(n))
    .sort()
    .map((n) => `/dev/${n}`);
  const ports = matches.map((p) => ({
    path: p, vid_hex: null, pid_hex: null, vendor_name: null, product_name: null, serial: null, driver: null,
  }));
  return { available: true, ports };
}

function scanSerial() {
  const info = platform.getPlatformInfo();
  if (info.kind === 'linux') return scanSerialLinux();
  if (info.kind === 'darwin') return scanSerialMacOS();
  return { available: false, reason: `Serial enumeration not supported on ${info.kind}`, ports: [] };
}

// ---------------- Combined ----------------

function scanAll() {
  return {
    timestamp: new Date().toISOString(),
    stub: !!config.GPIO_STUB,
    platform: platform.getPlatformInfo(),
    i2c: scanI2C(),
    sensors: scanSensors(),
    video: scanVideo(),
    gpio: scanGpio(),
    usb: scanUSB(),
    serial: scanSerial(),
  };
}

module.exports = {
  scanAll,
  scanI2C,
  scan1Wire,
  scanSensors,
  scanVideo,
  scanGpio,
  scanUSB,
  scanSerial,
  RESERVED_PINS,
  ALL_GPIO_PINS,
};
