const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Q } = require('./database');

const SESSION_COOKIE = 'frutero_session';
const SESSION_TTL_DAYS = 30;
const SESSION_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;       // refresh expiry if within 1d
const INVITE_TTL_HOURS = 72;
const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 10;

// Simple in-memory IP-based failed-login throttle.
//   5 consecutive failures → 15 min lockout.
// Not a full rate limiter; a reverse proxy (nginx) should be authoritative
// once we're deployed behind one. Resets on server restart.
const FAILS = new Map();
const FAIL_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const ROLES = ['owner', 'operator', 'viewer'];

const PERMISSIONS = {
  // Mutations on devices/schedules/alerts/settings
  mutate: ['owner', 'operator'],
  // Reading sensors, status, alerts, audit
  read: ['owner', 'operator', 'viewer'],
  // Managing users + invites + revoking sessions
  admin: ['owner'],
};

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function newSessionExpiry() {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
}

function newInviteExpiry() {
  return new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
}

function createSession(user, req) {
  const token = generateToken(32);
  const expires_at = newSessionExpiry();
  Q.insertSession({
    token,
    user_id: user.id,
    expires_at,
    ip: ipOf(req),
    user_agent: req.headers['user-agent'] || null,
  });
  Q.markUserLogin(user.id);
  return { token, expires_at };
}

/**
 * Returns { session, user } if the request has a valid session cookie,
 * otherwise null. Sliding expiration: if the session is within
 * SESSION_REFRESH_WINDOW_MS of expiry, push it out to a full TTL.
 */
function resolveSession(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;

  const row = Q.findSessionWithUser(token);
  if (!row) return null;

  // Slide the session expiry forward on active use.
  const expiresMs = new Date(row.expires_at + 'Z').getTime();
  const remaining = expiresMs - Date.now();
  if (remaining < SESSION_REFRESH_WINDOW_MS) {
    Q.touchSession(token, newSessionExpiry());
  }

  return {
    token,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
    },
  };
}

function revokeSession(token) {
  Q.deleteSession(token);
}

/**
 * Resolve a session from a raw cookie-header string (for WS upgrade,
 * which doesn't go through cookie-parser middleware).
 */
function resolveSessionFromHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const token = parseCookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const row = Q.findSessionWithUser(token);
  if (!row) return null;
  return {
    token,
    user: { id: row.user_id, email: row.email, name: row.name, role: row.role },
  };
}

function parseCookieValue(header, name) {
  const parts = header.split(/;\s*/);
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    if (p.slice(0, i) === name) {
      try {
        return decodeURIComponent(p.slice(i + 1));
      } catch {
        return p.slice(i + 1);
      }
    }
  }
  return null;
}

function ipOf(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

function setSessionCookie(res, token, secure) {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!secure,
    path: '/',
    maxAge,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' });
}

// --- Throttle ---------------------------------------------------------

function isThrottled(ip) {
  if (!ip) return false;
  const entry = FAILS.get(ip);
  if (!entry) return false;
  if (entry.count < FAIL_THRESHOLD) return false;
  if (Date.now() - entry.lastAt > LOCKOUT_MS) {
    FAILS.delete(ip);
    return false;
  }
  return true;
}

function recordFail(ip) {
  if (!ip) return;
  const entry = FAILS.get(ip) || { count: 0, lastAt: 0 };
  entry.count += 1;
  entry.lastAt = Date.now();
  FAILS.set(ip, entry);
}

function resetFails(ip) {
  if (ip) FAILS.delete(ip);
}

// --- Middleware -------------------------------------------------------

/**
 * Attaches req.user if authenticated. Never rejects — use requireAuth
 * or requirePermission to gate individual routes.
 */
function attachUser(req, _res, next) {
  const sess = resolveSession(req);
  if (sess) {
    req.user = sess.user;
    req.sessionToken = sess.token;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  next();
}

function requirePermission(permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) throw new Error(`Unknown permission: ${permission}`);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', required: permission });
    }
    next();
  };
}

/** Convenience middleware for 'admin' permission. */
const requireAdmin = requirePermission('admin');
/** Convenience middleware for 'mutate' permission. */
const requireMutate = requirePermission('mutate');

/**
 * Used for the setup wizard. Rejects if any users already exist, so
 * first-run routes become unavailable after the owner is created.
 */
function requireFirstRun(_req, res, next) {
  if (Q.countUsers() > 0) {
    return res.status(409).json({ error: 'already_initialized' });
  }
  next();
}

// --- Audit helpers ----------------------------------------------------

function logAudit(req, action, target, detail) {
  try {
    Q.insertAudit({
      user_id: req?.user?.id || null,
      action,
      target,
      detail,
      ip: ipOf(req),
    });
  } catch (err) {
    console.error('[auth] audit log insert failed:', err);
  }
}

// --- Validation -------------------------------------------------------

function validateEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 3 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function validatePassword(pw) {
  if (typeof pw !== 'string') return 'password must be a string';
  if (pw.length < MIN_PASSWORD_LENGTH)
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (pw.length > 256) return 'password too long';
  return null;
}

function validateRole(role) {
  return ROLES.includes(role);
}

// --- Periodic cleanup -------------------------------------------------

function startSessionJanitor(intervalMs = 60 * 60 * 1000) {
  const timer = setInterval(() => {
    try {
      Q.pruneExpiredSessions();
    } catch (err) {
      console.error('[auth] session prune failed:', err);
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = {
  // constants / config
  SESSION_COOKIE,
  MIN_PASSWORD_LENGTH,
  INVITE_TTL_HOURS,
  ROLES,
  PERMISSIONS,

  // password
  hashPassword,
  verifyPassword,

  // session
  createSession,
  resolveSession,
  resolveSessionFromHeader,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
  newInviteExpiry,
  generateToken,

  // throttle
  isThrottled,
  recordFail,
  resetFails,

  // middleware
  attachUser,
  requireAuth,
  requirePermission,
  requireAdmin,
  requireMutate,
  requireFirstRun,

  // helpers
  ipOf,
  logAudit,
  validateEmail,
  validatePassword,
  validateRole,

  // lifecycle
  startSessionJanitor,
};
