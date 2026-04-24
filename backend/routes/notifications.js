const express = require('express');
const { Q } = require('../database');
const notifications = require('../notifications');
const auth = require('../auth');

const router = express.Router();

// Owner-only config for the notification channels. Secrets (SMTP
// password, webhook URL, Telegram token) are stored in the secrets
// table and never echoed back — the response returns `has_*` booleans
// instead.

function currentConfig() {
  const s = Q.getAllSettings();
  return {
    min_severity: s.notify_min_severity || 'info',
    telegram: {
      enabled: s.notify_telegram_enabled === '1' || s.telegram_enabled === '1',
      chat_id: s.telegram_chat_id || '',
      has_token: !!(Q.getSecret('telegram_bot_token') || s.telegram_bot_token),
    },
    email: {
      enabled: s.notify_email_enabled === '1',
      host: s.notify_email_host || '',
      port: parseInt(s.notify_email_port, 10) || 587,
      secure: s.notify_email_secure === '1',
      user: s.notify_email_user || '',
      from: s.notify_email_from || '',
      to: s.notify_email_to || '',
      has_password: !!Q.getSecret('notify_email_password'),
    },
    webhook: {
      enabled: s.notify_webhook_enabled === '1',
      style: s.notify_webhook_style || 'generic',
      has_url: !!Q.getSecret('notify_webhook_url'),
    },
  };
}

router.get('/notifications/config', auth.requireAdmin, (_req, res) => {
  res.json(currentConfig());
});

// PUT accepts a nested patch: { telegram: {...}, email: {...}, webhook: {...}, min_severity }
router.put('/notifications/config', auth.requireAdmin, (req, res) => {
  const body = req.body || {};

  if (body.min_severity !== undefined) {
    if (!['info', 'warn'].includes(body.min_severity)) {
      return res.status(400).json({ error: 'min_severity must be info|warn' });
    }
    Q.setSetting('notify_min_severity', body.min_severity);
  }

  if (body.telegram) {
    const t = body.telegram;
    if (t.enabled !== undefined) Q.setSetting('notify_telegram_enabled', t.enabled ? '1' : '0');
    if (t.chat_id !== undefined) Q.setSetting('telegram_chat_id', String(t.chat_id || ''));
    if (t.bot_token !== undefined) {
      const v = String(t.bot_token || '').trim();
      if (v.length === 0) Q.deleteSecret('telegram_bot_token');
      else Q.setSecret('telegram_bot_token', v);
    }
  }

  if (body.email) {
    const e = body.email;
    if (e.enabled !== undefined) Q.setSetting('notify_email_enabled', e.enabled ? '1' : '0');
    if (e.host !== undefined) Q.setSetting('notify_email_host', String(e.host || ''));
    if (e.port !== undefined) {
      const n = parseInt(e.port, 10);
      if (Number.isFinite(n) && n > 0 && n < 65536) Q.setSetting('notify_email_port', String(n));
    }
    if (e.secure !== undefined) Q.setSetting('notify_email_secure', e.secure ? '1' : '0');
    if (e.user !== undefined) Q.setSetting('notify_email_user', String(e.user || ''));
    if (e.from !== undefined) Q.setSetting('notify_email_from', String(e.from || ''));
    if (e.to !== undefined) Q.setSetting('notify_email_to', String(e.to || ''));
    if (e.password !== undefined) {
      const v = String(e.password || '');
      if (v.length === 0) Q.deleteSecret('notify_email_password');
      else Q.setSecret('notify_email_password', v);
    }
  }

  if (body.webhook) {
    const w = body.webhook;
    if (w.enabled !== undefined) Q.setSetting('notify_webhook_enabled', w.enabled ? '1' : '0');
    if (w.style !== undefined) {
      if (!['slack', 'discord', 'pagerduty', 'generic'].includes(w.style)) {
        return res.status(400).json({ error: 'webhook.style invalid' });
      }
      Q.setSetting('notify_webhook_style', w.style);
    }
    if (w.url !== undefined) {
      const v = String(w.url || '').trim();
      if (v.length === 0) Q.deleteSecret('notify_webhook_url');
      else if (!/^https?:\/\//.test(v)) {
        return res.status(400).json({ error: 'webhook.url must start with http:// or https://' });
      } else Q.setSecret('notify_webhook_url', v);
    }
  }

  auth.logAudit(req, 'notifications.config_update', null, {
    fields: Object.keys(body),
  });

  res.json(currentConfig());
});

// POST /notifications/test/:channel — fire a test message to one channel
// Honors min_severity bypass via { force: true }.
router.post('/notifications/test/:channel', auth.requireAdmin, async (req, res) => {
  const channel = req.params.channel;
  if (!['telegram', 'email', 'webhook'].includes(channel)) {
    return res.status(400).json({ error: 'unknown_channel' });
  }
  const result = await notifications.notify({
    title: 'frutero test notification',
    body: `This is a test from your frutero chamber sent at ${new Date().toISOString()}. If you see this, ${channel} is wired correctly.`,
    severity: 'info',
    channels: [channel],
    force: true,
  });
  const r = (result.sent || [])[0];
  if (r?.ok) {
    auth.logAudit(req, 'notifications.test_ok', null, { channel });
    return res.json({ ok: true, channel });
  }
  auth.logAudit(req, 'notifications.test_fail', null, { channel, reason: r?.reason });
  return res.status(400).json({
    ok: false,
    channel,
    reason: r?.reason || 'unknown',
    detail: r?.detail || null,
    skipped: r?.skipped || false,
  });
});

module.exports = router;
