const config = require('./config');
const ws = require('./ws');
const { Q } = require('./database');

let alerts = null;       // set lazily to avoid circular require
let automations = null;  // set lazily for the same reason
let realSensor = null;
let intervalHandle = null;
let watchdogHandle = null;
const latest = { temperature: null, humidity: null, simulated: true, timestamp: null };

// Separate from `latest.timestamp` — survives failed reads. Used to
// compute how long we've been without a real value and drive the
// silence watchdog + mister-automation safety gate.
let lastSuccessAt = 0;

// If the last good reading is this old AND the sensor isn't stubbed,
// we're "silent". Below this, stay quiet; above, fire the alert.
const SILENCE_THRESHOLD_SEC = 10 * 60;

function setAlerts(mod) {
  alerts = mod;
}

function setAutomations(mod) {
  automations = mod;
}

function cToF(c) {
  return (c * 9) / 5 + 32;
}

function readStub() {
  // Small deterministic variation around baseline so charts are readable.
  const t = 72 + Math.sin(Date.now() / 600000) * 1.5;
  const h = 85 + Math.cos(Date.now() / 450000) * 2.5;
  return { temperature: round1(t), humidity: round1(h), simulated: true };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function loadRealSensor() {
  if (realSensor) return realSensor;
  try {
    realSensor = require('node-dht-sensor');
  } catch (err) {
    console.error(
      '[sensor] node-dht-sensor failed to load. Keeping stub data. Install it or consider pigpio fallback.',
      err.message
    );
    return null;
  }
  return realSensor;
}

function readReal() {
  const lib = loadRealSensor();
  if (!lib) return null;
  try {
    const out = lib.read(22, config.DHT22_PIN);
    const temperatureF = cToF(out.temperature);
    const humidity = out.humidity;
    if (
      !Number.isFinite(temperatureF) ||
      !Number.isFinite(humidity) ||
      temperatureF < 32 ||
      temperatureF > 120 ||
      humidity < 0 ||
      humidity > 100
    ) {
      return null;
    }
    return { temperature: round1(temperatureF), humidity: round1(humidity), simulated: false };
  } catch (err) {
    console.error('[sensor] read failed:', err.message);
    return null;
  }
}

// DHT22 requires ~2s between reads — retrying immediately produces the same
// failure. Wait before the second attempt, then give up for this tick.
const DHT_RETRY_DELAY_MS = 2100;

async function tick() {
  let reading;
  if (config.SENSOR_AVAILABLE) {
    reading = readReal();
    if (!reading) {
      await new Promise((r) => setTimeout(r, DHT_RETRY_DELAY_MS));
      reading = readReal();
    }
    if (!reading) return;
  } else {
    reading = readStub();
  }

  const timestamp = new Date().toISOString();
  Object.assign(latest, reading, { timestamp });
  lastSuccessAt = Date.now();

  try {
    Q.insertReading(reading.temperature, reading.humidity, reading.simulated);
  } catch (err) {
    console.error('[sensor] db insert failed:', err);
  }

  ws.broadcast({
    type: 'sensor_reading',
    data: { ...reading, timestamp },
  });

  if (alerts) {
    try {
      alerts.check(reading);
    } catch (err) {
      console.error('[sensor] alerts.check error:', err);
    }
  }

  if (automations) {
    try {
      automations.onSensorReading(reading);
    } catch (err) {
      console.error('[sensor] automations.onSensorReading error:', err);
    }
  }
}

function start() {
  // Prime immediately so the first client doesn't see null. The stub
  // path always succeeds so lastSuccessAt is set on first tick; real
  // hardware may need a retry loop (DHT_RETRY_DELAY_MS above).
  tick();
  intervalHandle = setInterval(tick, config.SENSOR_READ_INTERVAL * 1000);
  // Separate watchdog — runs every minute regardless of read cadence.
  watchdogHandle = setInterval(checkSilence, 60 * 1000);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (watchdogHandle) {
    clearInterval(watchdogHandle);
    watchdogHandle = null;
  }
}

function getLatest() {
  return { ...latest };
}

// Health snapshot surfaced to status/security endpoints + automation
// safety gate. `silent_seconds` is only meaningful once we've had at
// least one successful read (otherwise lastSuccessAt=0 would report
// "silent since epoch").
function getHealth() {
  const hasRead = lastSuccessAt > 0;
  const silentSeconds = hasRead ? Math.floor((Date.now() - lastSuccessAt) / 1000) : null;
  const silent = !latest.simulated && hasRead && silentSeconds >= SILENCE_THRESHOLD_SEC;
  return {
    ok: !silent,
    simulated: !!latest.simulated,
    last_success_at: hasRead ? new Date(lastSuccessAt).toISOString() : null,
    silent_seconds: silentSeconds,
    silence_threshold_seconds: SILENCE_THRESHOLD_SEC,
    silent,
  };
}

function checkSilence() {
  // Nothing to check if we've never seen a reading, or if we're in stub
  // mode (stub doesn't fail).
  if (lastSuccessAt === 0) return;
  if (latest.simulated) return;

  const silentSeconds = Math.floor((Date.now() - lastSuccessAt) / 1000);
  if (silentSeconds < SILENCE_THRESHOLD_SEC) return;

  if (alerts && typeof alerts.fireSilence === 'function') {
    try {
      alerts.fireSilence(silentSeconds);
    } catch (err) {
      console.error('[sensor] fireSilence failed:', err);
    }
  }
  // Broadcast a sensor_health update so the dashboard can render the
  // warning banner immediately instead of waiting for next poll.
  try {
    ws.broadcast({ type: 'sensor_health', data: getHealth() });
  } catch { /* non-fatal */ }
}

module.exports = { start, stop, getLatest, getHealth, setAlerts, setAutomations };
