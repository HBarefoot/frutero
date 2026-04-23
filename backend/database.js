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

    -- Auth + multi-user -------------------------------------------------
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','operator','viewer')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME,
      disabled INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE,
      role TEXT NOT NULL CHECK(role IN ('owner','operator','viewer')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      accepted_at DATETIME,
      accepted_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      ip TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
  `);

  // Additive migration: add user_id to device_log for attribution on
  // existing installs where the column didn't originally exist.
  ensureColumn('device_log', 'user_id', 'INTEGER REFERENCES users(id)');

  seedIfEmpty();
}

function ensureColumn(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
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

  insertDeviceLog(device, state, trigger, userId = null) {
    return getDb()
      .prepare(
        'INSERT INTO device_log (device, state, trigger, user_id) VALUES (?, ?, ?, ?)'
      )
      .run(device, state ? 1 : 0, trigger, userId);
  },

  getDeviceLog(limit) {
    return getDb()
      .prepare(
        `SELECT dl.id, dl.timestamp, dl.device, dl.state, dl.trigger,
                dl.user_id, u.name AS user_name, u.email AS user_email
         FROM device_log dl
         LEFT JOIN users u ON u.id = dl.user_id
         ORDER BY dl.timestamp DESC
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

  // Users ------------------------------------------------------------
  countUsers() {
    return getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
  },

  findUserByEmail(email) {
    return getDb()
      .prepare(
        'SELECT id, email, name, password_hash, role, disabled, created_at, last_login_at FROM users WHERE email = ?'
      )
      .get(email);
  },

  findUserById(id) {
    return getDb()
      .prepare(
        'SELECT id, email, name, role, disabled, created_at, last_login_at FROM users WHERE id = ?'
      )
      .get(id);
  },

  listUsers() {
    return getDb()
      .prepare(
        `SELECT id, email, name, role, disabled, created_at, last_login_at
         FROM users ORDER BY created_at ASC`
      )
      .all();
  },

  insertUser({ email, name, password_hash, role }) {
    return getDb()
      .prepare(
        'INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)'
      )
      .run(email, name, password_hash, role);
  },

  updateUserRole(id, role) {
    return getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  },

  updateUserPassword(id, password_hash) {
    return getDb()
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(password_hash, id);
  },

  updateUserDisabled(id, disabled) {
    return getDb()
      .prepare('UPDATE users SET disabled = ? WHERE id = ?')
      .run(disabled ? 1 : 0, id);
  },

  markUserLogin(id) {
    return getDb()
      .prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(id);
  },

  deleteUser(id) {
    return getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  },

  // Sessions ---------------------------------------------------------
  insertSession({ token, user_id, expires_at, ip, user_agent }) {
    return getDb()
      .prepare(
        'INSERT INTO sessions (token, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)'
      )
      .run(token, user_id, expires_at, ip || null, user_agent || null);
  },

  /** Returns the session + user if token is valid + not expired + user active. */
  findSessionWithUser(token) {
    return getDb()
      .prepare(
        `SELECT s.token, s.user_id, s.expires_at, s.last_seen_at,
                u.email, u.name, u.role, u.disabled
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ?
           AND s.expires_at > CURRENT_TIMESTAMP
           AND u.disabled = 0`
      )
      .get(token);
  },

  touchSession(token, expires_at) {
    return getDb()
      .prepare(
        'UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP, expires_at = ? WHERE token = ?'
      )
      .run(expires_at, token);
  },

  deleteSession(token) {
    return getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },

  deleteSessionsForUser(user_id) {
    return getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
  },

  pruneExpiredSessions() {
    return getDb()
      .prepare('DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP')
      .run();
  },

  // Invites ----------------------------------------------------------
  insertInvite({ token, email, role, created_by, expires_at }) {
    return getDb()
      .prepare(
        'INSERT INTO invites (token, email, role, created_by, expires_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(token, email, role, created_by, expires_at);
  },

  /** Pending invite (not accepted + not expired). */
  findPendingInvite(token) {
    return getDb()
      .prepare(
        `SELECT token, email, role, created_by, expires_at
         FROM invites
         WHERE token = ?
           AND accepted_at IS NULL
           AND expires_at > CURRENT_TIMESTAMP`
      )
      .get(token);
  },

  acceptInvite(token, accepted_by) {
    return getDb()
      .prepare(
        'UPDATE invites SET accepted_at = CURRENT_TIMESTAMP, accepted_by = ? WHERE token = ?'
      )
      .run(accepted_by, token);
  },

  listPendingInvites() {
    return getDb()
      .prepare(
        `SELECT token, email, role, created_by, created_at, expires_at
         FROM invites
         WHERE accepted_at IS NULL AND expires_at > CURRENT_TIMESTAMP
         ORDER BY created_at DESC`
      )
      .all();
  },

  deleteInvite(token) {
    return getDb().prepare('DELETE FROM invites WHERE token = ?').run(token);
  },

  // Audit log --------------------------------------------------------
  insertAudit({ user_id, action, target, detail, ip }) {
    return getDb()
      .prepare(
        'INSERT INTO audit_log (user_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        user_id || null,
        action,
        target || null,
        detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
        ip || null
      );
  },

  listAudit(limit = 100) {
    return getDb()
      .prepare(
        `SELECT a.id, a.timestamp, a.action, a.target, a.detail, a.ip,
                a.user_id, u.name AS user_name, u.email AS user_email
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.timestamp DESC
         LIMIT ?`
      )
      .all(limit);
  },
};

module.exports = { init, getDb, Q };
