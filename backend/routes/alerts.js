const express = require('express');
const { Q } = require('../database');
const alerts = require('../alerts');

const router = express.Router();

function shape() {
  const rows = Q.getAlertConfig();
  const out = {
    temperature: { min: null, max: null, enabled: false },
    humidity: { min: null, max: null, enabled: false },
  };
  for (const r of rows) {
    if (out[r.metric]) {
      out[r.metric] = {
        min: r.min_value,
        max: r.max_value,
        enabled: !!r.enabled,
      };
    }
  }
  return out;
}

router.get('/alerts', (_req, res) => {
  res.json({ config: shape(), history: alerts.recent(10) });
});

router.put('/alerts', (req, res) => {
  const body = req.body || {};
  for (const metric of ['temperature', 'humidity']) {
    const entry = body[metric];
    if (!entry) continue;
    const min = entry.min == null ? null : Number(entry.min);
    const max = entry.max == null ? null : Number(entry.max);
    const enabled = entry.enabled !== false;
    Q.upsertAlertConfig(metric, min, max, enabled);
  }
  res.json({ config: shape() });
});

router.get('/alerts/history', (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  if (limit > 200) limit = 200;
  res.json(alerts.recent(limit));
});

module.exports = router;
