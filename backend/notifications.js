const nodemailer = require('nodemailer');
const { Q } = require('./database');

// Unified outbound notification layer. Alerts (temp/humidity/sensor-
// silence) and warn-severity AI insights both call notify() here; it
// fans out to every enabled channel (Telegram, SMTP email, webhook)
// and collects per-channel results so the UI can surface partial
// failures.
//
// Configuration lives in the settings + secrets tables:
//   notify_telegram_enabled ('1'|'0')
//   telegram_bot_token      (secret) — kept for back-compat with the
//   telegram_chat_id        (setting)  pre-7f Telegram integration.
//   notify_email_enabled    ('1'|'0')
//   notify_email_host / _port / _secure / _user / _from / _to
//   notify_email_password   (secret)
//   notify_webhook_enabled  ('1'|'0')
//   notify_webhook_style    ('slack' | 'discord' | 'pagerduty' | 'generic')
//   notify_webhook_url      (secret)
//   notify_min_severity     ('info' | 'warn') — default 'info'

const SEVERITY_RANK = { info: 1, warn: 2 };

function shouldSend(severity) {
  const s = Q.getAllSettings();
  const min = s.notify_min_severity || 'info';
  return (SEVERITY_RANK[severity] || 1) >= (SEVERITY_RANK[min] || 1);
}

// --- Telegram --------------------------------------------------------
// Same flow as the pre-7f implementation in alerts.js; moved here so
// every channel goes through one front door. Kept setting key names
// for back-compat with existing installs.
async function sendTelegram({ title, body }) {
  const s = Q.getAllSettings();
  if (s.notify_telegram_enabled !== '1' && s.telegram_enabled !== '1') {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const token = (Q.getSecret('telegram_bot_token') || s.telegram_bot_token || '').trim();
  const chatId = (s.telegram_chat_id || '').trim();
  if (!token || !chatId) return { ok: false, skipped: true, reason: 'missing_config' };

  const text = title ? `*${title}*\n${body}` : body;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      }
    );
    if (!r.ok) {
      const b = await r.text().catch(() => '');
      return { ok: false, reason: `http_${r.status}`, detail: b.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// --- SMTP email ------------------------------------------------------
async function sendEmail({ title, body, severity }) {
  const s = Q.getAllSettings();
  if (s.notify_email_enabled !== '1') {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const host = s.notify_email_host;
  const port = parseInt(s.notify_email_port, 10) || 587;
  const secure = s.notify_email_secure === '1'; // true for 465, false for 587+STARTTLS
  const user = s.notify_email_user || '';
  const from = s.notify_email_from || user;
  const to = s.notify_email_to || '';
  const pass = Q.getSecret('notify_email_password') || '';

  if (!host || !from || !to) {
    return { ok: false, skipped: true, reason: 'missing_config' };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    // Short connection + socket timeouts — SMTP hangs on bad config
    // shouldn't block the alert pipeline.
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 15000,
  });

  try {
    const subject = `[frutero${severity === 'warn' ? ' · WARN' : ''}] ${title || 'Alert'}`;
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: body,
      html: renderEmailHtml({ title, body, severity }),
    });
    return { ok: true, message_id: info.messageId };
  } catch (err) {
    return { ok: false, reason: err.code || err.name, detail: err.message };
  }
}

// Transactional mail helper — lets routes send an invite/reset email
// to a specific recipient without going through the alert-oriented
// sendEmail() path (which uses the global notify_email_to). Shares the
// same SMTP transport config as alert email so there's only one place
// to set credentials.
async function sendRaw({ to, subject, text, html }) {
  const s = Q.getAllSettings();
  if (s.notify_email_enabled !== '1') {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const host = s.notify_email_host;
  const port = parseInt(s.notify_email_port, 10) || 587;
  const secure = s.notify_email_secure === '1';
  const user = s.notify_email_user || '';
  const from = s.notify_email_from || user;
  const pass = Q.getSecret('notify_email_password') || '';

  if (!host || !from || !to) {
    return { ok: false, skipped: true, reason: 'missing_config' };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 15000,
  });

  try {
    const info = await transporter.sendMail({ from, to, subject, text, html });
    return { ok: true, message_id: info.messageId };
  } catch (err) {
    return { ok: false, reason: err.code || err.name, detail: err.message };
  }
}

function renderEmailHtml({ title, body, severity }) {
  const color = severity === 'warn' ? '#b45309' : '#0f766e';
  const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0b0f14">
    <div style="border-left:3px solid ${color};padding:12px 16px;background:#f8fafc">
      <h2 style="margin:0 0 8px;color:${color};font-size:16px">${esc(title) || 'frutero alert'}</h2>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.5">${esc(body)}</div>
    </div>
    <p style="color:#64748b;font-size:11px;margin-top:16px">Sent by your frutero grow chamber · ${new Date().toISOString()}</p>
  </body></html>`;
}

// --- Web Push --------------------------------------------------------
// Fans out to every subscribed device across all users. Subscription
// management (per-user opt-in) lives in backend/push.js; this just
// delivers. Respects the global notify_push_enabled toggle.
async function sendPush({ title, body, severity, link }) {
  const s = Q.getAllSettings();
  if (s.notify_push_enabled !== '1') {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const push = require('./push'); // lazy-require — avoids pulling webpush at startup when push is off
  const r = await push.sendToAll({
    title: title || 'frutero',
    body,
    severity,
    url: link || '/',
    tag: severity === 'warn' ? 'frutero-warn' : 'frutero',
  });
  if (!r.sent || r.sent.length === 0) {
    return { ok: false, skipped: true, reason: r.reason || 'no_subscriptions' };
  }
  const okCount = r.sent.filter((x) => x.ok).length;
  return { ok: okCount > 0, delivered: okCount, total: r.sent.length };
}

// --- Webhook (Slack / Discord / PagerDuty / generic JSON) -----------
async function sendWebhook({ title, body, severity, link }) {
  const s = Q.getAllSettings();
  if (s.notify_webhook_enabled !== '1') {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const url = (Q.getSecret('notify_webhook_url') || '').trim();
  if (!url) return { ok: false, skipped: true, reason: 'missing_url' };
  const style = s.notify_webhook_style || 'generic';

  let payload;
  const text = title ? `*${title}*\n${body}` : body;
  if (style === 'slack') {
    payload = { text };
  } else if (style === 'discord') {
    // Discord respects content up to 2000 chars.
    payload = { content: text.slice(0, 1900) };
  } else if (style === 'pagerduty') {
    // PagerDuty v2 Events API — "routing_key" is the integration key
    // for an Events v2 integration on a service. We expect the URL
    // to be https://events.pagerduty.com/v2/enqueue and the routing
    // key embedded as a query param the user can set in the URL, or
    // left blank and filled here later. For v1 of this feature we
    // assume the user pastes the full URL and the integration key is
    // included in an auth header — PagerDuty's typical setup.
    payload = {
      routing_key: s.notify_pagerduty_routing_key || '',
      event_action: 'trigger',
      payload: {
        summary: title || body.slice(0, 100),
        severity: severity === 'warn' ? 'warning' : 'info',
        source: 'frutero',
        custom_details: { body, link },
      },
    };
  } else {
    payload = {
      title,
      body,
      severity,
      link,
      timestamp: new Date().toISOString(),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const b = await r.text().catch(() => '');
      return { ok: false, reason: `http_${r.status}`, detail: b.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// --- Cloud (frutero-fleet) -------------------------------------------
// Forwards urgent alerts to the cloud control plane that the operator
// can read across every chamber in their fleet. Uses the device JWT
// stored at enrollment time. Auto-derives a stable source_id when the
// caller doesn't pass one so re-fires of the same condition (e.g. a
// 30-min sensor-silence cycle) UPSERT in place rather than duplicating.
async function sendCloud({ title, body, severity, link, source_id }) {
  const s = Q.getAllSettings();
  if (s.notify_cloud_enabled !== '1') {
    return { ok: false, skipped: true, reason: 'disabled' };
  }
  const url = Q.getSecret('fleet_url');
  const jwt = Q.getSecret('fleet_jwt');
  if (!url || !jwt) {
    return { ok: false, skipped: true, reason: 'not_enrolled' };
  }

  const cloudSeverity = severity === 'warn' ? 'warn' : 'info';
  const stableSource = source_id || `${cloudSeverity}:${(title || '').slice(0, 96)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/api/devices/alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        severity: cloudSeverity,
        title: title || '(untitled)',
        body: body || null,
        link: link || null,
        source_id: stableSource,
      }),
    });
    if (r.status === 401) {
      // Cloud revoked us — clear local state so the Security card
      // prompts for re-enrollment.
      Q.deleteSecret('fleet_jwt');
      Q.deleteSecret('fleet_chamber_id');
      Q.deleteSecret('fleet_name');
      return { ok: false, reason: 'revoked_by_cloud' };
    }
    if (!r.ok) {
      const b = await r.text().catch(() => '');
      return { ok: false, reason: `http_${r.status}`, detail: b.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// --- Orchestrator ----------------------------------------------------
// msg: { title, body, severity, link?, force? }
//   severity defaults to 'info'; sub-min-severity messages are dropped
//     unless force=true (used by "Test send" buttons)
//   channels? restricts to a subset (for test-send)
//
// Returns { sent: [{channel, ok, reason?}], suppressed?: 'reason' }
async function notify(msg = {}) {
  const severity = msg.severity || 'info';
  const lazyBatches = require('./batches'); // avoid circular at load time

  if (!msg.force) {
    if (!shouldSend(severity)) {
      return { sent: [], suppressed: 'below_min_severity' };
    }
    // Per-batch muting: only applies to alerts in auto pipelines, not
    // test-sends.
    try {
      const activeId = lazyBatches.getActiveBatchId();
      if (activeId) {
        const row = Q.getBatch(activeId);
        if (row?.notifications_muted) {
          return { sent: [], suppressed: 'batch_muted' };
        }
      }
    } catch { /* no active batch or table missing on fresh install */ }
  }

  const channels = new Set(msg.channels || ['telegram', 'email', 'webhook', 'push', 'cloud']);
  const tasks = [];
  if (channels.has('telegram')) tasks.push(sendTelegram(msg).then((r) => ({ channel: 'telegram', ...r })));
  if (channels.has('email')) tasks.push(sendEmail(msg).then((r) => ({ channel: 'email', ...r })));
  if (channels.has('webhook')) tasks.push(sendWebhook(msg).then((r) => ({ channel: 'webhook', ...r })));
  if (channels.has('push')) tasks.push(sendPush(msg).then((r) => ({ channel: 'push', ...r })));
  if (channels.has('cloud')) tasks.push(sendCloud(msg).then((r) => ({ channel: 'cloud', ...r })));

  const results = await Promise.all(tasks);
  const errored = results.filter((r) => !r.ok && !r.skipped);
  if (errored.length > 0) {
    console.warn('[notify] partial failure:', errored.map((r) => `${r.channel}=${r.reason}`).join(', '));
  }
  return { sent: results };
}

module.exports = { notify, sendTelegram, sendEmail, sendWebhook, sendRaw, sendPush, sendCloud };
