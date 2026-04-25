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

// POST /api/fleet/resync-batches — one-shot backfill of every batch in
// the Pi's local DB to the cloud's chamber_batches mirror. Useful for
// chambers that ran batches before P14 M4 shipped (forward hook only
// fires on new mutations, not historicals). Idempotent on the cloud
// side (UPSERT keyed on chamber_id+pi_batch_id), so re-running is safe.
router.post('/fleet/resync-batches', auth.requireAdmin, async (req, res) => {
  if (!fleet.isConnected()) {
    return res.status(409).json({ error: 'not_connected' });
  }
  const startedAt = Date.now();
  // Bound at 1000 to avoid pathological loops; a typical hobby fleet has
  // far fewer batches than this.
  const rows = Q.listBatches({ include_archived: true, limit: 1000 });
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    // listBatches doesn't return notes; getBatch does — fetch the full
    // record so the cloud mirror includes any notes the operator wrote.
    const full = Q.getBatch(row.id);
    if (!full) continue;
    const r = await fleet.forwardBatchEvent(full);
    if (r?.ok) succeeded += 1;
    else failed += 1;
  }
  auth.logAudit(req, 'fleet.resync_batches', null, {
    count: rows.length, succeeded, failed,
  });
  res.json({
    count: rows.length,
    succeeded,
    failed,
    duration_ms: Date.now() - startedAt,
  });
});

// PUT /api/fleet/local-url — owner overrides the auto-detected LAN URL.
// Pass { url: 'https://...' } to set, { url: null } (or missing) to
// clear and revert to auto-detect. Validated http(s)://-only with a
// reasonable length cap.
router.put('/fleet/local-url', auth.requireAdmin, (req, res) => {
  const raw = req.body?.url;
  if (raw === null || raw === undefined || raw === '') {
    Q.setSetting('pi_local_url', '');
    auth.logAudit(req, 'fleet.local_url.clear', null, null);
    return res.json({ ok: true, status: fleet.getStatus() });
  }
  if (typeof raw !== 'string') {
    return res.status(400).json({ error: 'invalid_url' });
  }
  const url = raw.trim();
  if (url.length > 512 || !/^https?:\/\/[^\s]+$/i.test(url)) {
    return res.status(400).json({ error: 'invalid_url', detail: 'must be http(s):// URL, max 512 chars' });
  }
  Q.setSetting('pi_local_url', url);
  auth.logAudit(req, 'fleet.local_url.update', null, { url });
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
