const express = require('express');
const gpio = require('../gpio');
const sensor = require('../sensor');
const scheduler = require('../scheduler');
const { Q } = require('../database');

const router = express.Router();
const startedAt = Date.now();

router.get('/status', (_req, res) => {
  const list = gpio.listActuators();
  const actuators = {};
  for (const a of list) actuators[a.key] = a;

  // Chamber name comes from fleet_name (set at fleet enrollment + kept
  // in sync by the cloud's `rename_chamber` command). Falls back to
  // 'Chamber' when not enrolled, matching the cloud's enrollment default.
  const chamberName = Q.getSecret('fleet_name') || 'Chamber';

  res.json({
    chamber_name: chamberName,
    actuators,
    sensor: sensor.getLatest(),
    sensor_health: sensor.getHealth(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    gpioMock: gpio.isMock(),
    nextInvocations: scheduler.nextInvocations(),
    nextByDevice: scheduler.nextByDevice(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
