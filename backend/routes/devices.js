const express = require('express');
const gpio = require('../gpio');

const router = express.Router();

function handle(req, res, setter) {
  const { state } = req.body || {};
  if (typeof state !== 'boolean') {
    return res.status(400).json({ error: 'Body must be { state: boolean }' });
  }
  try {
    const result = setter(state, 'api');
    res.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[devices] error:', err);
    res.status(500).json({ error: err.message });
  }
}

router.post('/fan', (req, res) => handle(req, res, gpio.setFan));
router.post('/light', (req, res) => handle(req, res, gpio.setLight));

router.post('/fan/clear-override', (_req, res) => {
  gpio.clearManualOverride('fan');
  res.json({ success: true });
});
router.post('/light/clear-override', (_req, res) => {
  gpio.clearManualOverride('light');
  res.json({ success: true });
});

module.exports = router;
