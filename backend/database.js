const Database = require('better-sqlite3');
const config = require('./config');

let db;

function init() {
  db = new Database(config.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      temperature REAL,
      humidity REAL,
      simulated INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp);

    CREATE TABLE IF NOT EXISTS device_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      device TEXT NOT NULL,
      state INTEGER NOT NULL,
      trigger TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_device_log_timestamp ON device_log(timestamp);

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device TEXT NOT NULL,
      action TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      label TEXT
    );

    CREATE TABLE IF NOT EXISTS alert_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric TEXT UNIQUE NOT NULL,
      min_value REAL,
      max_value REAL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      metric TEXT NOT NULL,
      value REAL,
      threshold REAL,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  seedIfEmpty();
}

function seedIfEmpty() {
  const seeded = db.prepare('SELECT value FROM settings WHERE key = ?').get('seeded');
  if (seeded) return;

  const insertSchedule = db.prepare(
    'INSERT INTO schedules (device, action, cron_expression, enabled, label) VALUES (?, ?, ?, 1, ?)'
  );
  insertSchedule.run('light', 'on', config.LIGHT_ON_TIME, 'Lights ON (6:00 AM)');
  insertSchedule.run('light', 'off', config.LIGHT_OFF_TIME, 'Lights OFF (6:00 PM)');
  insertSchedule.run(
    'fan',
    'on',
    `*/${config.FAN_CYCLE_INTERVAL} * * * *`,
    `Fan cycle (every ${config.FAN_CYCLE_INTERVAL}min for ${config.FAN_ON_DURATION}s)`
  );

  const insertAlert = db.prepare(
    'INSERT INTO alert_config (metric, min_value, max_value, enabled) VALUES (?, ?, ?, 1)'
  );
  insertAlert.run('temperature', config.TEMP_MIN, config.TEMP_MAX);
  insertAlert.run('humidity', config.HUMID_MIN, config.HUMID_MAX);

  const putSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  putSetting.run('fan_on_duration', String(config.FAN_ON_DURATION));
  putSetting.run('fan_cycle_interval', String(config.FAN_CYCLE_INTERVAL));
  putSetting.run('species', '');
  putSetting.run('seeded', '1');
}

function getDb() {
  if (!db) throw new Error('Database not initialized; call init() first');
  return db;
}

const Q = {
  insertReading(temperature, humidity, simulated) {
    return getDb()
      .prepare('INSERT INTO readings (temperature, humidity, simulated) VALUES (?, ?, ?)')
      .run(temperature, humidity, simulated ? 1 : 0);
  },

  getReadings(hours) {
    return getDb()
      .prepare(
        `SELECT id, timestamp, temperature, humidity, simulated
         FROM readings
         WHERE timestamp >= datetime('now', ?)
         ORDER BY timestamp ASC`
      )
      .all(`-${hours} hours`);
  },

  getReadingStats(hours) {
    return getDb()
      .prepare(
        `SELECT
           MIN(temperature) AS temp_min, MAX(temperature) AS temp_max,
           MIN(humidity) AS humid_min, MAX(humidity) AS humid_max,
           COUNT(*) AS count
         FROM readings
         WHERE timestamp >= datetime('now', ?)`
      )
      .get(`-${hours} hours`);
  },

  insertDeviceLog(device, state, trigger) {
    return getDb()
      .prepare('INSERT INTO device_log (device, state, trigger) VALUES (?, ?, ?)')
      .run(device, state ? 1 : 0, trigger);
  },

  getDeviceLog(limit) {
    return getDb()
      .prepare(
        `SELECT id, timestamp, device, state, trigger
         FROM device_log
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(limit);
  },

  listSchedules() {
    return getDb()
      .prepare('SELECT id, device, action, cron_expression, enabled, label FROM schedules ORDER BY id')
      .all();
  },

  listEnabledSchedules() {
    return getDb()
      .prepare(
        'SELECT id, device, action, cron_expression, enabled, label FROM schedules WHERE enabled = 1'
      )
      .all();
  },

  insertSchedule(s) {
    return getDb()
      .prepare(
        'INSERT INTO schedules (device, action, cron_expression, enabled, label) VALUES (?, ?, ?, ?, ?)'
      )
      .run(s.device, s.action, s.cron_expression, s.enabled ? 1 : 0, s.label || null);
  },

  updateSchedule(id, fields) {
    const sets = [];
    const vals = [];
    if (fields.enabled !== undefined) {
      sets.push('enabled = ?');
      vals.push(fields.enabled ? 1 : 0);
    }
    if (fields.cron_expression !== undefined) {
      sets.push('cron_expression = ?');
      vals.push(fields.cron_expression);
    }
    if (fields.label !== undefined) {
      sets.push('label = ?');
      vals.push(fields.label);
    }
    if (fields.action !== undefined) {
      sets.push('action = ?');
      vals.push(fields.action);
    }
    if (fields.device !== undefined) {
      sets.push('device = ?');
      vals.push(fields.device);
    }
    if (sets.length === 0) return { changes: 0 };
    vals.push(id);
    return getDb()
      .prepare(`UPDATE schedules SET ${sets.join(', ')} WHERE id = ?`)
      .run(...vals);
  },

  getSchedule(id) {
    return getDb()
      .prepare('SELECT id, device, action, cron_expression, enabled, label FROM schedules WHERE id = ?')
      .get(id);
  },

  deleteSchedule(id) {
    return getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id);
  },

  getAlertConfig() {
    return getDb()
      .prepare('SELECT metric, min_value, max_value, enabled FROM alert_config')
      .all();
  },

  upsertAlertConfig(metric, min_value, max_value, enabled) {
    return getDb()
      .prepare(
        `INSERT INTO alert_config (metric, min_value, max_value, enabled)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(metric) DO UPDATE SET
           min_value = excluded.min_value,
           max_value = excluded.max_value,
           enabled = excluded.enabled`
      )
      .run(metric, min_value, max_value, enabled ? 1 : 0);
  },

  insertAlertHistory(metric, value, threshold, message) {
    return getDb()
      .prepare(
        'INSERT INTO alert_history (metric, value, threshold, message) VALUES (?, ?, ?, ?)'
      )
      .run(metric, value, threshold, message);
  },

  getAlertHistory(limit) {
    return getDb()
      .prepare(
        'SELECT id, timestamp, metric, value, threshold, message FROM alert_history ORDER BY timestamp DESC LIMIT ?'
      )
      .all(limit);
  },

  getAllSettings() {
    const rows = getDb().prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  },

  setSetting(key, value) {
    return getDb()
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, String(value));
  },
};

module.exports = { init, getDb, Q };
