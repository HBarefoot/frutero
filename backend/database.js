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

    -- Owner-issued password reset tokens. Single-use, 72h TTL, consumed
    -- when the user sets a new password via /reset/:token.
    CREATE TABLE IF NOT EXISTS password_resets (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      used_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

    -- Key/value store for server-generated secrets that must persist across
    -- restarts: token pepper (HMAC key for hashing invites + reset tokens),
    -- migration markers, future TLS key fingerprints, etc. Never exposed
    -- over any API surface.
    CREATE TABLE IF NOT EXISTS secrets (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Client-side render errors reported by the React ErrorBoundary.
    -- Read on the Security page so owners can spot regressions without
    -- having to ask the user to open devtools.
    CREATE TABLE IF NOT EXISTS client_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      path TEXT,
      message TEXT NOT NULL,
      stack TEXT,
      scope TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_client_errors_timestamp ON client_errors(timestamp);

    -- Generic actuator registry. Replaces hardcoded fan/light pin config.
    -- key is referenced by schedules.device and device_log.device.
    CREATE TABLE IF NOT EXISTS actuators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      gpio_pin INTEGER NOT NULL,
      inverted INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_off_seconds INTEGER,
      config TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Additive migration: add user_id to device_log for attribution on
  // existing installs where the column didn't originally exist.
  ensureColumn('device_log', 'user_id', 'INTEGER REFERENCES users(id)');

  seedIfEmpty();
  seedActuatorsIfEmpty();
  ensureTokenPepper();
  migrateTokenHashesIfNeeded();
}

const crypto = require('node:crypto');

// Generates (once) a 32-byte pepper used to HMAC invite + reset tokens at
// rest. Stored in the secrets table so restarts preserve the ability to
// verify existing hashes. Never leaves the backend.
function ensureTokenPepper() {
  const row = db.prepare('SELECT value FROM secrets WHERE key = ?').get('token_pepper');
  if (row) return;
  const pepper = crypto.randomBytes(32).toString('base64');
  db.prepare('INSERT INTO secrets (key, value) VALUES (?, ?)').run('token_pepper', pepper);
}

function getTokenPepper() {
  const row = db.prepare('SELECT value FROM secrets WHERE key = ?').get('token_pepper');
  return row ? row.value : null;
}

// Deterministic at-rest hash: HMAC-SHA256 keyed by the server's pepper.
// Same plaintext always produces the same hash, so we can index + look
// up by hash in O(1). Pepper keeps rainbow tables useless even if the
// DB file is exfiltrated.
function hmacToken(plaintext) {
  const pepper = getTokenPepper();
  if (!pepper) throw new Error('token_pepper not initialized');
  return crypto.createHmac('sha256', pepper).update(plaintext).digest('hex');
}

// One-time migration that walks the invites + password_resets tables and
// replaces any plaintext tokens with their HMAC. Detection heuristic:
// tokens stored as plaintext are 32 bytes base64url-encoded (~43 chars),
// while our HMAC output is 64 hex chars. Anything !== 64 chars is legacy.
// Wrapped in a transaction so partial failure rolls back. The
// 'tokens_hashed_v1' marker prevents re-running on subsequent boots.
function migrateTokenHashesIfNeeded() {
  const done = db.prepare('SELECT value FROM secrets WHERE key = ?').get('tokens_hashed_v1');
  if (done && done.value === '1') return;

  const txn = db.transaction(() => {
    const invites = db.prepare('SELECT token FROM invites WHERE length(token) != 64').all();
    const updateInvite = db.prepare('UPDATE invites SET token = ? WHERE token = ?');
    for (const r of invites) updateInvite.run(hmacToken(r.token), r.token);

    const resets = db.prepare('SELECT token FROM password_resets WHERE length(token) != 64').all();
    const updateReset = db.prepare('UPDATE password_resets SET token = ? WHERE token = ?');
    for (const r of resets) updateReset.run(hmacToken(r.token), r.token);

    db.prepare('INSERT OR REPLACE INTO secrets (key, value) VALUES (?, ?)')
      .run('tokens_hashed_v1', '1');

    if (invites.length || resets.length) {
      console.log(
        `[migrate] hashed at-rest: ${invites.length} invite(s), ${resets.length} reset(s)`
      );
    }
  });
  txn();
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

// Seeds default actuators (fan, light) so an upgraded install with an empty
// actuators table behaves identically to the pre-Phase-3 hardcoded behavior.
// Runs whenever the table is empty (not gated on the 'seeded' flag), so
// existing prod installs get their defaults on first restart with new code.
function seedActuatorsIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM actuators').get().n;
  if (n > 0) return;

  const insert = db.prepare(
    `INSERT INTO actuators (key, name, kind, gpio_pin, inverted, enabled, auto_off_seconds)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  );
  insert.run('fan', 'Fans', 'fan', config.FAN_PIN, config.FAN_INVERTED ? 1 : 0, config.FAN_ON_DURATION);
  insert.run('light', 'Grow Lights', 'light', config.LIGHT_PIN, config.LIGHT_INVERTED ? 1 : 0, null);
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

  updateUserName(id, name) {
    return getDb()
      .prepare('UPDATE users SET name = ? WHERE id = ?')
      .run(name, id);
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

  listSessionsForUser(user_id) {
    return getDb()
      .prepare(
        `SELECT token, created_at, expires_at, last_seen_at, ip, user_agent
         FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`
      )
      .all(user_id);
  },

  // All non-expired sessions across users, joined with user info.
  // Used by the owner-only Security page.
  listAllActiveSessions() {
    return getDb()
      .prepare(
        `SELECT s.token, s.user_id, s.created_at, s.expires_at,
                s.last_seen_at, s.ip, s.user_agent,
                u.email AS user_email, u.name AS user_name, u.role AS user_role
         FROM sessions s
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.expires_at > CURRENT_TIMESTAMP
         ORDER BY s.last_seen_at DESC`
      )
      .all();
  },

  countLegacyPlaintextInvites() {
    return getDb()
      .prepare('SELECT COUNT(*) AS n FROM invites WHERE length(token) != 64 AND accepted_at IS NULL')
      .get().n;
  },

  countLegacyPlaintextResets() {
    return getDb()
      .prepare('SELECT COUNT(*) AS n FROM password_resets WHERE length(token) != 64 AND used_at IS NULL')
      .get().n;
  },

  // Client-side error log (written by /api/client-errors, read by the
  // owner Security page).
  insertClientError({ user_id, path, message, stack, scope, user_agent }) {
    return getDb()
      .prepare(
        `INSERT INTO client_errors (user_id, path, message, stack, scope, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(user_id || null, path || null, message, stack || null, scope || null, user_agent || null);
  },

  listClientErrors(limit) {
    return getDb()
      .prepare(
        `SELECT ce.id, ce.timestamp, ce.user_id, ce.path, ce.message,
                ce.stack, ce.scope, ce.user_agent,
                u.email AS user_email, u.name AS user_name
         FROM client_errors ce
         LEFT JOIN users u ON u.id = ce.user_id
         ORDER BY ce.timestamp DESC
         LIMIT ?`
      )
      .all(limit);
  },

  countRecentClientErrors(hours = 24) {
    return getDb()
      .prepare(`SELECT COUNT(*) AS n FROM client_errors WHERE timestamp >= datetime('now', ?)`)
      .get(`-${hours} hours`).n;
  },

  deleteSessionsForUserExcept(user_id, keepToken) {
    return getDb()
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?')
      .run(user_id, keepToken);
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

  // Password resets -------------------------------------------------
  insertPasswordReset({ token, user_id, issued_by, expires_at }) {
    return getDb()
      .prepare(
        'INSERT INTO password_resets (token, user_id, issued_by, expires_at) VALUES (?, ?, ?, ?)'
      )
      .run(token, user_id, issued_by, expires_at);
  },

  /** Reset is valid iff not used and not expired. */
  findPendingReset(token) {
    return getDb()
      .prepare(
        `SELECT pr.token, pr.user_id, pr.expires_at,
                u.email, u.name
         FROM password_resets pr
         JOIN users u ON u.id = pr.user_id
         WHERE pr.token = ?
           AND pr.used_at IS NULL
           AND pr.expires_at > CURRENT_TIMESTAMP
           AND u.disabled = 0`
      )
      .get(token);
  },

  markResetUsed(token) {
    return getDb()
      .prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE token = ?')
      .run(token);
  },

  /** Invalidate every outstanding reset for a user (call on password change). */
  deleteResetsForUser(user_id) {
    return getDb()
      .prepare('DELETE FROM password_resets WHERE user_id = ?')
      .run(user_id);
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

  // Actuators -------------------------------------------------------
  listActuators() {
    return getDb()
      .prepare(
        `SELECT id, key, name, kind, gpio_pin, inverted, enabled,
                auto_off_seconds, config, created_at
         FROM actuators ORDER BY id ASC`
      )
      .all();
  },

  findActuator(key) {
    return getDb()
      .prepare(
        `SELECT id, key, name, kind, gpio_pin, inverted, enabled,
                auto_off_seconds, config, created_at
         FROM actuators WHERE key = ?`
      )
      .get(key);
  },

  findActuatorByPin(gpio_pin) {
    return getDb()
      .prepare('SELECT key, name FROM actuators WHERE gpio_pin = ?')
      .get(gpio_pin);
  },

  insertActuator({ key, name, kind, gpio_pin, inverted, enabled, auto_off_seconds, config }) {
    return getDb()
      .prepare(
        `INSERT INTO actuators (key, name, kind, gpio_pin, inverted, enabled, auto_off_seconds, config)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        key,
        name,
        kind,
        gpio_pin,
        inverted ? 1 : 0,
        enabled === false ? 0 : 1,
        auto_off_seconds == null ? null : Number(auto_off_seconds),
        config ? (typeof config === 'string' ? config : JSON.stringify(config)) : null
      );
  },

  updateActuator(key, fields) {
    const sets = [];
    const vals = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.kind !== undefined) { sets.push('kind = ?'); vals.push(fields.kind); }
    if (fields.gpio_pin !== undefined) { sets.push('gpio_pin = ?'); vals.push(Number(fields.gpio_pin)); }
    if (fields.inverted !== undefined) { sets.push('inverted = ?'); vals.push(fields.inverted ? 1 : 0); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); vals.push(fields.enabled ? 1 : 0); }
    if (fields.auto_off_seconds !== undefined) {
      sets.push('auto_off_seconds = ?');
      vals.push(fields.auto_off_seconds == null ? null : Number(fields.auto_off_seconds));
    }
    if (fields.config !== undefined) {
      sets.push('config = ?');
      vals.push(fields.config == null ? null : (typeof fields.config === 'string' ? fields.config : JSON.stringify(fields.config)));
    }
    if (sets.length === 0) return { changes: 0 };
    vals.push(key);
    return getDb()
      .prepare(`UPDATE actuators SET ${sets.join(', ')} WHERE key = ?`)
      .run(...vals);
  },

  deleteActuator(key) {
    return getDb().prepare('DELETE FROM actuators WHERE key = ?').run(key);
  },

  countSchedulesForDevice(device) {
    return getDb()
      .prepare('SELECT COUNT(*) AS n FROM schedules WHERE device = ?')
      .get(device).n;
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

module.exports = { init, getDb, Q, hmacToken };
