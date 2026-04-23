const express = require('express');
const auth = require('../auth');
const { Q } = require('../database');

const router = express.Router();

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
router.post('/auth/setup', auth.requireFirstRun, async (req, res) => {
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

router.post('/auth/login', async (req, res) => {
  const ip = auth.ipOf(req);

  if (auth.isThrottled(ip)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const { email, password } = req.body || {};
  if (!auth.validateEmail(email) || typeof password !== 'string') {
    auth.recordFail(ip);
    return res.status(400).json({ error: 'invalid_credentials' });
  }

  const row = Q.findUserByEmail(email.trim());
  if (!row || row.disabled) {
    auth.recordFail(ip);
    auth.logAudit(req, 'auth.login_fail', null, { email, reason: 'no_user_or_disabled' });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const ok = await auth.verifyPassword(password, row.password_hash);
  if (!ok) {
    auth.recordFail(ip);
    auth.logAudit(req, 'auth.login_fail', `user:${row.id}`, { reason: 'bad_password' });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  auth.resetFails(ip);
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
 */
router.get('/auth/invite/:token', (req, res) => {
  const inv = Q.findPendingInvite(req.params.token);
  if (!inv) return res.status(404).json({ error: 'invalid_or_expired' });
  res.json({ email: inv.email, role: inv.role, expires_at: inv.expires_at });
});

router.post('/auth/invite/:token/accept', async (req, res) => {
  const inv = Q.findPendingInvite(req.params.token);
  if (!inv) return res.status(404).json({ error: 'invalid_or_expired' });

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
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('[auth] accept invite failed:', err);
    res.status(500).json({ error: 'accept_failed' });
  }
});

module.exports = router;
