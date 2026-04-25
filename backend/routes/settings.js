const express = require('express');
const { Q } = require('../database');
const scheduler = require('../scheduler');

const router = express.Router();

router.get('/settings', (_req, res) => {
  // species_presets used to come from config.SPECIES_PRESETS but is
  // now DB-backed. Convert the species table rows into the same map
  // shape the frontend expected so existing callers don't break.
  const presets = {};
  for (const s of Q.listSpecies()) {
    presets[s.key] = {
      name: s.name,
      temp_min: s.temp_min,
      temp_max: s.temp_max,
      humid_min: s.humid_min,
      humid_max: s.humid_max,
      light_hours: s.light_hours,
      fan_interval: s.fan_interval,
      mister_threshold: s.mister_threshold,
      mister_pulse_seconds: s.mister_pulse_seconds,
    };
  }
  res.json({
    settings: Q.getAllSettings(),
    species_presets: presets,
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
  const preset = Q.getSpecies(speciesKey);
  if (!preset) return res.status(400).json({ error: 'unknown species' });

  Q.setSetting('species', speciesKey);
  Q.setSetting('fan_cycle_interval', String(preset.fan_interval));
  Q.upsertAlertConfig('temperature', preset.temp_min, preset.temp_max, true);
  Q.upsertAlertConfig('humidity', preset.humid_min, preset.humid_max, true);

  if (preset.mister_threshold != null) {
    Q.setSetting('mister_humidity_threshold', String(preset.mister_threshold));
  }
  if (preset.mister_pulse_seconds != null) {
    Q.setSetting('mister_pulse_seconds', String(preset.mister_pulse_seconds));
  }

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
