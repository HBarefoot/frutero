const express = require('express');
const auth = require('../auth');
const { Q } = require('../database');

const router = express.Router();

// Every route in this file requires admin (owner) permission.
router.use(auth.requireAdmin);

function countOwners() {
  return Q.listUsers().filter((u) => u.role === 'owner' && !u.disabled).length;
}

router.get('/users', (_req, res) => {
  res.json({ users: Q.listUsers() });
});

router.patch('/users/:id/role', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { role } = req.body || {};
  if (!auth.validateRole(role))
    return res.status(400).json({ error: 'invalid_role' });

  const user = Q.findUserById(id);
  if (!user) return res.status(404).json({ error: 'not_found' });

  // Don't let the last active owner demote themselves — that'd lock
  // everyone out of admin tasks.
  if (user.role === 'owner' && role !== 'owner' && countOwners() <= 1) {
    return res.status(409).json({ error: 'last_owner' });
  }

  Q.updateUserRole(id, role);
  auth.logAudit(req, 'user.role_change', `user:${id}`, {
    from: user.role,
    to: role,
  });
  res.json({ user: Q.findUserById(id) });
});

router.patch('/users/:id/disabled', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { disabled } = req.body || {};
  const user = Q.findUserById(id);
  if (!user) return res.status(404).json({ error: 'not_found' });

  if (user.role === 'owner' && disabled && countOwners() <= 1) {
    return res.status(409).json({ error: 'last_owner' });
  }
  if (user.id === req.user.id && disabled) {
    return res.status(409).json({ error: 'cannot_disable_self' });
  }

  Q.updateUserDisabled(id, !!disabled);
  // Revoking all sessions on disable is safer than letting the cookie
  // linger until next request.
  if (disabled) Q.deleteSessionsForUser(id);

  auth.logAudit(req, disabled ? 'user.disable' : 'user.enable', `user:${id}`, null);
  res.json({ user: Q.findUserById(id) });
});

router.delete('/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = Q.findUserById(id);
  if (!user) return res.status(404).json({ error: 'not_found' });

  if (user.id === req.user.id) {
    return res.status(409).json({ error: 'cannot_delete_self' });
  }
  if (user.role === 'owner' && countOwners() <= 1) {
    return res.status(409).json({ error: 'last_owner' });
  }

  Q.deleteUser(id);
  auth.logAudit(req, 'user.delete', `user:${id}`, {
    email: user.email,
    role: user.role,
  });
  res.json({ ok: true });
});

/**
 * Owner issues a password reset token for another user. Returns the token
 * + URL once — it's the caller's job to deliver it out-of-band. Owners
 * can also issue a reset for themselves (useful if they want to force
 * re-authentication on every device).
 */
router.post('/users/:id/password-reset', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = Q.findUserById(id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (user.disabled) return res.status(409).json({ error: 'user_disabled' });

  const token = auth.generateToken(24);
  const expires_at = auth.newInviteExpiry(); // 72h TTL, same as invites
  Q.insertPasswordReset({
    token,
    user_id: id,
    issued_by: req.user.id,
    expires_at,
  });
  auth.logAudit(req, 'user.password_reset_issued', `user:${id}`, {
    token_preview: token.slice(0, 8),
  });
  res.status(201).json({ token, expires_at, email: user.email });
});

/** Force-logout all sessions for a user. */
router.post('/users/:id/revoke-sessions', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = Q.findUserById(id);
  if (!user) return res.status(404).json({ error: 'not_found' });

  Q.deleteSessionsForUser(id);
  auth.logAudit(req, 'user.revoke_sessions', `user:${id}`, null);
  res.json({ ok: true });
});

// --- Invites ----------------------------------------------------------

router.get('/invites', (_req, res) => {
  res.json({ invites: Q.listPendingInvites() });
});

router.post('/invites', (req, res) => {
  const { email, role } = req.body || {};
  if (!auth.validateEmail(email))
    return res.status(400).json({ error: 'invalid_email' });
  if (!auth.validateRole(role))
    return res.status(400).json({ error: 'invalid_role' });

  // Prevent issuing an invite for an email that's already a user.
  if (Q.findUserByEmail(email.trim()))
    return res.status(409).json({ error: 'email_exists' });

  const token = auth.generateToken(24);
  const expires_at = auth.newInviteExpiry();
  Q.insertInvite({
    token,
    email: email.trim(),
    role,
    created_by: req.user.id,
    expires_at,
  });
  auth.logAudit(req, 'invite.create', `invite:${token.slice(0, 8)}`, {
    email: email.trim(),
    role,
  });
  res.status(201).json({ token, expires_at, email: email.trim(), role });
});

router.delete('/invites/:token', (req, res) => {
  Q.deleteInvite(req.params.token);
  auth.logAudit(req, 'invite.revoke', `invite:${req.params.token.slice(0, 8)}`, null);
  res.json({ ok: true });
});

// --- Audit log --------------------------------------------------------

router.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  res.json({ entries: Q.listAudit(limit) });
});

module.exports = router;
