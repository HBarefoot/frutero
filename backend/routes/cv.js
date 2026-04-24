const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Q } = require('../database');
const capture = require('../cv/capture');
const auth = require('../auth');

const router = express.Router();

// GET /api/cv/snapshots?batch_id=…&limit=…
router.get('/cv/snapshots', (req, res) => {
  const batch_id = req.query.batch_id != null ? parseInt(req.query.batch_id, 10) : undefined;
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  res.json({
    entries: Q.listSnapshots({ batch_id: Number.isFinite(batch_id) ? batch_id : undefined, limit }),
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
  auth.logAudit(req, 'cv.config_update', null, body);
  res.json(capture.settingsForCapture());
});

module.exports = router;
