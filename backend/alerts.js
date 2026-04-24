const config = require('./config');
const ws = require('./ws');
const { Q } = require('./database');
const notifications = require('./notifications');

const lastAlertAt = new Map(); // key: `${metric}:${side}` → timestamp ms

function metricValue(reading, metric) {
  return metric === 'temperature' ? reading.temperature : reading.humidity;
}

function check(reading) {
  const configs = Q.getAlertConfig();
  for (const cfg of configs) {
    if (!cfg.enabled) continue;
    const value = metricValue(reading, cfg.metric);
    if (value == null) continue;

    if (cfg.min_value != null && value < cfg.min_value) {
      fire(cfg.metric, 'low', value, cfg.min_value);
    } else if (cfg.max_value != null && value > cfg.max_value) {
      fire(cfg.metric, 'high', value, cfg.max_value);
    }
  }
}

function fire(metric, side, value, threshold) {
  const key = `${metric}:${side}`;
  const now = Date.now();
  const last = lastAlertAt.get(key) || 0;
  if (now - last < config.ALERT_DEBOUNCE_MS) return;
  lastAlertAt.set(key, now);

  const unit = metric === 'temperature' ? '°F' : '%';
  const message =
    side === 'low'
      ? `${metric} ${value}${unit} below minimum ${threshold}${unit}`
      : `${metric} ${value}${unit} above maximum ${threshold}${unit}`;

  try {
    Q.insertAlertHistory(metric, value, threshold, message);
  } catch (err) {
    console.error('[alerts] history insert failed:', err);
  }

  ws.broadcast({
    type: 'alert',
    data: { metric, side, value, threshold, message, timestamp: new Date().toISOString() },
  });

  notifications
    .notify({
      title: `${metric} ${side === 'low' ? 'below minimum' : 'above maximum'}`,
      body: message,
      severity: 'warn',
    })
    .catch((err) => console.error('[alerts] notify failed:', err));
}

// Fire-and-forget Telegram notification. Reads settings on each call so the
// operator can enable/reconfigure without a server restart. Swallows all
// network errors — alerting about an alerting failure isn't useful.
async function sendTelegram(message) {
  try {
    const s = Q.getAllSettings();
    if (s.telegram_enabled !== '1') return { sent: false, reason: 'disabled' };
    const token = (s.telegram_bot_token || '').trim();
    const chatId = (s.telegram_chat_id || '').trim();
    if (!token || !chatId) return { sent: false, reason: 'missing_config' };

    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message }),
        signal: controller.signal,
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        console.error('[alerts] telegram non-2xx:', r.status, body.slice(0, 200));
        return { sent: false, reason: `http_${r.status}` };
      }
      return { sent: true };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error('[alerts] telegram send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

// Sensor silence alert: distinct key from temp/humidity so its debounce
// doesn't collide. Thirty-minute debounce means we don't spam the
// grower every minute while the sensor is dead — one alert, then quiet
// until the situation resolves or 30 min elapses.
const SILENCE_DEBOUNCE_MS = 30 * 60 * 1000;

function fireSilence(silentSeconds) {
  const key = 'sensor:silence';
  const now = Date.now();
  const last = lastAlertAt.get(key) || 0;
  if (now - last < SILENCE_DEBOUNCE_MS) return;
  lastAlertAt.set(key, now);

  const minutes = Math.floor(silentSeconds / 60);
  const message = `sensor silent for ${minutes}m — humidity automation suspended`;

  try {
    Q.insertAlertHistory('sensor', null, null, message);
  } catch (err) {
    console.error('[alerts] silence history insert failed:', err);
  }

  ws.broadcast({
    type: 'alert',
    data: {
      metric: 'sensor',
      side: 'silence',
      value: null,
      threshold: null,
      message,
      timestamp: new Date().toISOString(),
    },
  });

  notifications
    .notify({
      title: 'Sensor silent',
      body: message,
      severity: 'warn',
    })
    .catch((err) => console.error('[alerts] notify silence failed:', err));
}

function recent(limit = 10) {
  return Q.getAlertHistory(limit);
}

module.exports = { check, fireSilence, recent, sendTelegram };
