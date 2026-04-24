// Outbound fleet agent. The Pi posts a state snapshot to the cloud
// control plane every HEARTBEAT_INTERVAL_MS. The cloud never connects
// inbound — this keeps the appliance behind any NAT / firewall.
//
// Secrets keys (all in the secrets table, not env):
//   - fleet_url           : cloud base URL, e.g. https://fleet.example.com
//   - fleet_jwt           : long-lived device JWT (HS256)
//   - fleet_chamber_id    : numeric id assigned at enrollment
//   - fleet_name          : human label echoed at enrollment time
//
// The JWT is invalidated by the cloud when the chamber is archived
// there; we detect this on the next heartbeat (401) and disconnect
// locally so the operator can re-enroll.

const db = require('./database');
const sensor = require('./sensor');
const gpio = require('./gpio');
const host = require('./host');
const batches = require('./batches');

const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

let timer = null;
let lastHeartbeatAt = null;
let lastError = null;
let lastStatus = null;
let inFlight = false;

function getConnection() {
  return {
    url: db.Q.getSecret('fleet_url'),
    jwt: db.Q.getSecret('fleet_jwt'),
    chamber_id: db.Q.getSecret('fleet_chamber_id'),
    name: db.Q.getSecret('fleet_name'),
  };
}

function isConnected() {
  const c = getConnection();
  return !!(c.url && c.jwt && c.chamber_id);
}

function getStatus() {
  const c = getConnection();
  return {
    connected: !!(c.url && c.jwt && c.chamber_id),
    url: c.url || null,
    chamber_id: c.chamber_id ? Number(c.chamber_id) : null,
    name: c.name || null,
    last_heartbeat_at: lastHeartbeatAt,
    last_status: lastStatus,
    last_error: lastError,
    interval_seconds: HEARTBEAT_INTERVAL_MS / 1000,
  };
}

function buildHardwareInfo() {
  const stats = safeCall(() => host.getHostStats(), {});
  return {
    pi_model: stats.pi_model || null,
    kernel: stats.kernel_release || null,
    node_version: process.version,
  };
}

function buildSnapshot() {
  const reading = safeCall(() => sensor.getLatest(), {});
  const health = safeCall(() => sensor.getHealth(), {});
  const actuatorState = {};
  try {
    for (const a of gpio.listActuators()) {
      actuatorState[a.key] = {
        on: !!a.state,
        kind: a.kind,
      };
    }
  } catch {
    // ignore — actuator listing failure shouldn't break heartbeat.
  }

  const stats = safeCall(() => host.getHostStats(), {});

  let activeBatch = null;
  try {
    const id = batches.getActiveBatchId();
    if (id) {
      const row = db.Q.findBatch(id);
      if (row) {
        const startedMs = row.started_at ? Date.parse(row.started_at.replace(' ', 'T') + 'Z') : null;
        activeBatch = {
          id: row.id,
          name: row.name,
          species_key: row.species_key,
          phase: row.phase,
          days_elapsed: startedMs ? Math.floor((Date.now() - startedMs) / 86400000) : null,
        };
      }
    }
  } catch {
    // ignore — missing batch context shouldn't break heartbeat.
  }

  return {
    sent_at: new Date().toISOString(),
    sensor: {
      temp_f: reading.temp_f ?? null,
      humidity: reading.humidity ?? null,
      simulated: !!reading.simulated,
      reading_age_seconds: health.silent_seconds ?? null,
      ok: health.ok ?? null,
    },
    actuators: actuatorState,
    active_batch: activeBatch,
    host: {
      cpu_temp_c: stats.cpu_temp_c ?? null,
      load_avg: stats.load_avg ?? null,
      ram_pct: stats.ram_pct ?? null,
      disk_pct: stats.disk_pct ?? null,
      throttled: stats.throttled || null,
      uptime_seconds: stats.uptime_seconds ?? null,
    },
  };
}

async function sendOnce() {
  if (inFlight) return { skipped: 'in_flight' };
  if (!isConnected()) return { skipped: 'not_connected' };
  inFlight = true;
  const conn = getConnection();
  const url = `${conn.url.replace(/\/+$/, '')}/api/devices/heartbeat`;
  const snapshot = buildSnapshot();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conn.jwt}`,
      },
      body: JSON.stringify(snapshot),
      signal: ctrl.signal,
    });
    lastStatus = res.status;
    if (res.status === 401) {
      // Cloud revoked us (chamber archived or signing key rotated).
      // Clear local state so the UI prompts for re-enrollment.
      const detail = await safeJson(res);
      console.warn('[fleet] heartbeat 401, disconnecting:', detail);
      clearConnection();
      lastError = 'revoked_by_cloud';
      return { ok: false, status: 401 };
    }
    if (!res.ok) {
      lastError = `http_${res.status}`;
      return { ok: false, status: res.status };
    }
    lastError = null;
    lastHeartbeatAt = new Date().toISOString();
    return { ok: true };
  } catch (err) {
    lastStatus = null;
    lastError = err.name === 'AbortError' ? 'timeout' : err.message || 'network_error';
    return { ok: false, error: lastError };
  } finally {
    clearTimeout(t);
    inFlight = false;
  }
}

function start() {
  if (timer) return;
  if (!isConnected()) return;
  // Prime with an immediate heartbeat so the cloud sees us within seconds
  // of process boot rather than a full interval later.
  sendOnce().catch(() => {});
  timer = setInterval(() => { sendOnce().catch(() => {}); }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function clearConnection() {
  db.Q.deleteSecret('fleet_jwt');
  db.Q.deleteSecret('fleet_chamber_id');
  db.Q.deleteSecret('fleet_name');
  // Keep fleet_url around as a UX convenience — the operator usually
  // re-enrolls against the same cloud instance.
  stop();
}

async function enroll({ url, code, name }) {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  const cleanCode = String(code || '').trim();
  const cleanName = String(name || '').trim() || 'Chamber';
  if (!/^https?:\/\/.+/i.test(cleanUrl)) {
    const err = new Error('invalid_url');
    err.code = 'invalid_url';
    throw err;
  }
  if (!cleanCode) {
    const err = new Error('missing_code');
    err.code = 'missing_code';
    throw err;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${cleanUrl}/api/devices/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: cleanCode,
        name: cleanName,
        hardware_info: buildHardwareInfo(),
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    const e = new Error(err.name === 'AbortError' ? 'timeout' : err.message);
    e.code = 'network_error';
    throw e;
  } finally {
    clearTimeout(t);
  }

  const body = await safeJson(res);
  if (!res.ok) {
    const e = new Error(body?.error || `http_${res.status}`);
    e.code = body?.error || `http_${res.status}`;
    e.status = res.status;
    throw e;
  }
  if (!body?.jwt || !body?.chamber_id) {
    const e = new Error('malformed_response');
    e.code = 'malformed_response';
    throw e;
  }

  db.Q.setSecret('fleet_url', cleanUrl);
  db.Q.setSecret('fleet_jwt', body.jwt);
  db.Q.setSecret('fleet_chamber_id', String(body.chamber_id));
  db.Q.setSecret('fleet_name', body.name || cleanName);
  lastError = null;
  lastHeartbeatAt = null;
  start();
  return { chamber_id: body.chamber_id, name: body.name || cleanName };
}

function disconnect() {
  clearConnection();
}

function safeCall(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

module.exports = {
  start,
  stop,
  enroll,
  disconnect,
  sendOnce,
  getStatus,
  isConnected,
  buildSnapshot,   // exported for diagnostics / tests
  HEARTBEAT_INTERVAL_MS,
};
