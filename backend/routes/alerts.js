const express = require('express');
const { Q } = require('../database');
const alerts = require('../alerts');
const auth = require('../auth');

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

// Telegram notification config. Bot token is considered a secret, so the
// GET response masks everything but the last 4 chars; PUT accepts a fresh
// token to rotate it. Owner-only on both sides.
router.get('/alerts/telegram', auth.requireAdmin, (_req, res) => {
  const s = Q.getAllSettings();
  const token = s.telegram_bot_token || '';
  res.json({
    enabled: s.telegram_enabled === '1',
    chat_id: s.telegram_chat_id || '',
    token_masked: token ? `••••${token.slice(-4)}` : '',
    has_token: !!token,
  });
});

router.put('/alerts/telegram', auth.requireAdmin, (req, res) => {
  const body = req.body || {};
  const errs = [];
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    errs.push('enabled must be boolean');
  }
  if (body.chat_id !== undefined && (typeof body.chat_id !== 'string' || body.chat_id.length > 64)) {
    errs.push('chat_id must be a string ≤ 64 chars');
  }
  if (body.bot_token !== undefined) {
    if (typeof body.bot_token !== 'string' || body.bot_token.length > 128) {
      errs.push('bot_token must be a string ≤ 128 chars');
    } else if (body.bot_token && !/^\d+:[A-Za-z0-9_-]+$/.test(body.bot_token)) {
      errs.push('bot_token does not look like a Telegram bot token');
    }
  }
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });

  if (body.enabled !== undefined) Q.setSetting('telegram_enabled', body.enabled ? '1' : '0');
  if (body.chat_id !== undefined) Q.setSetting('telegram_chat_id', body.chat_id);
  if (body.bot_token !== undefined && body.bot_token) Q.setSetting('telegram_bot_token', body.bot_token);

  auth.logAudit(req, 'alerts.telegram_config', null, {
    enabled: body.enabled,
    chat_id_set: body.chat_id !== undefined,
    token_set: body.bot_token !== undefined && !!body.bot_token,
  });
  res.json({ ok: true });
});

router.post('/alerts/telegram/test', auth.requireAdmin, async (req, res) => {
  const result = await alerts.sendTelegram(
    `[frutero] test ping from ${req.user?.email || 'unknown'} at ${new Date().toISOString()}`
  );
  auth.logAudit(req, 'alerts.telegram_test', null, result);
  res.json(result);
});

router.get('/alerts/history', (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  if (limit > 200) limit = 200;
  res.json(alerts.recent(limit));
});

module.exports = router;
