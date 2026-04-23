const express = require('express');
const gpio = require('../gpio');
const auth = require('../auth');

const router = express.Router();

function handle(req, res, setter) {
  const { state } = req.body || {};
  if (typeof state !== 'boolean') {
    return res.status(400).json({ error: 'Body must be { state: boolean }' });
  }
  try {
    const result = setter(state, 'api', req.user?.id ?? null);
    auth.logAudit(req, state ? 'device.on' : 'device.off', `device:${result.device}`, {
      trigger: 'api',
    });
    res.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[devices] error:', err);
    res.status(500).json({ error: err.message });
  }
}

router.post('/fan', (req, res) => handle(req, res, gpio.setFan));
router.post('/light', (req, res) => handle(req, res, gpio.setLight));

router.post('/fan/clear-override', (req, res) => {
  gpio.clearManualOverride('fan');
  auth.logAudit(req, 'device.clear_override', 'device:fan', null);
  res.json({ success: true });
});
router.post('/light/clear-override', (req, res) => {
  gpio.clearManualOverride('light');
  auth.logAudit(req, 'device.clear_override', 'device:light', null);
  res.json({ success: true });
});

module.exports = router;
