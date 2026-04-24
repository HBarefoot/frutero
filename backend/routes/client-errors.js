const express = require('express');
const { Q } = require('../database');
const { errorReportThrottle, throttleMiddleware } = require('../throttle');
const auth = require('../auth');

const router = express.Router();

// Both routes require an authenticated session. Reads are admin-only
// (we expose only aggregate stats + recent entries on the Security
// page); writes are allowed for any authenticated user because the
// ErrorBoundary doesn't know the viewer's role.

// POST /api/client-errors
//   { path, message, stack, scope, user_agent }
//   Throttled per-IP so a render-loop can't nuke the DB.
router.post('/client-errors',
  throttleMiddleware(errorReportThrottle, { extract: (req) => auth.ipOf(req) }),
  (req, res) => {
    const { path, message, stack, scope, user_agent } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message_required' });
    }

    // Defensive length caps — a very large stack from a pathological
    // page should not be able to bloat the table.
    const truncate = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s);

    Q.insertClientError({
      user_id: req.user?.id ?? null,
      path: truncate(path, 256),
      message: truncate(message, 512),
      stack: truncate(stack, 8192),
      scope: truncate(scope, 64),
      user_agent: truncate(user_agent, 512),
    });

    errorReportThrottle.recordFail(auth.ipOf(req));
    res.json({ ok: true });
  });

// GET /api/client-errors?limit=20
//   Owner-only list of recent client-side render errors.
router.get('/client-errors', auth.requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  res.json({
    entries: Q.listClientErrors(limit),
    count_24h: Q.countRecentClientErrors(24),
  });
});

module.exports = router;
