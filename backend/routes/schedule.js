const express = require('express');
const { Q } = require('../database');
const scheduler = require('../scheduler');
const gpio = require('../gpio');

const router = express.Router();

const ACTIONS = new Set(['on', 'off']);

function validate(payload, partial = false) {
  const errs = [];
  if (!partial || payload.device !== undefined) {
    if (typeof payload.device !== 'string' || !gpio.hasActuator(payload.device)) {
      errs.push('device must be a known actuator key');
    }
  }
  if (!partial || payload.action !== undefined) {
    if (!ACTIONS.has(payload.action)) errs.push('action must be on|off');
  }
  if (!partial || payload.cron_expression !== undefined) {
    if (typeof payload.cron_expression !== 'string' || !payload.cron_expression.trim()) {
      errs.push('cron_expression required');
    }
  }
  return errs;
}

router.get('/schedule', (_req, res) => {
  res.json(Q.listSchedules());
});

router.post('/schedule', (req, res) => {
  const errs = validate(req.body);
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });
  const info = Q.insertSchedule({
    device: req.body.device,
    action: req.body.action,
    cron_expression: req.body.cron_expression,
    enabled: req.body.enabled !== false,
    label: req.body.label,
  });
  scheduler.reload();
  res.json(Q.getSchedule(info.lastInsertRowid));
});

router.put('/schedule/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const errs = validate(req.body, true);
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });
  Q.updateSchedule(id, req.body);
  scheduler.reload();
  const updated = Q.getSchedule(id);
  if (!updated) return res.status(404).json({ error: 'not found' });
  res.json(updated);
});

router.delete('/schedule/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  Q.deleteSchedule(id);
  scheduler.reload();
  res.json({ success: true });
});

module.exports = router;
