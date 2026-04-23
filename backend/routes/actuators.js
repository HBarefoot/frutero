const express = require('express');
const { Q } = require('../database');
const gpio = require('../gpio');
const auth = require('../auth');
const hardware = require('../hardware');

const router = express.Router();

const VALID_KIND = new Set(['fan', 'light', 'mister', 'pump', 'heater', 'humidifier', 'other']);
const KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;

// Atomizer discs can dry-fire in minutes — these defaults protect the
// hardware even if the operator forgets to set safety limits explicitly.
const MISTER_SAFETY_DEFAULTS = {
  max_on_seconds: 30,
  min_off_seconds: 30,
  daily_max_seconds: 1800,
};
const MISTER_DEFAULT_AUTO_OFF = 10;

function ensureMisterSafety(config) {
  const c = config && typeof config === 'object' ? { ...config } : {};
  if (!c.safety || typeof c.safety !== 'object') {
    c.safety = { ...MISTER_SAFETY_DEFAULTS };
  }
  return c;
}

function serialize(a) {
  if (!a) return null;
  return {
    key: a.key,
    name: a.name,
    kind: a.kind,
    gpio_pin: a.gpio_pin,
    inverted: !!a.inverted,
    enabled: !!a.enabled,
    auto_off_seconds: a.auto_off_seconds,
    config: a.config ? safeParse(a.config) : null,
    state: gpio.hasActuator(a.key) ? gpio.getState(a.key) : false,
    manualOverride: gpio.hasActuator(a.key) ? gpio.isManualOverride(a.key) : false,
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

function validatePin(pin, excludeKey = null) {
  if (!Number.isInteger(pin)) return 'gpio_pin must be an integer';
  if (!hardware.ALL_GPIO_PINS.includes(pin)) return `gpio_pin ${pin} is not a usable BCM pin`;
  if (hardware.RESERVED_PINS[pin]) return `gpio_pin ${pin} is reserved (${hardware.RESERVED_PINS[pin]})`;
  const occupant = Q.findActuatorByPin(pin);
  if (occupant && occupant.key !== excludeKey) {
    return `gpio_pin ${pin} is already used by actuator '${occupant.key}'`;
  }
  return null;
}

router.get('/actuators', (_req, res) => {
  res.json(Q.listActuators().map(serialize));
});

router.get('/actuators/:key', (req, res) => {
  const row = Q.findActuator(req.params.key);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serialize(row));
});

// Adding/removing actuators is a hardware-config change → owner-only.
router.post('/actuators', auth.requireAdmin, (req, res) => {
  const body = req.body || {};
  const { key, name, kind, gpio_pin, inverted, enabled, auto_off_seconds, config } = body;

  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    return res.status(400).json({ error: 'key must match [a-z][a-z0-9_]{1,31}' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  if (typeof kind !== 'string' || !VALID_KIND.has(kind)) {
    return res.status(400).json({ error: `kind must be one of ${[...VALID_KIND].join(', ')}` });
  }
  const pinErr = validatePin(Number(gpio_pin));
  if (pinErr) return res.status(400).json({ error: pinErr });
  if (auto_off_seconds != null) {
    const n = Number(auto_off_seconds);
    if (!Number.isFinite(n) || n < 1 || n > 86400) {
      return res.status(400).json({ error: 'auto_off_seconds must be 1-86400 or null' });
    }
  }

  if (Q.findActuator(key)) {
    return res.status(409).json({ error: 'key_already_exists' });
  }

  let finalConfig = config || {};
  if (typeof finalConfig === 'string') {
    try { finalConfig = JSON.parse(finalConfig); } catch { finalConfig = {}; }
  }
  if (kind === 'mister') finalConfig = ensureMisterSafety(finalConfig);

  let finalAutoOff = auto_off_seconds;
  if (kind === 'mister' && finalAutoOff == null) finalAutoOff = MISTER_DEFAULT_AUTO_OFF;

  try {
    Q.insertActuator({
      key, name: name.trim(), kind,
      gpio_pin: Number(gpio_pin),
      inverted: !!inverted,
      enabled: enabled !== false,
      auto_off_seconds: finalAutoOff,
      config: finalConfig,
    });
    gpio.reloadActuators();
    auth.logAudit(req, 'actuator.create', `actuator:${key}`, { kind, gpio_pin, inverted: !!inverted, safety: finalConfig?.safety });
    res.status(201).json(serialize(Q.findActuator(key)));
  } catch (err) {
    console.error('[actuators] create error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/actuators/:key', auth.requireAdmin, (req, res) => {
  const key = req.params.key;
  const existing = Q.findActuator(key);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const fields = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return res.status(400).json({ error: 'name required' });
    }
    fields.name = body.name.trim();
  }
  if (body.kind !== undefined) {
    if (!VALID_KIND.has(body.kind)) {
      return res.status(400).json({ error: 'invalid kind' });
    }
    fields.kind = body.kind;
  }
  if (body.gpio_pin !== undefined) {
    const n = Number(body.gpio_pin);
    const pinErr = validatePin(n, key);
    if (pinErr) return res.status(400).json({ error: pinErr });
    fields.gpio_pin = n;
  }
  if (body.inverted !== undefined) fields.inverted = !!body.inverted;
  if (body.enabled !== undefined) fields.enabled = !!body.enabled;
  if (body.auto_off_seconds !== undefined) {
    if (body.auto_off_seconds !== null) {
      const n = Number(body.auto_off_seconds);
      if (!Number.isFinite(n) || n < 1 || n > 86400) {
        return res.status(400).json({ error: 'auto_off_seconds must be 1-86400 or null' });
      }
    }
    fields.auto_off_seconds = body.auto_off_seconds;
  }
  if (body.config !== undefined) fields.config = body.config;

  // After merging fields, enforce mister safety on the resulting row. Covers
  // two attack paths: (a) user PUTs config without safety, (b) user changes
  // kind to 'mister' without providing config at all.
  const finalKind = fields.kind ?? existing.kind;
  if (finalKind === 'mister') {
    let cfg = fields.config !== undefined ? fields.config : existing.config;
    if (typeof cfg === 'string') {
      try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
    }
    fields.config = ensureMisterSafety(cfg);
    // Misters must auto-off — reject an explicit null and coerce the default
    // when the row has no auto_off_seconds set yet.
    if (fields.auto_off_seconds === null) {
      return res.status(400).json({ error: 'mister actuators require auto_off_seconds' });
    }
    if (fields.auto_off_seconds === undefined && existing.auto_off_seconds == null) {
      fields.auto_off_seconds = MISTER_DEFAULT_AUTO_OFF;
    }
  }

  try {
    Q.updateActuator(key, fields);
    gpio.reloadActuators();
    auth.logAudit(req, 'actuator.update', `actuator:${key}`, fields);
    res.json(serialize(Q.findActuator(key)));
  } catch (err) {
    console.error('[actuators] update error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/actuators/:key', auth.requireAdmin, (req, res) => {
  const key = req.params.key;
  const existing = Q.findActuator(key);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const usedBy = Q.countSchedulesForDevice(key);
  if (usedBy > 0) {
    return res.status(409).json({
      error: 'in_use',
      detail: `${usedBy} schedule(s) still reference this actuator. Remove them first.`,
    });
  }
  try {
    // Turn off before removing so we don't leave a relay latched.
    if (gpio.hasActuator(key) && gpio.getState(key)) {
      gpio.setActuator(key, false, 'api', req.user?.id ?? null);
    }
    Q.deleteActuator(key);
    gpio.reloadActuators();
    auth.logAudit(req, 'actuator.delete', `actuator:${key}`, null);
    res.json({ success: true });
  } catch (err) {
    console.error('[actuators] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Click-to-test: pulse the actuator briefly. Default 1 s, max 10 s. Allowed
// for any role with mutate permission (operator + owner).
router.post('/actuators/:key/test', (req, res) => {
  const key = req.params.key;
  if (!gpio.hasActuator(key)) return res.status(404).json({ error: 'not_found' });
  const ms = Math.max(50, Math.min(10000, Number(req.body?.ms) || 1000));
  try {
    const result = gpio.pulse(key, ms, req.user?.id ?? null);
    auth.logAudit(req, 'actuator.test_pulse', `actuator:${key}`, { ms });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.code === 'SAFETY_BLOCKED') {
      return res.status(429).json({ error: 'safety_blocked', detail: err.message });
    }
    console.error('[actuators] test error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
