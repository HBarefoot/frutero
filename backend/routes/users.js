const express = require('express');
const auth = require('../auth');
const { Q, hmacToken } = require('../database');
const notifications = require('../notifications');
const mailTemplates = require('../mail/templates');

const router = express.Router();

// Fire-and-forget wrapper: transactional email shouldn't block the
// route response. Returns a promise the caller can await if they want
// to surface the outcome in the response body (invite/reset do).
async function sendTransactional(recipient, built) {
  try {
    return await notifications.sendRaw({
      to: recipient,
      subject: built.subject,
      text: built.text,
      html: built.html,
    });
  } catch (err) {
    return { ok: false, reason: 'threw', detail: err.message };
  }
}

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
router.post('/users/:id/password-reset', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = Q.findUserById(id);
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (user.disabled) return res.status(409).json({ error: 'user_disabled' });

  // Plaintext token is returned ONCE in this response so the owner can
  // deliver the reset link. Only the HMAC is persisted; if the plaintext
  // is lost, the owner must revoke and reissue.
  const plaintext = auth.generateToken(24);
  const tokenHash = hmacToken(plaintext);
  const expires_at = auth.newInviteExpiry(); // 72h TTL, same as invites
  Q.insertPasswordReset({
    token: tokenHash,
    user_id: id,
    issued_by: req.user.id,
    expires_at,
  });
  auth.logAudit(req, 'user.password_reset_issued', `user:${id}`, {
    token_preview: tokenHash.slice(0, 8),
  });

  // Best-effort email. Route still returns the plaintext token so the
  // copy-link fallback works when SMTP isn't configured or send fails.
  const link = `${req.protocol}://${req.get('host')}/reset/${plaintext}`;
  const built = mailTemplates.passwordResetEmail({
    target_name: user.name,
    issuer_name: req.user.name || null,
    link,
    expires_at,
  });
  const mail = await sendTransactional(user.email, built);
  if (mail.ok) {
    auth.logAudit(req, 'user.password_reset_emailed', `user:${id}`, null);
  } else if (!mail.skipped) {
    console.warn(`[users] reset email failed for ${user.email}: ${mail.reason}`);
  }

  res.status(201).json({
    token: plaintext,
    expires_at,
    email: user.email,
    email_sent: !!mail.ok,
    email_error: mail.ok ? null : (mail.reason || null),
  });
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

router.post('/invites', async (req, res) => {
  const { email, role } = req.body || {};
  if (!auth.validateEmail(email))
    return res.status(400).json({ error: 'invalid_email' });
  if (!auth.validateRole(role))
    return res.status(400).json({ error: 'invalid_role' });

  // Prevent issuing an invite for an email that's already a user.
  if (Q.findUserByEmail(email.trim()))
    return res.status(409).json({ error: 'email_exists' });

  // Same pattern as password reset: plaintext is returned ONCE in the
  // creation response so the owner can build + deliver the invite URL.
  // Only the HMAC is stored; the listing at GET /invites returns hashes.
  const plaintext = auth.generateToken(24);
  const tokenHash = hmacToken(plaintext);
  const expires_at = auth.newInviteExpiry();
  const cleanEmail = email.trim();
  Q.insertInvite({
    token: tokenHash,
    email: cleanEmail,
    role,
    created_by: req.user.id,
    expires_at,
  });
  auth.logAudit(req, 'invite.create', `invite:${tokenHash.slice(0, 8)}`, {
    email: cleanEmail,
    role,
  });

  // Best-effort email. Copy-link fallback still works if SMTP is off
  // or the send fails — the plaintext token ships in the response
  // either way.
  const link = `${req.protocol}://${req.get('host')}/invite/${plaintext}`;
  const built = mailTemplates.inviteEmail({
    inviter_name: req.user.name,
    inviter_email: req.user.email,
    role,
    link,
    expires_at,
  });
  const mail = await sendTransactional(cleanEmail, built);
  if (mail.ok) {
    auth.logAudit(req, 'invite.emailed', `invite:${tokenHash.slice(0, 8)}`, null);
  } else if (!mail.skipped) {
    console.warn(`[invites] email failed for ${cleanEmail}: ${mail.reason}`);
  }

  res.status(201).json({
    token: plaintext,
    expires_at,
    email: cleanEmail,
    role,
    email_sent: !!mail.ok,
    email_error: mail.ok ? null : (mail.reason || null),
  });
});

router.delete('/invites/:token', (req, res) => {
  // The listing returns HMAC hashes, so the revoke URL carries the hash
  // directly. No extra hashing needed here.
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
