const express = require('express');
const gpio = require('../gpio');
const auth = require('../auth');

const router = express.Router();

function setDevice(req, res, key) {
  const { state } = req.body || {};
  if (typeof state !== 'boolean') {
    return res.status(400).json({ error: 'Body must be { state: boolean }' });
  }
  if (!gpio.hasActuator(key)) {
    return res.status(404).json({ error: `unknown actuator '${key}'` });
  }
  try {
    const result = gpio.setActuator(key, state, 'api', req.user?.id ?? null);
    auth.logAudit(req, state ? 'device.on' : 'device.off', `device:${key}`, { trigger: 'api' });
    res.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    if (err.code === 'SAFETY_BLOCKED') {
      auth.logAudit(req, 'device.safety_block', `device:${key}`, { reason: err.message });
      return res.status(429).json({ error: 'safety_blocked', detail: err.message });
    }
    console.error('[devices] error:', err);
    res.status(500).json({ error: err.message });
  }
}

function clearOverride(req, res, key) {
  if (!gpio.hasActuator(key)) {
    return res.status(404).json({ error: `unknown actuator '${key}'` });
  }
  gpio.clearManualOverride(key);
  auth.logAudit(req, 'device.clear_override', `device:${key}`, null);
  res.json({ success: true });
}

// Generic per-actuator endpoints
router.post('/devices/:key', (req, res) => setDevice(req, res, req.params.key));
router.post('/devices/:key/clear-override', (req, res) => clearOverride(req, res, req.params.key));

// Back-compat aliases (keep until all callers migrate to /devices/:key).
router.post('/fan', (req, res) => setDevice(req, res, 'fan'));
router.post('/light', (req, res) => setDevice(req, res, 'light'));
router.post('/fan/clear-override', (req, res) => clearOverride(req, res, 'fan'));
router.post('/light/clear-override', (req, res) => clearOverride(req, res, 'light'));

module.exports = router;
