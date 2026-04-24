const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Database = require('better-sqlite3');
const express = require('express');
const config = require('../config');
const { Q, getDb } = require('../database');
const auth = require('../auth');

const router = express.Router();

// GET /api/security/backup (owner-only)
//   Streams a consistent SQLite snapshot using better-sqlite3's native
//   online backup API. Safe to call while the app is actively writing.
router.get('/security/backup', auth.requireAdmin, async (req, res) => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const hostname = os.hostname().split('.')[0];
  const filename = `frutero-${hostname}-${ts}.db`;
  const tmpPath = path.join(os.tmpdir(), `frutero-backup-${Date.now()}.db`);

  try {
    // .backup() returns a Promise and copies pages while letting normal
    // reads/writes continue — no long-held lock on the live DB.
    await getDb().backup(tmpPath);
  } catch (err) {
    console.error('[backup] snapshot failed:', err);
    return res.status(500).json({ error: 'backup_failed', detail: err.message });
  }

  const stat = fs.statSync(tmpPath);
  try {
    Q.setSecret('last_backup_at', new Date().toISOString());
    Q.setSecret('last_backup_bytes', String(stat.size));
  } catch { /* non-fatal */ }

  auth.logAudit(req, 'security.backup_download', null, { bytes: stat.size });

  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(stat.size));

  const stream = fs.createReadStream(tmpPath);
  stream.pipe(res);
  stream.on('close', () => {
    fs.unlink(tmpPath, () => { /* cleanup best-effort */ });
  });
  stream.on('error', (err) => {
    console.error('[backup] stream error:', err);
    fs.unlink(tmpPath, () => {});
  });
});

// POST /api/setup/restore (first-run only)
//   Accepts a multipart .db upload, validates it, atomically swaps it
//   into place, and crashes on purpose so systemd restarts into the
//   restored state. The crash-on-purpose path is the only safe way to
//   swap a live SQLite file.
router.post('/setup/restore', auth.requireFirstRun, (req, res) => {
  if (!req.files || !req.files.backup) {
    return res.status(400).json({ error: 'no_file_uploaded' });
  }

  const upload = req.files.backup;
  const uploadPath = upload.tempFilePath || null;
  if (!uploadPath) {
    return res.status(400).json({ error: 'upload_failed' });
  }

  // Sanity-validate the uploaded file: it must open as SQLite and contain
  // the core tables we expect. Don't import anything we don't recognize.
  const REQUIRED_TABLES = ['users', 'actuators', 'schedules', 'settings'];
  let test;
  try {
    test = new Database(uploadPath, { readonly: true, fileMustExist: true });
    const tables = test.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'`
    ).all().map((r) => r.name);
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length) {
      test.close();
      fs.unlink(uploadPath, () => {});
      return res.status(400).json({
        error: 'invalid_backup',
        detail: `missing required tables: ${missing.join(', ')}`,
      });
    }
    test.close();
  } catch (err) {
    if (test) try { test.close(); } catch { /* ignore */ }
    fs.unlink(uploadPath, () => {});
    return res.status(400).json({ error: 'not_a_sqlite_db', detail: err.message });
  }

  // Atomically swap: rename current DB aside with a timestamped suffix,
  // move upload into place. Also nuke any stale WAL/SHM sidecars so the
  // restored DB starts clean.
  const target = config.DB_PATH;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const aside = `${target}.pre-restore-${ts}.bak`;
  try {
    if (fs.existsSync(target)) fs.renameSync(target, aside);
    fs.copyFileSync(uploadPath, target);
    ['-wal', '-shm'].forEach((suffix) => {
      const sidecar = `${target}${suffix}`;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    });
    fs.unlink(uploadPath, () => {});
  } catch (err) {
    console.error('[restore] swap failed:', err);
    return res.status(500).json({ error: 'swap_failed', detail: err.message });
  }

  // Respond first, THEN exit. systemd Restart=always brings us back into
  // the restored DB. Give the response ~500ms to actually flush.
  res.json({ ok: true, restart_in_ms: 500, aside });
  setTimeout(() => {
    console.log('[restore] swap complete — exiting to let systemd restart');
    process.exit(0);
  }, 500);
});

module.exports = router;
