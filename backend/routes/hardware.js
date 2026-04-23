const express = require('express');
const auth = require('../auth');
const hardware = require('../hardware');

const router = express.Router();

// Hardware scan exposes raw bus/device info — owner-only since it's a
// system-config view and shells out to system tools.
router.get('/hardware/scan', auth.requireAdmin, (_req, res) => {
  try {
    res.json(hardware.scanAll());
  } catch (err) {
    console.error('[hardware] scan error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/hardware/gpio', auth.requireAdmin, (_req, res) => {
  res.json(hardware.scanGpio());
});

router.get('/hardware/i2c', auth.requireAdmin, (_req, res) => {
  res.json(hardware.scanI2C());
});

router.get('/hardware/onewire', auth.requireAdmin, (_req, res) => {
  res.json(hardware.scan1Wire());
});

router.get('/hardware/sensors', auth.requireAdmin, (_req, res) => {
  res.json(hardware.scanSensors());
});

router.get('/hardware/video', auth.requireAdmin, (_req, res) => {
  res.json(hardware.scanVideo());
});

module.exports = router;
