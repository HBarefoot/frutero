const express = require('express');
const { Q } = require('../database');
const automations = require('../automations');
const gpio = require('../gpio');
const auth = require('../auth');

const router = express.Router();

router.get('/misting', (_req, res) => {
  res.json(automations.status());
});

router.put('/misting', auth.requireAdmin, (req, res) => {
  const body = req.body || {};
  const errs = [];

  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    errs.push('enabled must be boolean');
  }
  if (body.actuator_key !== undefined) {
    if (typeof body.actuator_key !== 'string' || !gpio.hasActuator(body.actuator_key)) {
      errs.push('actuator_key must reference an existing actuator');
    }
  }
  if (body.humidity_threshold !== undefined) {
    const n = Number(body.humidity_threshold);
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      errs.push('humidity_threshold must be 1-100');
    }
  }
  if (body.pulse_seconds !== undefined) {
    const n = Number(body.pulse_seconds);
    if (!Number.isFinite(n) || n < 1 || n > 600) {
      errs.push('pulse_seconds must be 1-600');
    }
  }
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });

  if (body.enabled !== undefined) Q.setSetting('mister_automation_enabled', body.enabled ? '1' : '0');
  if (body.actuator_key !== undefined) Q.setSetting('mister_actuator_key', body.actuator_key);
  if (body.humidity_threshold !== undefined) Q.setSetting('mister_humidity_threshold', String(body.humidity_threshold));
  if (body.pulse_seconds !== undefined) Q.setSetting('mister_pulse_seconds', String(body.pulse_seconds));

  auth.logAudit(req, 'misting.config', null, body);
  res.json(automations.status());
});

module.exports = router;
