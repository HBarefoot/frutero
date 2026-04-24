const express = require('express');
const { UAParser } = require('ua-parser-js');
const auth = require('../auth');
const hardware = require('../hardware');
const { Q, hmacToken } = require('../database');
const {
  loginThrottle,
  registerThrottle,
  resetThrottle,
  inviteAcceptThrottle,
  throttleMiddleware,
} = require('../throttle');

const router = express.Router();

const byIp = { extract: (req) => auth.ipOf(req) };

// First-run-only hardware scan — lets the setup wizard show what the Pi
// detected before any owner account exists. Locks itself after the first
// user is created (requireFirstRun returns 409 from then on).
router.get('/setup/hardware-scan', auth.requireFirstRun, (_req, res) => {
  try {
    res.json(hardware.scanAll());
  } catch (err) {
    console.error('[setup] hardware scan failed:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Returns basic setup state so the unauthenticated frontend knows which
 * screen to show first (setup wizard vs login).
 */
router.get('/auth/bootstrap', (req, res) => {
  const userCount = Q.countUsers();
  const current = req.user || null;
  res.json({
    needsSetup: userCount === 0,
    user: current,
  });
});

/**
 * First-run endpoint. Creates the initial owner account. Available only
 * while no users exist; returns 409 otherwise.
 */
router.post('/auth/setup',
  throttleMiddleware(registerThrottle, byIp),
  auth.requireFirstRun,
  async (req, res) => {
  const { email, name, password } = req.body || {};

  if (!auth.validateEmail(email))
    return res.status(400).json({ error: 'invalid_email' });
  if (!name || typeof name !== 'string' || name.trim().length < 1)
    return res.status(400).json({ error: 'invalid_name' });
  const pwErr = auth.validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  try {
    const password_hash = await auth.hashPassword(password);
    const out = Q.insertUser({
      email: email.trim(),
      name: name.trim(),
      password_hash,
      role: 'owner',
    });
    const user = Q.findUserById(out.lastInsertRowid);
    const { token } = auth.createSession(user, req);
    auth.setSessionCookie(res, token, req.protocol === 'https');
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    auth.logAudit(req, 'auth.setup_owner', `user:${user.id}`, { email: user.email });
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'email_exists' });
    }
    console.error('[auth] setup failed:', err);
    res.status(500).json({ error: 'setup_failed' });
  }
});

router.post('/auth/login',
  throttleMiddleware(loginThrottle, byIp),
  async (req, res) => {
    const ip = auth.ipOf(req);
    const { email, password } = req.body || {};
    if (!auth.validateEmail(email) || typeof password !== 'string') {
      loginThrottle.recordFail(ip);
      return res.status(400).json({ error: 'invalid_credentials' });
    }

    const row = Q.findUserByEmail(email.trim());
    if (!row || row.disabled) {
      loginThrottle.recordFail(ip);
      auth.logAudit(req, 'auth.login_fail', null, { email, reason: 'no_user_or_disabled' });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const ok = await auth.verifyPassword(password, row.password_hash);
    if (!ok) {
      loginThrottle.recordFail(ip);
      auth.logAudit(req, 'auth.login_fail', `user:${row.id}`, { reason: 'bad_password' });
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    loginThrottle.reset(ip);
    const { token } = auth.createSession(row, req);
    auth.setSessionCookie(res, token, req.protocol === 'https');
    req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
    auth.logAudit(req, 'auth.login', `user:${row.id}`, null);

    res.json({
      user: { id: row.id, email: row.email, name: row.name, role: row.role },
    });
  });

router.post('/auth/logout', (req, res) => {
  if (req.sessionToken) {
    auth.revokeSession(req.sessionToken);
    auth.logAudit(req, 'auth.logout', null, null);
  }
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

/** Current session info, used by the frontend on every page load. */
router.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  res.json({ user: req.user });
});

/**
 * Preview an invite (unauthenticated). Returns the email + role the
 * invite was issued for, so the accept form can pre-fill the email field.
 * Incoming token from the URL is plaintext; DB stores HMAC hash.
 */
router.get('/auth/invite/:token', (req, res) => {
  const inv = Q.findPendingInvite(hmacToken(req.params.token));
  if (!inv) return res.status(404).json({ error: 'invalid_or_expired' });
  res.json({ email: inv.email, role: inv.role, expires_at: inv.expires_at });
});

router.post('/auth/invite/:token/accept',
  throttleMiddleware(inviteAcceptThrottle, byIp),
  async (req, res) => {
  const ip = auth.ipOf(req);
  const tokenHash = hmacToken(req.params.token);
  const inv = Q.findPendingInvite(tokenHash);
  if (!inv) {
    inviteAcceptThrottle.recordFail(ip);
    return res.status(404).json({ error: 'invalid_or_expired' });
  }

  const { name, password } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length < 1)
    return res.status(400).json({ error: 'invalid_name' });
  const pwErr = auth.validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const existing = Q.findUserByEmail(inv.email);
  if (existing)
    return res.status(409).json({ error: 'email_exists' });

  try {
    const password_hash = await auth.hashPassword(password);
    const out = Q.insertUser({
      email: inv.email,
      name: name.trim(),
      password_hash,
      role: inv.role,
    });
    Q.acceptInvite(inv.token, out.lastInsertRowid);

    const user = Q.findUserById(out.lastInsertRowid);
    const { token } = auth.createSession(user, req);
    auth.setSessionCookie(res, token, req.protocol === 'https');
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    auth.logAudit(req, 'auth.accept_invite', `user:${user.id}`, {
      invite: inv.token.slice(0, 8) + '…',
      role: inv.role,
    });
    inviteAcceptThrottle.reset(ip);
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('[auth] accept invite failed:', err);
    res.status(500).json({ error: 'accept_failed' });
  }
});

// --- Password reset (unauthenticated flow) ----------------------------

/** Preview a reset link — returns the email the reset was issued for. */
router.get('/auth/reset/:token', (req, res) => {
  const row = Q.findPendingReset(hmacToken(req.params.token));
  if (!row) return res.status(404).json({ error: 'invalid_or_expired' });
  res.json({ email: row.email, name: row.name, expires_at: row.expires_at });
});

router.post('/auth/reset/:token',
  throttleMiddleware(resetThrottle, byIp),
  async (req, res) => {
  const ip = auth.ipOf(req);
  const tokenHash = hmacToken(req.params.token);
  const row = Q.findPendingReset(tokenHash);
  if (!row) {
    resetThrottle.recordFail(ip);
    return res.status(404).json({ error: 'invalid_or_expired' });
  }

  const { new_password } = req.body || {};
  const pwErr = auth.validatePassword(new_password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  try {
    const hash = await auth.hashPassword(new_password);
    Q.updateUserPassword(row.user_id, hash);
    Q.markResetUsed(row.token);
    // Invalidate all outstanding resets + active sessions so the only way
    // in is with the new password.
    Q.deleteResetsForUser(row.user_id);
    Q.deleteSessionsForUser(row.user_id);

    // Issue a fresh session so the user lands inside immediately.
    const user = Q.findUserById(row.user_id);
    const { token } = auth.createSession(user, req);
    auth.setSessionCookie(res, token, req.protocol === 'https');
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    auth.logAudit(req, 'auth.reset_password', `user:${user.id}`, {
      reset_token: row.token.slice(0, 8),
    });
    resetThrottle.reset(ip);
    res.status(200).json({ user: req.user });
  } catch (err) {
    console.error('[auth] reset failed:', err);
    res.status(500).json({ error: 'reset_failed' });
  }
});

// --- Self-service account management ----------------------------------
// These routes are mounted under /api (with auth routes) before the global
// requireAuth gate, so each explicitly requires authentication.

router.patch('/auth/me', auth.requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'invalid_name' });
  }
  Q.updateUserName(req.user.id, name.trim());
  auth.logAudit(req, 'auth.update_name', `user:${req.user.id}`, { name: name.trim() });
  const updated = Q.findUserById(req.user.id);
  res.json({ user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role } });
});

router.post('/auth/me/password', auth.requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const pwErr = auth.validatePassword(new_password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (typeof current_password !== 'string') {
    return res.status(400).json({ error: 'current_password required' });
  }

  const row = Q.findUserByEmail(req.user.email);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const ok = await auth.verifyPassword(current_password, row.password_hash);
  if (!ok) {
    auth.logAudit(req, 'auth.change_password_fail', `user:${req.user.id}`, null);
    return res.status(401).json({ error: 'wrong_password' });
  }

  const hash = await auth.hashPassword(new_password);
  Q.updateUserPassword(req.user.id, hash);
  // Invalidate all sessions except the current one — changing the password
  // should log out every other device.
  if (req.sessionToken) {
    Q.deleteSessionsForUserExcept(req.user.id, req.sessionToken);
  }
  auth.logAudit(req, 'auth.change_password', `user:${req.user.id}`, null);
  res.json({ ok: true });
});

router.get('/auth/me/sessions', auth.requireAuth, (req, res) => {
  const rows = Q.listSessionsForUser(req.user.id).map((s) => ({
    token_preview: s.token.slice(0, 8),
    is_current: s.token === req.sessionToken,
    created_at: s.created_at,
    expires_at: s.expires_at,
    last_seen_at: s.last_seen_at,
    ip: s.ip,
    user_agent_raw: s.user_agent,
    user_agent: parseUaSummary(s.user_agent),
  }));
  res.json({ sessions: rows });
});

function parseUaSummary(raw) {
  if (!raw) return 'unknown';
  try {
    const p = new UAParser(raw).getResult();
    const browser = p.browser.name ? `${p.browser.name}${p.browser.version ? ' ' + p.browser.version.split('.')[0] : ''}` : null;
    const os = p.os.name ? `${p.os.name}${p.os.version ? ' ' + p.os.version : ''}` : null;
    return [browser, os].filter(Boolean).join(' on ') || 'unknown';
  } catch {
    return 'unknown';
  }
}

router.post('/auth/me/revoke-others', auth.requireAuth, (req, res) => {
  if (!req.sessionToken) return res.status(400).json({ error: 'no_current_session' });
  const info = Q.deleteSessionsForUserExcept(req.user.id, req.sessionToken);
  auth.logAudit(req, 'auth.revoke_other_sessions', `user:${req.user.id}`, { revoked: info.changes });
  res.json({ ok: true, revoked: info.changes });
});

module.exports = router;
