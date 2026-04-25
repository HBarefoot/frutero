const express = require('express');
const auth = require('../auth');
const fleet = require('../fleet-agent');
const { Q } = require('../database');

const router = express.Router();

// GET /api/fleet/status — owner only. Reports whether this Pi is
// currently enrolled to a cloud, the URL, last heartbeat result.
router.get('/fleet/status', auth.requireAdmin, (_req, res) => {
  res.json(fleet.getStatus());
});

// POST /api/fleet/enroll — owner pastes a one-time code from the cloud
// dashboard. We POST the cloud's /api/devices/enroll, store the JWT
// locally, start the heartbeat loop. Same-shape error codes pass
// through so the UI can render meaningful messages.
router.post('/fleet/enroll', auth.requireAdmin, async (req, res) => {
  const { url, code, name } = req.body || {};
  try {
    const out = await fleet.enroll({ url, code, name });
    auth.logAudit(req, 'fleet.enroll', `chamber:${out.chamber_id}`, {
      url: String(url || '').replace(/\/+$/, ''),
      name: out.name,
    });
    res.status(201).json({ ok: true, ...out, status: fleet.getStatus() });
  } catch (err) {
    const code = err.code || 'enroll_failed';
    res.status(err.status || 400).json({ error: code, detail: err.message });
  }
});

// POST /api/fleet/heartbeat-now — owner triggers an immediate heartbeat
// for diagnostics; useful right after enrollment to confirm the loop.
router.post('/fleet/heartbeat-now', auth.requireAdmin, async (_req, res) => {
  const out = await fleet.sendOnce();
  res.json({ ...out, status: fleet.getStatus() });
});

// DELETE /api/fleet/connection — owner disconnects from the cloud.
// Clears stored JWT + chamber id + name (URL kept for re-enrollment UX).
router.delete('/fleet/connection', auth.requireAdmin, (req, res) => {
  fleet.disconnect();
  auth.logAudit(req, 'fleet.disconnect', null, null);
  res.json({ ok: true, status: fleet.getStatus() });
});

// PUT /api/fleet/snapshot-forwarding — owner sets the "every Nth scheduled
// CV capture" cadence for opportunistic snapshot forwarding (M6). N=0
// disables. Reads are via the regular /fleet/status response.
router.put('/fleet/snapshot-forwarding', auth.requireAdmin, (req, res) => {
  const raw = req.body?.every_n;
  const n = Number.isInteger(raw) ? raw : parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > 1000) {
    return res.status(400).json({ error: 'invalid_every_n', detail: 'integer 0..1000' });
  }
  Q.setSetting('fleet_snapshot_forward_every_n', String(n));
  auth.logAudit(req, 'fleet.snapshot_forwarding.update', null, { every_n: n });
  res.json({ ok: true, status: fleet.getStatus() });
});

module.exports = router;
