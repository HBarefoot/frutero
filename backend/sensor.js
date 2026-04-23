const config = require('./config');
const ws = require('./ws');
const { Q } = require('./database');

let alerts = null; // set lazily to avoid circular require
let realSensor = null;
let intervalHandle = null;
const latest = { temperature: null, humidity: null, simulated: true, timestamp: null };

function setAlerts(mod) {
  alerts = mod;
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

function tick() {
  let reading;
  if (config.SENSOR_AVAILABLE) {
    reading = readReal();
    if (!reading) {
      // Retry once, then drop this tick rather than writing a bad reading.
      reading = readReal();
    }
    if (!reading) return;
  } else {
    reading = readStub();
  }

  const timestamp = new Date().toISOString();
  Object.assign(latest, reading, { timestamp });

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
}

function start() {
  // Prime immediately so the first client doesn't see null.
  tick();
  intervalHandle = setInterval(tick, config.SENSOR_READ_INTERVAL * 1000);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function getLatest() {
  return { ...latest };
}

module.exports = { start, stop, getLatest, setAlerts };
