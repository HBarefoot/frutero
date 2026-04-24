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

const fs = require('node:fs');
const path = require('node:path');
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

    // M4: pick up any pending owner-issued commands the cloud attached
    // to this heartbeat response. Best-effort — failures are logged
    // and reported back as command results, never thrown out of the
    // heartbeat loop.
    let pending = [];
    try {
      const body = await res.json();
      if (Array.isArray(body?.pending_commands)) pending = body.pending_commands;
    } catch {
      // server returned non-JSON; skip command processing.
    }
    if (pending.length > 0) {
      const results = await dispatchCommands(pending);
      await postCommandResults(conn, results);
    }

    return { ok: true, commands_processed: pending.length };
  } catch (err) {
    lastStatus = null;
    lastError = err.name === 'AbortError' ? 'timeout' : err.message || 'network_error';
    return { ok: false, error: lastError };
  } finally {
    clearTimeout(t);
    inFlight = false;
  }
}

// Dispatch a single command against the local Pi. Each handler returns
// {status:'completed'|'failed', result?, error?}. Throws are caught and
// surfaced as 'failed' rather than crashing the heartbeat loop.
async function dispatchOne(cmd) {
  try {
    if (cmd.kind === 'set_actuator') {
      const { key, on } = cmd.args || {};
      if (typeof key !== 'string' || typeof on !== 'boolean') {
        return { status: 'failed', error: 'invalid args' };
      }
      gpio.setActuator(key, on, 'fleet', null);
      return { status: 'completed', result: { key, on, state: gpio.getState(key) } };
    }
    if (cmd.kind === 'pulse_actuator') {
      const { key, ms } = cmd.args || {};
      if (typeof key !== 'string' || !Number.isInteger(ms)) {
        return { status: 'failed', error: 'invalid args' };
      }
      await gpio.pulse(key, ms, null);
      return { status: 'completed', result: { key, ms } };
    }
    if (cmd.kind === 'take_snapshot') {
      return await takeAndUploadSnapshot();
    }
    return { status: 'failed', error: `unknown kind: ${cmd.kind}` };
  } catch (err) {
    if (err?.code === 'SAFETY_BLOCKED') {
      return { status: 'failed', error: `safety_blocked: ${err.message}` };
    }
    return { status: 'failed', error: err?.message || 'dispatch_error' };
  }
}

async function dispatchCommands(pending) {
  const out = [];
  for (const cmd of pending) {
    const r = await dispatchOne(cmd);
    db.Q.insertAudit({
      user_id: null,
      action: `fleet.command.${r.status}`,
      target: `cmd:${cmd.id}`,
      detail: { kind: cmd.kind, args: cmd.args, error: r.error || null },
      ip: null,
    });
    out.push({ id: cmd.id, ...r });
  }
  return out;
}

// Reads a freshly-captured CV snapshot from disk and POSTs it to the
// cloud's /api/devices/snapshot endpoint. Lazy-required so the heartbeat
// loop has no compile-time dep on the CV pipeline (cycles aside, this
// keeps boot time tight when fleet isn't enrolled).
async function takeAndUploadSnapshot() {
  let cvCapture;
  try {
    cvCapture = require('./cv/capture');
  } catch (err) {
    return { status: 'failed', error: `cv module unavailable: ${err.message}` };
  }

  const captured = await cvCapture.capture({ trigger: 'fleet' });
  if (!captured?.ok || !captured?.path) {
    return { status: 'failed', error: captured?.error || 'capture_failed' };
  }
  // .svg = stub placeholder when the camera isn't plugged in. Don't
  // ship those — the cloud's mime allowlist would reject and the
  // operator would be misled into thinking the chamber has a camera.
  if (captured.path.endsWith('.svg')) {
    return { status: 'failed', error: 'no_camera (stub placeholder, not uploaded)' };
  }

  let buf;
  try { buf = fs.readFileSync(captured.path); }
  catch (err) { return { status: 'failed', error: `read_failed: ${err.message}` }; }

  const mime = mimeForPath(captured.path);
  const conn = getConnection();
  const url = `${conn.url.replace(/\/+$/, '')}/api/devices/snapshot`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30 * 1000); // 30s — uploads can be slow on flaky LTE
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conn.jwt}`,
      },
      body: JSON.stringify({
        mime,
        image_b64: buf.toString('base64'),
        captured_at: nowSqliteUtc(),
        source: 'cv',
        source_id: captured.snapshot_id || null,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await safeJson(res);
      return { status: 'failed', error: `upload_${res.status}: ${detail?.error || ''}` };
    }
    const body = await safeJson(res);
    return {
      status: 'completed',
      result: {
        cloud_snapshot_id: body?.snapshot_id || null,
        local_snapshot_id: captured.snapshot_id || null,
        size: buf.length,
      },
    };
  } catch (err) {
    return {
      status: 'failed',
      error: err.name === 'AbortError' ? 'upload_timeout' : (err.message || 'upload_error'),
    };
  } finally {
    clearTimeout(t);
  }
}

function mimeForPath(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function nowSqliteUtc() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function postCommandResults(conn, results) {
  if (results.length === 0) return;
  const url = `${conn.url.replace(/\/+$/, '')}/api/devices/command-results`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${conn.jwt}`,
      },
      body: JSON.stringify({ results }),
      signal: ctrl.signal,
    });
  } catch (err) {
    console.warn('[fleet] command-results POST failed:', err.message);
    // Cloud will keep the rows in 'sent' state. The next heartbeat won't
    // re-deliver them (they're not pending), but the operator can see
    // 'sent' as a stuck-state hint. Future hardening: timestamp-based
    // re-issue on the cloud side. Out of scope for M4 v1.
  } finally {
    clearTimeout(t);
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

  // Default-on the cloud notify channel for first-time enrollments so
  // alerts start flowing to the cloud inbox immediately. We only flip
  // the bit when the operator hasn't expressed a preference yet —
  // re-enrollment after a deliberate disable preserves that choice.
  const settings = db.Q.getAllSettings();
  if (settings.notify_cloud_enabled === undefined) {
    db.Q.setSetting('notify_cloud_enabled', '1');
  }

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
