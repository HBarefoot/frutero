const config = require('./config');
const ws = require('./ws');
const { Q } = require('./database');

// Low-level trigger relay module:
//   Pin LOW (0)  → coil energized → NO contact closed, NC contact open
//   Pin HIGH (1) → coil de-energized → NO contact open, NC contact closed
//
// With NO wiring (FAN/LIGHT_INVERTED=false) device is ON when coil is
// energized (pin LOW). With NC wiring (INVERTED=true) device is ON when
// coil is de-energized (pin HIGH). All polarity handling is isolated here;
// the rest of the codebase uses boolean on/off semantics.
const HIGH = 1;
const LOW = 0;

const pinConfig = {
  fan: { pin: config.FAN_PIN, inverted: !!config.FAN_INVERTED },
  light: { pin: config.LIGHT_PIN, inverted: !!config.LIGHT_INVERTED },
};

let gpiox = null;
let MOCK = false;
const state = { fan: false, light: false };
const manualOverride = { fan: false, light: false };

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

function init() {
  if (config.GPIO_STUB) {
    MOCK = true;
    console.log('[gpio] GPIO_STUB=true — MOCK mode, relays will NOT switch');
    return;
  }
  loadLib();
  if (MOCK) return;

  for (const [device, { pin, inverted }] of Object.entries(pinConfig)) {
    const offLevel = levelFor(false, inverted);
    const ok = gpiox.init_gpio(pin, gpiox.GPIO_MODE_OUTPUT, offLevel);
    if (!ok) {
      throw new Error(`[gpio] init pin ${pin} (${device}) failed: ${gpiox.error_text()}`);
    }
    if (inverted) {
      console.log(`[gpio] ${device} polarity INVERTED (NC wiring): pin HIGH=OFF via energized coil→open NC`);
    }
  }
}

function writePin(device, on) {
  if (MOCK) return;
  const { pin, inverted } = pinConfig[device];
  const level = levelFor(on, inverted);
  const ok = gpiox.set_gpio(pin, level);
  if (!ok) {
    throw new Error(`[gpio] set_gpio(${pin}) failed: ${gpiox.error_text()}`);
  }
}

function applyState(device, on, trigger, userId = null) {
  writePin(device, on);
  state[device] = on;

  if (trigger === 'manual' || trigger === 'api') {
    manualOverride[device] = true;
  } else if (trigger === 'schedule' || trigger === 'clear-override') {
    manualOverride[device] = false;
  }

  try {
    Q.insertDeviceLog(device, on, trigger, userId);
  } catch (err) {
    console.error('[gpio] device log insert failed:', err);
  }

  ws.broadcast({
    type: 'device_change',
    data: { device, state: on, trigger, timestamp: new Date().toISOString() },
  });

  return { device, state: on, trigger };
}

function setFan(on, trigger = 'manual', userId = null) {
  return applyState('fan', !!on, trigger, userId);
}

function setLight(on, trigger = 'manual', userId = null) {
  return applyState('light', !!on, trigger, userId);
}

function getFanState() {
  return state.fan;
}

function getLightState() {
  return state.light;
}

function isManualOverride(device) {
  return !!manualOverride[device];
}

function clearManualOverride(device) {
  manualOverride[device] = false;
}

function cleanup() {
  if (MOCK || !gpiox) return;
  try {
    for (const { pin, inverted } of Object.values(pinConfig)) {
      gpiox.set_gpio(pin, levelFor(false, inverted));
      gpiox.deinit_gpio(pin);
    }
  } catch (err) {
    console.error('[gpio] cleanup error:', err);
  }
}

module.exports = {
  init,
  setFan,
  setLight,
  getFanState,
  getLightState,
  isManualOverride,
  clearManualOverride,
  cleanup,
  isMock: () => MOCK,
};
