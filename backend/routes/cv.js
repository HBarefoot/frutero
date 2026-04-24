const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Q } = require('../database');
const capture = require('../cv/capture');
const analyzer = require('../cv/analyzer');
const timelapse = require('../cv/timelapse');
const auth = require('../auth');

const router = express.Router();

// GET /api/cv/snapshots?batch_id=…&limit=…
// Returns each snapshot with its latest observation (if any) folded in
// under `observation`, so the timeline can show per-tile badges in one
// round-trip.
router.get('/cv/snapshots', (req, res) => {
  const batch_id = req.query.batch_id != null ? parseInt(req.query.batch_id, 10) : undefined;
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const entries = Q.listSnapshots({
    batch_id: Number.isFinite(batch_id) ? batch_id : undefined,
    limit,
  });
  const obsMap = Q.observationsBySnapshotIds(entries.map((e) => e.id));
  for (const e of entries) {
    e.observation = obsMap[e.id] || null;
  }
  res.json({
    entries,
    count_24h: Q.countSnapshots(24),
  });
});

router.get('/cv/snapshots/latest', (req, res) => {
  const batch_id = req.query.batch_id != null ? parseInt(req.query.batch_id, 10) : undefined;
  const row = Q.getLatestSnapshot({ batch_id: Number.isFinite(batch_id) ? batch_id : undefined });
  res.json({ snapshot: row });
});

// GET /api/cv/snapshots/:id/image — serves the JPEG/SVG from disk.
// Path validation confined to the configured snapshot root so a
// tampered DB row can't exfiltrate /etc/passwd or similar.
router.get('/cv/snapshots/:id/image', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const row = Q.getSnapshot(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const root = capture.storageRoot();
  const resolved = path.resolve(row.path);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return res.status(400).json({ error: 'path_escapes_root' });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(410).json({ error: 'file_gone' });
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime =
    ext === '.svg' ? 'image/svg+xml' :
    ext === '.png' ? 'image/png' :
    'image/jpeg';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(resolved).pipe(res);
});

// POST /api/cv/snapshots/now — manual trigger
router.post('/cv/snapshots/now', async (req, res) => {
  try {
    const result = await capture.capture({ trigger: 'manual' });
    auth.logAudit(req, 'cv.manual_capture', null, {
      ok: result.ok,
      batch_id: result.batch_id,
    });
    res.json(result);
  } catch (err) {
    console.error('[cv] manual capture failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cv/observations?batch_id=…&snapshot_id=…&limit=…
router.get('/cv/observations', (req, res) => {
  const batch_id = req.query.batch_id != null ? parseInt(req.query.batch_id, 10) : undefined;
  const snapshot_id = req.query.snapshot_id != null ? parseInt(req.query.snapshot_id, 10) : undefined;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json({
    entries: Q.listObservations({
      batch_id: Number.isFinite(batch_id) ? batch_id : undefined,
      snapshot_id: Number.isFinite(snapshot_id) ? snapshot_id : undefined,
      limit,
    }),
  });
});

// POST /api/cv/analyze/:snapshot_id  — manual trigger (force=true re-runs)
router.post('/cv/analyze/:snapshot_id', async (req, res) => {
  const id = parseInt(req.params.snapshot_id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const force = req.body?.force === true || req.query.force === '1';
  try {
    const result = await analyzer.analyze(id, { force });
    auth.logAudit(req, 'cv.manual_analyze', `snapshot:${id}`, {
      ok: !!result.ok,
      reason: result.reason,
    });
    res.json(result);
  } catch (err) {
    console.error('[cv] manual analyze failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Timelapses ------------------------------------------------------

// GET /api/cv/timelapses?batch_id=…
router.get('/cv/timelapses', (req, res) => {
  const batch_id = req.query.batch_id != null ? parseInt(req.query.batch_id, 10) : undefined;
  res.json({
    entries: Q.listTimelapses({
      batch_id: Number.isFinite(batch_id) ? batch_id : undefined,
      limit: 50,
    }),
  });
});

// POST /api/cv/timelapses — generate a new one
//   body: { batch_id?, fps? }
// Fire-and-forget: returns 202 with { started: true, batch_id } and
// the encode runs in the background. The list endpoint will show the
// new entry once it lands. Serialized via enqueueGenerate.
router.post('/cv/timelapses', async (req, res) => {
  const body = req.body || {};
  const batch_id = body.batch_id != null ? parseInt(body.batch_id, 10) : null;
  const fps = Math.max(1, Math.min(60, parseInt(body.fps, 10) || 10));

  // Quick pre-flight: refuse if there aren't enough frames. Avoids
  // the 202 → failed-later ghost entry in the list.
  const existingSnaps = Q.listSnapshots({
    batch_id: Number.isFinite(batch_id) ? batch_id : undefined,
    limit: 1,
  });
  if (existingSnaps.length === 0) {
    return res.status(400).json({ error: 'no_snapshots' });
  }

  timelapse
    .enqueueGenerate({ batch_id: Number.isFinite(batch_id) ? batch_id : null, fps })
    .catch((err) => console.error('[cv] timelapse failed:', err));

  auth.logAudit(req, 'cv.timelapse_start', null, { batch_id, fps });
  res.status(202).json({
    started: true,
    batch_id: Number.isFinite(batch_id) ? batch_id : null,
    fps,
    hint: 'Generation runs in the background. Poll GET /api/cv/timelapses to see when it lands.',
  });
});

// GET /api/cv/timelapses/:id/video — stream the mp4
router.get('/cv/timelapses/:id/video', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const row = Q.getTimelapse(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status !== 'ready') return res.status(409).json({ error: 'not_ready', status: row.status });

  const root = timelapse.storageRoot();
  const resolved = path.resolve(row.path);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return res.status(400).json({ error: 'path_escapes_root' });
  }
  if (!fs.existsSync(resolved)) return res.status(410).json({ error: 'file_gone' });

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  // Let the browser seek within the video.
  const stat = fs.statSync(resolved);
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d+)-(\d+)?/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(resolved, { start, end }).pipe(res);
      return;
    }
  }
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(resolved).pipe(res);
});

// DELETE /api/cv/timelapses/:id — delete file + row
router.delete('/cv/timelapses/:id', auth.requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const row = Q.getTimelapse(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  timelapse.removeOnDisk(row);
  Q.deleteTimelapse(id);
  auth.logAudit(req, 'cv.timelapse_delete', `timelapse:${id}`);
  res.json({ ok: true });
});

// GET /api/cv/config — owner-only
router.get('/cv/config', auth.requireAdmin, (_req, res) => {
  res.json(capture.settingsForCapture());
});

router.put('/cv/config', auth.requireAdmin, (req, res) => {
  const body = req.body || {};
  if (body.enabled !== undefined) {
    Q.setSetting('cv_snapshots_enabled', body.enabled ? '1' : '0');
  }
  if (body.cadence_minutes !== undefined) {
    const n = parseInt(body.cadence_minutes, 10);
    if (!Number.isFinite(n) || n < 1 || n > 1440) {
      return res.status(400).json({ error: 'cadence_minutes must be 1-1440' });
    }
    Q.setSetting('cv_snapshots_cadence_minutes', String(n));
  }
  if (body.retention_days !== undefined) {
    const n = parseInt(body.retention_days, 10);
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      return res.status(400).json({ error: 'retention_days must be 1-3650' });
    }
    Q.setSetting('cv_snapshots_retention_days', String(n));
  }
  if (body.auto_analyze !== undefined) {
    Q.setSetting('cv_auto_analyze', body.auto_analyze ? '1' : '0');
  }
  if (body.analyze_every_nth !== undefined) {
    const n = parseInt(body.analyze_every_nth, 10);
    if (!Number.isFinite(n) || n < 1 || n > 1000) {
      return res.status(400).json({ error: 'analyze_every_nth must be 1-1000' });
    }
    Q.setSetting('cv_analyze_every_nth', String(n));
  }
  if (body.stage_advance_enabled !== undefined) {
    Q.setSetting('cv_stage_advance_enabled', body.stage_advance_enabled ? '1' : '0');
  }
  if (body.stage_advance_threshold !== undefined) {
    const n = parseInt(body.stage_advance_threshold, 10);
    if (!Number.isFinite(n) || n < 2 || n > 10) {
      return res.status(400).json({ error: 'stage_advance_threshold must be 2-10' });
    }
    Q.setSetting('cv_stage_advance_threshold', String(n));
  }
  auth.logAudit(req, 'cv.config_update', null, body);
  res.json(capture.settingsForCapture());
});

module.exports = router;
