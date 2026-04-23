const express = require('express');
const gpio = require('../gpio');
const sensor = require('../sensor');
const scheduler = require('../scheduler');

const router = express.Router();
const startedAt = Date.now();

router.get('/status', (_req, res) => {
  res.json({
    fan: gpio.getFanState(),
    light: gpio.getLightState(),
    sensor: sensor.getLatest(),
    manualOverride: {
      fan: gpio.isManualOverride('fan'),
      light: gpio.isManualOverride('light'),
    },
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    gpioMock: gpio.isMock(),
    nextInvocations: scheduler.nextInvocations(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
