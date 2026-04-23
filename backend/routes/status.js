const express = require('express');
const gpio = require('../gpio');
const sensor = require('../sensor');
const scheduler = require('../scheduler');

const router = express.Router();
const startedAt = Date.now();

router.get('/status', (_req, res) => {
  const list = gpio.listActuators();
  const actuators = {};
  for (const a of list) actuators[a.key] = a;

  res.json({
    actuators,
    sensor: sensor.getLatest(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    gpioMock: gpio.isMock(),
    nextInvocations: scheduler.nextInvocations(),
    nextByDevice: scheduler.nextByDevice(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
