const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Capability detection runs once at startup and is memoized for the
// process lifetime. Capability install (apt install i2c-tools) requires
// a service restart to surface — that's the right granularity. Device
// scans (scanUSB, scanVideo) are NOT memoized; they pick up hot-plugs
// on every Rescan.

let cached = null;

function which(bin) {
  const PATH = process.env.PATH || '';
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, bin);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch { /* not here */ }
  }
  return null;
}

function readModelString() {
  // /sys/firmware/devicetree/base/model is a NUL-terminated string on Pi
  // (and many other ARM SBCs). On non-DT hosts it's missing; fall back to
  // a synthesized "<type> <release>" string so the UI always has something.
  try {
    const raw = fs.readFileSync('/sys/firmware/devicetree/base/model', 'utf8');
    const cleaned = raw.replace(/\0/g, '').trim();
    if (cleaned) return cleaned;
  } catch { /* fall through */ }
  return `${os.type()} ${os.release()}`;
}

function readDistro() {
  try {
    const raw = fs.readFileSync('/etc/os-release', 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      out[key] = val;
    }
    if (!out.id) return null;
    return { id: out.id, version_id: out.version_id || null };
  } catch {
    return null;
  }
}

function dirHas(dir, predicate) {
  try {
    const entries = fs.readdirSync(dir);
    return entries.some(predicate);
  } catch {
    return false;
  }
}

function detectCapabilities(kind) {
  const caps = {
    gpio: false,
    i2c: false,
    one_wire: false,
    v4l2: false,
    avfoundation: false,
    sysfs_usb: false,
    lsusb: false,
    udevadm: false,
    vcgencmd: false,
  };

  if (kind === 'linux') {
    caps.gpio = dirHas('/dev', (n) => /^gpiochip\d+$/.test(n));
    caps.i2c = dirHas('/dev', (n) => /^i2c-\d+$/.test(n)) && !!which('i2cdetect');
    caps.one_wire = fs.existsSync('/sys/bus/w1/devices');
    caps.v4l2 = dirHas('/dev', (n) => /^video\d+$/.test(n)) && !!which('v4l2-ctl');
    caps.sysfs_usb = fs.existsSync('/sys/bus/usb/devices');
    caps.lsusb = !!which('lsusb');
    caps.udevadm = !!which('udevadm');
    caps.vcgencmd = !!which('vcgencmd');
  } else if (kind === 'darwin') {
    caps.avfoundation = !!which('system_profiler');
  }

  return caps;
}

function isRaspberryPi() {
  return getPlatformInfo().is_raspberry_pi;
}

function getPlatformInfo() {
  if (cached) return cached;
  const kind = os.platform(); // 'linux' | 'darwin' | 'win32' | ...
  const supported = kind === 'linux' || kind === 'darwin';
  const model_string = readModelString();
  const is_raspberry_pi = /Raspberry Pi/i.test(model_string);
  cached = {
    kind,
    arch: os.arch(),
    supported,
    is_raspberry_pi,
    model_string,
    distro: kind === 'linux' ? readDistro() : null,
    capabilities: detectCapabilities(kind),
  };
  return cached;
}

// Test-only — lets unit tests re-detect after monkey-patching fs.
function _resetCache() {
  cached = null;
}

module.exports = { getPlatformInfo, isRaspberryPi, which, _resetCache };
