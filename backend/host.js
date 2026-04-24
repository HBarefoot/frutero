const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

// Read the Pi SoC temperature. On Bookworm, /sys/class/thermal/thermal_zone0
// reports the CPU temp in millidegrees C. Fallback to vcgencmd for older
// firmware or non-thermal-framework kernels. Returns null on non-Pi hosts.
function cpuTempC() {
  try {
    const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return n / 1000;
  } catch { /* fall through */ }
  try {
    // vcgencmd output is like "temp=45.3'C"
    const out = execSync('vcgencmd measure_temp', { encoding: 'utf8', timeout: 500 });
    const m = /temp=([\d.]+)/.exec(out);
    return m ? parseFloat(m[1]) : null;
  } catch {
    return null;
  }
}

// SoC throttling and undervoltage flags. Bit 0 = undervolt now, bit 1 =
// freq cap now, bit 2 = throttle now, bit 3 = temp limit now (rest are
// "has occurred since boot"). A healthy Pi reports 0x0; anything non-zero
// warrants a card-level warning.
function throttledFlags() {
  try {
    const out = execSync('vcgencmd get_throttled', { encoding: 'utf8', timeout: 500 });
    const m = /throttled=0x([0-9a-f]+)/i.exec(out);
    if (!m) return null;
    const raw = parseInt(m[1], 16);
    return {
      raw: `0x${m[1]}`,
      undervoltage: !!(raw & 0x1),
      freq_capped: !!(raw & 0x2),
      throttled_now: !!(raw & 0x4),
      temp_limit_now: !!(raw & 0x8),
      undervoltage_past: !!(raw & 0x10000),
      freq_capped_past: !!(raw & 0x20000),
      throttled_past: !!(raw & 0x40000),
      temp_limit_past: !!(raw & 0x80000),
    };
  } catch {
    return null;
  }
}

function diskUsage(mount = '/') {
  try {
    // df -B1 <mount> → "Filesystem 1B-blocks Used Available Use% Mounted"
    const out = execSync(`df -B1 ${mount}`, { encoding: 'utf8', timeout: 1000 });
    const lines = out.trim().split('\n');
    if (lines.length < 2) return null;
    const cols = lines[1].split(/\s+/);
    const total = parseInt(cols[1], 10);
    const used = parseInt(cols[2], 10);
    const avail = parseInt(cols[3], 10);
    if (!Number.isFinite(total) || !Number.isFinite(used)) return null;
    return { total_bytes: total, used_bytes: used, avail_bytes: avail };
  } catch {
    return null;
  }
}

function piModel() {
  try {
    const raw = fs.readFileSync('/sys/firmware/devicetree/base/model', 'utf8');
    return raw.replace(/\0/g, '').trim();
  } catch {
    return null;
  }
}

function kernelRelease() {
  return os.release();
}

function getHostStats() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  const loads = os.loadavg(); // [1m, 5m, 15m]
  const cpuCount = os.cpus().length;

  return {
    pi_model: piModel(),
    kernel: kernelRelease(),
    arch: os.arch(),
    uptime_seconds: Math.floor(os.uptime()),
    hostname: os.hostname(),

    cpu: {
      count: cpuCount,
      load_1m: loads[0],
      load_5m: loads[1],
      load_15m: loads[2],
      // Load average over 1m as a 0..1 ratio of available cores. Useful
      // for a single bar visualization.
      load_pct_1m: cpuCount > 0 ? Math.min(1, loads[0] / cpuCount) : null,
      temp_c: cpuTempC(),
      throttled: throttledFlags(),
    },

    memory: {
      total_bytes: total,
      used_bytes: used,
      free_bytes: free,
      used_pct: total > 0 ? used / total : null,
    },

    disk_root: diskUsage('/'),

    timestamp: new Date().toISOString(),
  };
}

module.exports = { getHostStats };
