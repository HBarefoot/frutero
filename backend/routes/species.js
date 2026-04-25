const express = require('express');
const { Q } = require('../database');
const auth = require('../auth');
const speciesRegimen = require('../ai/species-regimen');

// REST CRUD for the species table + an AI helper that suggests a
// regimen for a new species. Built-in species (source='built-in')
// can't be deleted but can be renamed/edited like custom ones.

const router = express.Router();

// List + read are open to any authed user — viewers see what species
// are configured. Mutations require operator+ ('mutate').
router.get('/species', auth.requireAuth, (_req, res) => {
  res.json({ species: Q.listSpecies() });
});

router.post('/species', auth.requireMutate, (req, res) => {
  const body = req.body || {};
  const err = validateRegimen(body);
  if (err) return res.status(400).json({ error: err });
  const key = slugifyKey(body.key || body.name);
  if (!key) return res.status(400).json({ error: 'invalid_key' });
  if (Q.getSpecies(key)) return res.status(409).json({ error: 'key_exists', key });

  Q.insertSpecies({
    key,
    name: body.name.trim(),
    temp_min: body.temp_min,
    temp_max: body.temp_max,
    humid_min: body.humid_min,
    humid_max: body.humid_max,
    light_hours: body.light_hours,
    fan_interval: body.fan_interval,
    mister_threshold: body.mister_threshold ?? null,
    mister_pulse_seconds: body.mister_pulse_seconds ?? null,
    notes: body.notes ? String(body.notes).slice(0, 1000) : null,
    source: body.source === 'ai-suggested' ? 'ai-suggested' : 'custom',
    created_by: req.user?.id ?? null,
  });
  auth.logAudit(req, 'species.create', `species:${key}`, { name: body.name, source: body.source || 'custom' });
  res.status(201).json({ species: Q.getSpecies(key) });
});

router.patch('/species/:key', auth.requireMutate, (req, res) => {
  const key = req.params.key;
  const existing = Q.getSpecies(key);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const body = req.body || {};

  // Edits are allowed on built-in species (operators may want to
  // tighten ranges for their setup) — only delete is protected.
  const fields = {};
  for (const k of [
    'name', 'temp_min', 'temp_max', 'humid_min', 'humid_max',
    'light_hours', 'fan_interval', 'mister_threshold',
    'mister_pulse_seconds', 'notes',
  ]) {
    if (k in body) fields[k] = body[k];
  }
  // Run validateRegimen against the merged shape — partial update
  // mustn't violate constraints either.
  const merged = { ...existing, ...fields };
  const err = validateRegimen(merged);
  if (err) return res.status(400).json({ error: err });

  Q.updateSpecies(key, fields);
  auth.logAudit(req, 'species.update', `species:${key}`, fields);
  res.json({ species: Q.getSpecies(key) });
});

router.delete('/species/:key', auth.requireAdmin, (req, res) => {
  const key = req.params.key;
  const existing = Q.getSpecies(key);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.source === 'built-in') {
    return res.status(409).json({ error: 'builtin_protected' });
  }
  Q.deleteSpecies(key);
  auth.logAudit(req, 'species.delete', `species:${key}`, null);
  res.json({ ok: true });
});

// POST /species/suggest-regimen — admin-only because it spends API
// tokens. Body: { name, notes? }. Returns the suggested regimen
// without persisting; caller can pass it to POST /species to save.
router.post('/species/suggest-regimen', auth.requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 64) {
    return res.status(400).json({ error: 'name_required' });
  }
  const notes = req.body?.notes ? String(req.body.notes).slice(0, 1000) : '';
  try {
    const regimen = await speciesRegimen.suggest({ name, notes });
    auth.logAudit(req, 'species.suggest_regimen', null, { name });
    res.json({ regimen });
  } catch (err) {
    if (err?.code === 'ai_disabled') {
      return res.status(409).json({ error: 'ai_disabled', detail: 'Enable the AI advisor on the AI page first.' });
    }
    console.error('[species] suggest-regimen failed:', err);
    res.status(500).json({ error: 'suggest_failed', detail: err.message?.slice(0, 500) });
  }
});

function slugifyKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function validateRegimen(s) {
  if (!s || typeof s !== 'object') return 'invalid_body';
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 64) return 'invalid_name';
  for (const k of ['temp_min', 'temp_max', 'humid_min', 'humid_max']) {
    if (typeof s[k] !== 'number' || !Number.isFinite(s[k])) return `invalid_${k}`;
  }
  if (s.temp_min >= s.temp_max) return 'temp_min_gte_max';
  if (s.humid_min >= s.humid_max) return 'humid_min_gte_max';
  if (s.humid_min < 0 || s.humid_max > 100) return 'humid_out_of_range';
  if (typeof s.light_hours !== 'number' || s.light_hours < 0 || s.light_hours > 24) return 'invalid_light_hours';
  if (typeof s.fan_interval !== 'number' || s.fan_interval < 1 || s.fan_interval > 240) return 'invalid_fan_interval';
  if (s.mister_threshold != null && (s.mister_threshold < 0 || s.mister_threshold > 100)) return 'invalid_mister_threshold';
  if (s.mister_pulse_seconds != null && (s.mister_pulse_seconds < 1 || s.mister_pulse_seconds > 120)) return 'invalid_mister_pulse';
  return null;
}

module.exports = router;
