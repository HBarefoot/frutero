const config = require('./config');
const ws = require('./ws');
const { Q } = require('./database');

// Low-level trigger relay module:
//   Pin LOW (0)  → coil energized → NO contact closed, NC contact open
//   Pin HIGH (1) → coil de-energized → NO contact open, NC contact closed
//
// With NO wiring (inverted=false) device is ON when coil is energized
// (pin LOW). With NC wiring (inverted=true) device is ON when coil is
// de-energized (pin HIGH). All polarity handling is isolated here; the rest
// of the codebase uses boolean on/off semantics keyed by actuator key.
const HIGH = 1;
const LOW = 0;

let gpiox = null;
let MOCK = false;

// In-memory mirror of the actuators table, keyed by actuator key.
// { key: { pin, inverted, kind, name, enabled, auto_off_seconds, config } }
const actuators = new Map();
const state = new Map();           // key → bool
const manualOverride = new Map();  // key → bool
const pulseTimers = new Map();     // key → Timeout (click-to-test auto-off)

// Safety bookkeeping (per actuator key)
const lastOffAt = new Map();        // ms timestamp of most recent off transition
const currentOnAt = new Map();      // ms timestamp of most recent on transition
const dailyOn = new Map();          // { date: 'YYYY-MM-DD', seconds: number }
const safetyOffTimers = new Map();  // forced max-on auto-off

class SafetyError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'SafetyError';
    this.code = 'SAFETY_BLOCKED';
  }
}

function levelFor(on, inverted) {
  // Device ON when (pin LOW and NO wiring) or (pin HIGH and NC wiring).
  return on === !inverted ? LOW : HIGH;
}

function loadLib() {
  try {
    gpiox = require('@iiot2k/gpiox');
  } catch (err) {
    MOCK = true;
    console.warn(
      '[gpio] @iiot2k/gpiox not available — running in MOCK mode. Relays will NOT actually switch.',
      err.message
    );
  }
}

function openPin(key, pin, inverted) {
  if (MOCK) return;
  const offLevel = levelFor(false, inverted);
  const ok = gpiox.init_gpio(pin, gpiox.GPIO_MODE_OUTPUT, offLevel);
  if (!ok) {
    throw new Error(`[gpio] init pin ${pin} (${key}) failed: ${gpiox.error_text()}`);
  }
  if (inverted) {
    console.log(`[gpio] ${key} polarity INVERTED (NC wiring): pin HIGH=OFF via energized coil→open NC`);
  }
}

function closePin(pin, inverted) {
  if (MOCK || !gpiox) return;
  try {
    gpiox.set_gpio(pin, levelFor(false, inverted));
    gpiox.deinit_gpio(pin);
  } catch (err) {
    console.error(`[gpio] closePin ${pin} error:`, err);
  }
}

function init() {
  if (config.GPIO_STUB) {
    MOCK = true;
    console.log('[gpio] GPIO_STUB=true — MOCK mode, relays will NOT switch');
  } else {
    loadLib();
  }
  reloadActuators();
}

// Reads the actuators table, opens any pins that aren't already open, closes
// pins for actuators that vanished, and refreshes in-memory metadata. Safe
// to call repeatedly (e.g. after add/edit/delete).
function reloadActuators() {
  const rows = Q.listActuators();
  const seen = new Set();

  for (const row of rows) {
    seen.add(row.key);
    const existing = actuators.get(row.key);
    const meta = {
      pin: row.gpio_pin,
      inverted: !!row.inverted,
      kind: row.kind,
      name: row.name,
      enabled: !!row.enabled,
      auto_off_seconds: row.auto_off_seconds,
      config: row.config ? safeParse(row.config) : null,
    };

    if (!existing) {
      openPin(row.key, meta.pin, meta.inverted);
      actuators.set(row.key, meta);
      state.set(row.key, false);
      manualOverride.set(row.key, false);
    } else if (existing.pin !== meta.pin || existing.inverted !== meta.inverted) {
      // Pin reassignment: close old, open new, reset state.
      closePin(existing.pin, existing.inverted);
      openPin(row.key, meta.pin, meta.inverted);
      state.set(row.key, false);
      actuators.set(row.key, meta);
    } else {
      actuators.set(row.key, meta);
    }
  }

  // Close pins for actuators that were removed.
  for (const key of [...actuators.keys()]) {
    if (!seen.has(key)) {
      const meta = actuators.get(key);
      closePin(meta.pin, meta.inverted);
      actuators.delete(key);
      state.delete(key);
      manualOverride.delete(key);
      lastOffAt.delete(key);
      currentOnAt.delete(key);
      dailyOn.delete(key);
      const t = pulseTimers.get(key);
      if (t) { clearTimeout(t); pulseTimers.delete(key); }
      clearSafetyOff(key);
    }
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function writePin(key, on) {
  if (MOCK) return;
  const meta = actuators.get(key);
  if (!meta) throw new Error(`[gpio] unknown actuator '${key}'`);
  const level = levelFor(on, meta.inverted);
  const ok = gpiox.set_gpio(meta.pin, level);
  if (!ok) {
    throw new Error(`[gpio] set_gpio(${meta.pin}) failed: ${gpiox.error_text()}`);
  }
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function safetyConfig(key) {
  const meta = actuators.get(key);
  return meta?.config?.safety || null;
}

// Hard-stops a turn-on if any safety constraint would be violated. Returns
// null (ok) or a SafetyError ready to throw. Bypassable safety transitions
// (the safety auto-off itself) are handled by skipping this when on=false.
function checkSafety(key, wantOn) {
  if (!wantOn) return null;
  const safety = safetyConfig(key);
  if (!safety) return null;

  if (safety.min_off_seconds && lastOffAt.has(key)) {
    const elapsedSec = (Date.now() - lastOffAt.get(key)) / 1000;
    if (elapsedSec < safety.min_off_seconds) {
      const wait = Math.ceil(safety.min_off_seconds - elapsedSec);
      return new SafetyError(`min_off_seconds: must wait ${wait}s before next on`);
    }
  }

  if (safety.daily_max_seconds) {
    const today = dailyOn.get(key);
    const fresh = !today || today.date !== todayStr();
    const used = fresh ? 0 : today.seconds;
    if (used >= safety.daily_max_seconds) {
      return new SafetyError(`daily_max_seconds reached (${safety.daily_max_seconds}s used today)`);
    }
  }

  return null;
}

// Updates safety counters after a transition. Also arms the max-on auto-off.
function recordTransition(key, on, trigger) {
  const now = Date.now();
  const safety = safetyConfig(key);

  if (on) {
    currentOnAt.set(key, now);
    clearSafetyOff(key);
    if (safety?.max_on_seconds) {
      const t = setTimeout(() => {
        try {
          if (state.get(key)) {
            applyStateInternal(key, false, 'safety', null, true);
          }
        } catch (err) {
          console.error(`[gpio] safety auto-off ${key} failed:`, err);
        } finally {
          safetyOffTimers.delete(key);
        }
      }, safety.max_on_seconds * 1000);
      safetyOffTimers.set(key, t);
    }
  } else {
    const startedAt = currentOnAt.get(key);
    if (startedAt) {
      const onSec = Math.max(0, (now - startedAt) / 1000);
      const today = dailyOn.get(key);
      if (today && today.date === todayStr()) {
        today.seconds += onSec;
      } else {
        dailyOn.set(key, { date: todayStr(), seconds: onSec });
      }
      currentOnAt.delete(key);
    }
    lastOffAt.set(key, now);
    clearSafetyOff(key);
  }
}

function clearSafetyOff(key) {
  const t = safetyOffTimers.get(key);
  if (t) { clearTimeout(t); safetyOffTimers.delete(key); }
}

function applyState(key, on, trigger, userId = null) {
  return applyStateInternal(key, on, trigger, userId, false);
}

function applyStateInternal(key, on, trigger, userId, bypassSafety) {
  if (!actuators.has(key)) throw new Error(`[gpio] unknown actuator '${key}'`);

  if (!bypassSafety && on) {
    const err = checkSafety(key, true);
    if (err) throw err;
  }

  writePin(key, on);
  state.set(key, on);

  if (trigger === 'manual' || trigger === 'api') {
    manualOverride.set(key, true);
  } else if (trigger === 'schedule' || trigger === 'clear-override') {
    manualOverride.set(key, false);
  }
  // 'automation', 'safety', 'test' leave the manual-override flag unchanged.

  recordTransition(key, on, trigger);

  try {
    Q.insertDeviceLog(key, on, trigger, userId);
  } catch (err) {
    console.error('[gpio] device log insert failed:', err);
  }

  ws.broadcast({
    type: 'device_change',
    data: { device: key, state: on, trigger, timestamp: new Date().toISOString() },
  });

  return { device: key, state: on, trigger };
}

function safetyStatus(key) {
  const safety = safetyConfig(key);
  if (!safety) return null;
  const today = dailyOn.get(key);
  const usedToday = today && today.date === todayStr() ? today.seconds : 0;
  const lastOff = lastOffAt.get(key);
  const minOffRemaining = safety.min_off_seconds && lastOff
    ? Math.max(0, safety.min_off_seconds - (Date.now() - lastOff) / 1000)
    : 0;
  return {
    safety,
    daily_used_seconds: Math.round(usedToday),
    daily_remaining_seconds: safety.daily_max_seconds
      ? Math.max(0, safety.daily_max_seconds - Math.round(usedToday))
      : null,
    min_off_remaining_seconds: Math.ceil(minOffRemaining),
  };
}

function setActuator(key, on, trigger = 'manual', userId = null) {
  return applyState(key, !!on, trigger, userId);
}

// Click-to-test pulse: turns actuator on for `ms` then off. Does NOT set the
// manual-override flag (the scheduler should resume normally afterwards).
function pulse(key, ms = 1000, userId = null) {
  if (!actuators.has(key)) throw new Error(`[gpio] unknown actuator '${key}'`);
  const prev = pulseTimers.get(key);
  if (prev) clearTimeout(prev);

  applyState(key, true, 'test', userId);
  // Clear the override flag that applyState set (test isn't a real override).
  manualOverride.set(key, false);

  const timer = setTimeout(() => {
    try { applyState(key, false, 'test', userId); manualOverride.set(key, false); }
    catch (err) { console.error(`[gpio] pulse off ${key} failed:`, err); }
    finally { pulseTimers.delete(key); }
  }, Math.max(50, Math.min(10000, ms)));
  pulseTimers.set(key, timer);
  return { device: key, pulsed_ms: ms };
}

function getActuator(key) {
  const meta = actuators.get(key);
  if (!meta) return null;
  return {
    key, kind: meta.kind, name: meta.name,
    pin: meta.pin, inverted: meta.inverted, enabled: meta.enabled,
    auto_off_seconds: meta.auto_off_seconds, config: meta.config,
    state: !!state.get(key), manualOverride: !!manualOverride.get(key),
  };
}

function listActuators() {
  return [...actuators.keys()].map(getActuator);
}

function hasActuator(key) {
  return actuators.has(key);
}

function getState(key) {
  return !!state.get(key);
}

function isManualOverride(key) {
  return !!manualOverride.get(key);
}

function clearManualOverride(key) {
  manualOverride.set(key, false);
}

function autoOffSeconds(key) {
  const meta = actuators.get(key);
  return meta ? meta.auto_off_seconds : null;
}

function cleanup() {
  for (const t of pulseTimers.values()) clearTimeout(t);
  pulseTimers.clear();
  for (const t of safetyOffTimers.values()) clearTimeout(t);
  safetyOffTimers.clear();
  if (MOCK || !gpiox) return;
  for (const meta of actuators.values()) {
    closePin(meta.pin, meta.inverted);
  }
}

// Backward-compat shims so any callers still using setFan/setLight keep
// working until they're migrated.
function setFan(on, trigger = 'manual', userId = null) {
  return setActuator('fan', on, trigger, userId);
}
function setLight(on, trigger = 'manual', userId = null) {
  return setActuator('light', on, trigger, userId);
}
function getFanState() { return getState('fan'); }
function getLightState() { return getState('light'); }

module.exports = {
  init,
  reloadActuators,
  setActuator,
  pulse,
  listActuators,
  getActuator,
  hasActuator,
  getState,
  isManualOverride,
  clearManualOverride,
  autoOffSeconds,
  safetyStatus,
  SafetyError,
  cleanup,
  isMock: () => MOCK,
  // back-compat
  setFan,
  setLight,
  getFanState,
  getLightState,
};
