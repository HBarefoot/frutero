const express = require('express');
const { Q } = require('../database');
const batches = require('../batches');
const auth = require('../auth');
const fleet = require('../fleet-agent');

// Tiny helper to push a batch row to the cloud after a local mutation
// without bloating each handler. Fire-and-forget; the local response
// path doesn't care whether the forward succeeds.
function forwardBatchToCloud(batchId) {
  if (!batchId) return;
  let row;
  try { row = Q.getBatch(batchId); } catch { return; }
  if (!row) return;
  fleet.forwardBatchEvent(row).catch(() => { /* logged inside */ });
}

const router = express.Router();

const PHASES = ['colonization', 'pinning', 'fruiting', 'harvested', 'culled'];
const TERMINAL_PHASES = new Set(['harvested', 'culled']);

// SQLite CURRENT_TIMESTAMP is bare UTC; plain new Date() would parse
// it as local-time and miscalculate elapsed-days. Coerce to UTC.
function parseSqliteTs(ts) {
  if (!ts) return NaN;
  const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(ts);
  return new Date(hasTz ? ts : ts.replace(' ', 'T') + 'Z').getTime();
}

function serialize(b) {
  if (!b) return null;
  const started = parseSqliteTs(b.started_at);
  const ended = b.ended_at ? parseSqliteTs(b.ended_at) : null;
  return {
    ...b,
    is_active: !b.ended_at,
    days_elapsed: Math.max(0, Math.floor(((ended || Date.now()) - started) / 86400000)),
  };
}

// GET /api/batches
//   ?include_archived=0|1 (default 1)
router.get('/batches', (req, res) => {
  const include = req.query.include_archived !== '0';
  const rows = Q.listBatches({ include_archived: include, limit: 200 });
  res.json({
    batches: rows.map(serialize),
    active: serialize(Q.getActiveBatch()),
  });
});

// GET /api/batches/active — convenience for the dashboard card
router.get('/batches/active', (_req, res) => {
  const b = Q.getActiveBatch();
  if (!b) return res.json({ active: null });
  res.json({
    active: serialize(b),
    events: Q.listBatchEvents(b.id, 20),
    insights: Q.listAIInsights(10, { batch_id: b.id }),
    stats: Q.getBatchStats(b.id),
  });
});

// GET /api/batches/:id
router.get('/batches/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const b = Q.getBatch(id);
  if (!b) return res.status(404).json({ error: 'not_found' });
  res.json({
    batch: serialize(b),
    events: Q.listBatchEvents(b.id, 200),
    insights: Q.listAIInsights(50, { batch_id: b.id }),
    stats: Q.getBatchStats(b.id),
  });
});

// POST /api/batches — start a new batch. Archives any currently-active
// one first so the "single active batch" invariant holds.
router.post('/batches', (req, res) => {
  const { name, species_key, phase, notes, parent_batch_id } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  if (phase !== undefined && !PHASES.includes(phase)) {
    return res.status(400).json({ error: `phase must be one of: ${PHASES.join(', ')}` });
  }

  // Archive any active batch first.
  const current = Q.getActiveBatch();
  if (current) {
    Q.archiveBatch(current.id);
    Q.insertBatchEvent({
      batch_id: current.id,
      kind: 'auto_archived',
      detail: `Auto-archived when batch '${name.trim()}' started.`,
      user_id: req.user?.id ?? null,
    });
    forwardBatchToCloud(current.id);
  }

  const out = Q.insertBatch({
    name: name.trim(),
    species_key: species_key || null,
    phase: phase || 'colonization',
    parent_batch_id: parent_batch_id || null,
    notes: notes || null,
    created_by: req.user?.id ?? null,
  });
  const id = out.lastInsertRowid;

  Q.insertBatchEvent({
    batch_id: id,
    kind: 'created',
    detail: `Started batch '${name.trim()}'${species_key ? ' · ' + species_key : ''}`,
    user_id: req.user?.id ?? null,
  });

  batches.invalidate();
  auth.logAudit(req, 'batch.create', `batch:${id}`, { name: name.trim(), species_key, phase });

  forwardBatchToCloud(id);
  res.status(201).json({ batch: serialize(Q.getBatch(id)) });
});

// PATCH /api/batches/:id — update phase / notes / yield / name
router.patch('/batches/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const existing = Q.getBatch(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const fields = {};
  const events = [];

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    fields.name = body.name.trim();
  }
  if (body.species_key !== undefined) {
    fields.species_key = body.species_key || null;
  }
  if (body.phase !== undefined) {
    if (!PHASES.includes(body.phase)) {
      return res.status(400).json({ error: `phase must be one of: ${PHASES.join(', ')}` });
    }
    if (body.phase !== existing.phase) {
      fields.phase = body.phase;
      events.push({
        kind: 'phase_change',
        detail: `${existing.phase} → ${body.phase}`,
      });
      // Auto-archive on terminal phase transitions unless the caller
      // explicitly kept it open. Harvested + culled both end the run.
      if (TERMINAL_PHASES.has(body.phase) && !existing.ended_at) {
        fields.ended_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        events.push({
          kind: 'auto_archived',
          detail: `Archived on transition to ${body.phase}.`,
        });
      }
    }
  }
  if (body.notes !== undefined) {
    fields.notes = body.notes || null;
  }
  if (body.yield_grams !== undefined) {
    const n = Number(body.yield_grams);
    if (body.yield_grams !== null && (!Number.isFinite(n) || n < 0)) {
      return res.status(400).json({ error: 'yield_grams must be a non-negative number' });
    }
    fields.yield_grams = body.yield_grams === null ? null : n;
    events.push({ kind: 'yield_update', detail: `Yield set to ${n}g` });
  }
  if (body.cull_reason !== undefined) {
    fields.cull_reason = body.cull_reason || null;
  }
  if (body.notifications_muted !== undefined) {
    fields.notifications_muted = body.notifications_muted ? 1 : 0;
    events.push({
      kind: 'notifications',
      detail: body.notifications_muted ? 'Muted alert notifications for this batch.' : 'Unmuted alert notifications.',
    });
  }

  Q.updateBatch(id, fields);
  for (const ev of events) {
    Q.insertBatchEvent({
      batch_id: id,
      kind: ev.kind,
      detail: ev.detail,
      user_id: req.user?.id ?? null,
    });
  }

  batches.invalidate();
  auth.logAudit(req, 'batch.update', `batch:${id}`, fields);

  forwardBatchToCloud(id);
  res.json({ batch: serialize(Q.getBatch(id)) });
});

// POST /api/batches/:id/note — timestamped journal entry
router.post('/batches/:id/note', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  if (!Q.getBatch(id)) return res.status(404).json({ error: 'not_found' });

  const { detail } = req.body || {};
  if (typeof detail !== 'string' || !detail.trim()) {
    return res.status(400).json({ error: 'detail required' });
  }

  Q.insertBatchEvent({
    batch_id: id,
    kind: 'note',
    detail: detail.trim().slice(0, 2000),
    user_id: req.user?.id ?? null,
  });
  res.json({ ok: true });
});

// POST /api/batches/:id/archive — end a batch without changing phase
router.post('/batches/:id/archive', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const info = Q.archiveBatch(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not_found_or_already_archived' });
  Q.insertBatchEvent({
    batch_id: id,
    kind: 'archived',
    detail: 'Manually archived.',
    user_id: req.user?.id ?? null,
  });
  batches.invalidate();

  // If this batch has snapshots, kick off a timelapse in the
  // background. Best-effort; failure is logged but not surfaced.
  try {
    const stats = Q.getBatchStats(id);
    if ((stats.snapshots || 0) >= 2) {
      const timelapse = require('../cv/timelapse');
      timelapse.enqueueGenerate({ batch_id: id, fps: 10 })
        .then((r) => {
          if (r.ok) {
            Q.insertBatchEvent({
              batch_id: id,
              kind: 'timelapse',
              detail: `Auto-generated timelapse · ${r.frames} frames · ${Math.round(r.duration_seconds)}s`,
              user_id: null,
            });
          }
        })
        .catch((err) => console.error('[batches] archive timelapse failed:', err));
    }
  } catch (err) {
    console.error('[batches] archive timelapse hook error:', err);
  }

  // Fire-and-forget AI retrospective. Only runs if the advisor is
  // configured + enabled; parse failures are logged but don't block.
  try {
    const batchSummary = require('../ai/batch-summary');
    batchSummary.summarize(id)
      .then((r) => {
        if (!r.ok && !r.skipped) {
          console.error('[batches] archive summary failed:', r.error);
        }
      })
      .catch((err) => console.error('[batches] archive summary error:', err));
  } catch (err) {
    console.error('[batches] archive summary hook error:', err);
  }

  auth.logAudit(req, 'batch.archive', `batch:${id}`);
  forwardBatchToCloud(id);
  res.json({ batch: serialize(Q.getBatch(id)) });
});

// POST /api/batches/:id/summarize — on-demand AI retrospective. Same
// fire-and-forget shape as /ai/run: returns immediately, frontend
// polls listAIInsights for the new summary row to appear.
router.post('/batches/:id/summarize', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  if (!Q.getBatch(id)) return res.status(404).json({ error: 'not_found' });

  const batchSummary = require('../ai/batch-summary');
  batchSummary.summarize(id, { force: true })
    .then((r) => {
      if (!r.ok && !r.skipped) {
        console.error(`[batches] manual summary failed for ${id}:`, r.error);
      }
    })
    .catch((err) => console.error(`[batches] manual summary error for ${id}:`, err));

  auth.logAudit(req, 'batch.summarize', `batch:${id}`);
  res.status(202).json({ started: true });
});

// DELETE /api/batches/:id — hard delete. Admin-only since it nukes history.
router.delete('/batches/:id', auth.requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  Q.deleteBatch(id);
  batches.invalidate();
  auth.logAudit(req, 'batch.delete', `batch:${id}`);
  res.json({ ok: true });
});

module.exports = router;
