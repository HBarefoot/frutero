const { Q } = require('./database');
const gpio = require('./gpio');
const sensor = require('./sensor');

// Per-actuator debounce so we don't re-fire a humidity-driven mist every
// sensor tick while humidity is below threshold.
const lastFireAt = new Map();
const RECHECK_MS = 60 * 1000;

// Settings keys (all strings in the settings table):
//   mister_automation_enabled  '1' | '0'
//   mister_actuator_key         actuator key, default 'mister'
//   mister_humidity_threshold   percent, fire when humidity < this
//   mister_pulse_seconds        on-time per fire (subject to actuator safety)

function settings() {
  const all = Q.getAllSettings();
  return {
    enabled: all.mister_automation_enabled === '1',
    key: (all.mister_actuator_key || 'mister').trim(),
    threshold: parseFloat(all.mister_humidity_threshold),
    pulseSec: parseInt(all.mister_pulse_seconds, 10) || 10,
  };
}

function onSensorReading(reading) {
  if (!reading || reading.humidity == null) return;
  const cfg = settings();
  if (!cfg.enabled) return;
  if (!gpio.hasActuator(cfg.key)) return;
  if (gpio.isManualOverride(cfg.key)) return;
  if (!Number.isFinite(cfg.threshold) || cfg.threshold <= 0 || cfg.threshold > 100) return;
  if (reading.humidity >= cfg.threshold) return;

  // Belt-and-braces: if the sensor has stopped responding, never fire
  // the mister based on a stale reading. The watchdog in sensor.js
  // raises a silence alert separately; this guard just prevents the
  // atomizer from running while the operator investigates.
  const health = sensor.getHealth();
  if (health.silent) {
    console.log(`[automations] mister fire suppressed — sensor silent for ${health.silent_seconds}s`);
    return;
  }

  const last = lastFireAt.get(cfg.key) || 0;
  if (Date.now() - last < RECHECK_MS) return;

  try {
    gpio.setActuator(cfg.key, true, 'automation');
    lastFireAt.set(cfg.key, Date.now());
    setTimeout(() => {
      try {
        if (gpio.getState(cfg.key)) gpio.setActuator(cfg.key, false, 'automation');
      } catch (err) {
        console.error('[automations] mister off failed:', err);
      }
    }, Math.max(1, cfg.pulseSec) * 1000);
  } catch (err) {
    if (err.code === 'SAFETY_BLOCKED') {
      console.log(`[automations] mister fire skipped: ${err.message}`);
    } else {
      console.error('[automations] mister fire failed:', err);
    }
  }
}

function status() {
  const cfg = settings();
  const out = {
    mister: {
      ...cfg,
      actuator_present: gpio.hasActuator(cfg.key),
      last_fire_at: lastFireAt.get(cfg.key) || null,
    },
  };
  if (gpio.hasActuator(cfg.key)) {
    out.mister.safety_status = gpio.safetyStatus(cfg.key);
    out.mister.state = gpio.getState(cfg.key);
  }
  return out;
}

module.exports = { onSensorReading, status };
