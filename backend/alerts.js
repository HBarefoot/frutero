const config = require('./config');
const ws = require('./ws');
const { Q } = require('./database');

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

  sendTelegram(message);
}

function sendTelegram(_message) {
  // TODO: wire Telegram bot token from settings when operator enables it.
}

function recent(limit = 10) {
  return Q.getAlertHistory(limit);
}

module.exports = { check, recent, sendTelegram };
