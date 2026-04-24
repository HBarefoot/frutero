const express = require('express');
const push = require('../push');
const auth = require('../auth');
const { Q } = require('../database');

const router = express.Router();

// GET /api/push/vapid — public key is safe to expose; it's the client
// identity for sending pushes, not a secret. No auth needed so the
// subscribe flow can fetch before the UI requires auth (though in
// practice the account page is behind requireAuth anyway).
router.get('/push/vapid', (_req, res) => {
  res.json({ public_key: push.getPublicKey() });
});

// The subscribe/unsubscribe/test endpoints are per-user — require auth
// so subscriptions belong to a specific account and we don't leak them
// across users on shared browsers.
router.use('/push', auth.requireAuth);

// POST /api/push/subscribe
// Body: { endpoint, keys: { p256dh, auth }, user_agent? }
router.post('/push/subscribe', (req, res) => {
  const { endpoint, keys, user_agent } = req.body || {};
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    return res.status(400).json({ error: 'invalid_endpoint' });
  }
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    return res.status(400).json({ error: 'invalid_keys' });
  }
  Q.upsertPushSubscription({
    user_id: req.user.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: typeof user_agent === 'string' ? user_agent.slice(0, 300) : null,
  });
  auth.logAudit(req, 'push.subscribe', `user:${req.user.id}`, {
    ua: (user_agent || '').slice(0, 100),
  });
  res.status(201).json({ ok: true });
});

router.delete('/push/subscribe', (req, res) => {
  // Body (DELETE): { endpoint }
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'invalid_endpoint' });
  }
  const info = Q.deletePushSubscription({ endpoint, user_id: req.user.id });
  auth.logAudit(req, 'push.unsubscribe', `user:${req.user.id}`, null);
  res.json({ ok: true, removed: info.changes });
});

// GET /api/push/subscriptions — the caller's own devices only.
router.get('/push/subscriptions', (req, res) => {
  const subs = Q.listPushSubscriptions({ user_id: req.user.id })
    .map((s) => ({
      id: s.id,
      endpoint_preview: s.endpoint.slice(0, 40) + '…',
      user_agent: s.user_agent,
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
    }));
  res.json({ subscriptions: subs });
});

// POST /api/push/test — sends a test push to all the caller's devices.
router.post('/push/test', async (req, res) => {
  const r = await push.sendToUser(req.user.id, {
    title: 'frutero — test',
    body: 'Push notifications are working. You can disable them on your Account page.',
    tag: 'frutero-test',
    url: '/account',
  });
  res.json(r);
});

module.exports = router;
