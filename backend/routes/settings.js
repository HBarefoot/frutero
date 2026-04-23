const express = require('express');
const { Q } = require('../database');
const config = require('../config');
const scheduler = require('../scheduler');

const router = express.Router();

router.get('/settings', (_req, res) => {
  res.json({
    settings: Q.getAllSettings(),
    species_presets: config.SPECIES_PRESETS,
  });
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  for (const [key, value] of Object.entries(body)) {
    Q.setSetting(key, value);
  }
  // If fan cycle settings changed, the running auto-off duration picks up
  // the new value on next fire (scheduler reads fresh per tick).
  res.json({ settings: Q.getAllSettings() });
});

router.post('/settings/species', (req, res) => {
  const speciesKey = req.body && req.body.species;
  const preset = config.SPECIES_PRESETS[speciesKey];
  if (!preset) return res.status(400).json({ error: 'unknown species' });

  Q.setSetting('species', speciesKey);
  Q.setSetting('fan_cycle_interval', String(preset.fan_interval));
  Q.upsertAlertConfig('temperature', preset.temp_min, preset.temp_max, true);
  Q.upsertAlertConfig('humidity', preset.humid_min, preset.humid_max, true);

  // Update the default fan cycle schedule to match new interval.
  const schedules = Q.listSchedules();
  const fanOn = schedules.find((s) => s.device === 'fan' && s.action === 'on');
  if (fanOn) {
    Q.updateSchedule(fanOn.id, {
      cron_expression: `*/${preset.fan_interval} * * * *`,
      label: `Fan cycle (every ${preset.fan_interval}min)`,
    });
  }
  scheduler.reload();

  res.json({ settings: Q.getAllSettings(), preset });
});

module.exports = router;
