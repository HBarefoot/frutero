const express = require('express');
const auth = require('../auth');
const hardware = require('../hardware');
const { getHostStats } = require('../host');

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

// Pi host health: SoC temp, load, memory, disk, throttle flags.
// Useful for debugging thermal throttling, undervoltage, and SD-card
// exhaustion. Cheap enough to hit every 5s from the Hardware page.
router.get('/hardware/host', auth.requireAdmin, (_req, res) => {
  try {
    res.json(getHostStats());
  } catch (err) {
    console.error('[hardware] host stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
