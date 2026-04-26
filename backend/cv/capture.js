const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Q } = require('../database');
const batches = require('../batches');
const camera = require('../camera');

// Scheduled snapshot capture for the CV subsystem. Reuses the same
// ffmpeg + v4l2 path as /api/camera/snapshot but writes a file to disk
// and indexes it in cv_snapshots. Each snapshot is auto-attached to
// the active batch (if any).
//
// Storage layout (root configurable via env, default backend/data/snapshots):
//   <root>/
//     batch-<id>/<ISO-ts>.jpg      — per-batch snapshots
//     unbatched/<ISO-ts>.jpg       — when no batch is active
//
// The nightly prune job (scheduler.registerInternalJobs) deletes rows
// older than cv_retention_days (default 30) and unlinks the file on disk.

const DEFAULT_RES = '640x480';
const DEFAULT_QUALITY = 7; // ffmpeg -q:v (lower = better, same as camera.js)

function storageRoot() {
  const override = process.env.SNAPSHOT_ROOT;
  if (override) return path.resolve(override);
  return path.resolve(__dirname, '..', 'data', 'snapshots');
}

function settingsForCapture() {
  const s = Q.getAllSettings();
  return {
    enabled: s.cv_snapshots_enabled === '1',
    cadence_minutes: parseInt(s.cv_snapshots_cadence_minutes, 10) || 10,
    retention_days: parseInt(s.cv_snapshots_retention_days, 10) || 30,
    auto_analyze: s.cv_auto_analyze === '1',
    analyze_every_nth: parseInt(s.cv_analyze_every_nth, 10) || 1,
    stage_advance_enabled: s.cv_stage_advance_enabled !== '0',
    stage_advance_threshold: Math.max(2, Math.min(10, parseInt(s.cv_stage_advance_threshold, 10) || 3)),
    fleet_forward_every_n: Math.max(0, parseInt(s.fleet_snapshot_forward_every_n, 10) || 0),
    device: s.camera_device || '/dev/video0',
    resolution: s.camera_resolution || DEFAULT_RES,
    quality: parseInt(s.camera_quality, 10) || DEFAULT_QUALITY,
    lowlight_mode: s.camera_lowlight_mode === 'on' ? 'on' : 'off',
  };
}

function cameraAvailable(device) {
  try { fs.accessSync(device, fs.constants.R_OK); return true; }
  catch { return false; }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function targetPath(batchId) {
  const root = storageRoot();
  const ts = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
  const sub = batchId != null ? `batch-${batchId}` : 'unbatched';
  const dir = path.join(root, sub);
  ensureDir(dir);
  return path.join(dir, `${ts}.jpg`);
}

// Spawn ffmpeg, capture one frame to the given file path, return
// { ok, size, error }.
function captureToFile(device, resolution, quality, outPath) {
  return new Promise((resolve) => {
    const useMjpeg = camera.supportsMjpeg(device);
    const inputArgs = ['-f', 'v4l2'];
    if (useMjpeg) inputArgs.push('-input_format', 'mjpeg');
    inputArgs.push('-video_size', resolution, '-i', device);
    const outputArgs = useMjpeg
      ? ['-frames:v', '1', '-c:v', 'copy', '-y', outPath]
      : ['-frames:v', '1', '-q:v', String(quality), '-y', outPath];
    const ff = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', ...inputArgs, ...outputArgs],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    ff.stderr.on('data', (b) => { stderr += b.toString().slice(0, 1000); });
    ff.on('error', (err) => {
      resolve({ ok: false, error: err.code === 'ENOENT' ? 'ffmpeg_not_installed' : err.message });
    });
    ff.on('close', (code) => {
      if (code !== 0) {
        return resolve({ ok: false, error: stderr.trim().split('\n').pop() || `exit_${code}` });
      }
      try {
        const st = fs.statSync(outPath);
        resolve({ ok: true, size: st.size });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
    // Max 10 s per capture — if the camera is stuck, don't hang the
    // scheduler. SIGTERM then unlink any partial file.
    setTimeout(() => {
      try { ff.kill('SIGTERM'); } catch { /* ignore */ }
    }, 10000);
  });
}

// Write a tiny SVG placeholder when the camera device is missing so the
// timeline still renders *something* in stub mode / no-camera installs.
function writeStubPlaceholder(outPath) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
    <rect width="100%" height="100%" fill="#0b1115"/>
    <g fill="#94a3b8" font-family="ui-monospace, monospace">
      <text x="320" y="230" text-anchor="middle" font-size="18">no camera</text>
      <text x="320" y="260" text-anchor="middle" font-size="11" fill="#475569">${new Date().toISOString()}</text>
    </g>
  </svg>`;
  const buf = Buffer.from(svg, 'utf-8');
  fs.writeFileSync(outPath, buf);
  return { ok: true, size: buf.length, mime: 'image/svg+xml' };
}

async function capture({ trigger = 'scheduled' } = {}) {
  const cfg = settingsForCapture();
  const batchId = batches.getActiveBatchId();

  // If the camera isn't plugged in, still record a stub placeholder so
  // the operator can see the capture pipeline is alive. Errors are
  // flagged so vision analysis in M2 skips them.
  let out;
  let filePath;
  if (!cameraAvailable(cfg.device)) {
    // Replace .jpg with .svg for clarity
    filePath = targetPath(batchId).replace(/\.jpg$/, '.svg');
    out = writeStubPlaceholder(filePath);
    out.error = `no_camera_at_${cfg.device}`;
  } else {
    filePath = targetPath(batchId);
    // Apply day/night v4l2 profile so scheduled CV snaps match the live
    // stream's exposure baseline. Manual + scheduled both share this.
    if (typeof camera.applyLowLightProfile === 'function') {
      camera.applyLowLightProfile(cfg.device, cfg.lowlight_mode);
    }
    out = await captureToFile(cfg.device, cfg.resolution, cfg.quality, filePath);
  }

  const [w, h] = cfg.resolution.split('x').map((n) => parseInt(n, 10) || null);

  let snapshotId = null;
  try {
    const ins = Q.insertSnapshot({
      batch_id: batchId,
      path: filePath,
      size_bytes: out.size ?? null,
      width: w || null,
      height: h || null,
      trigger,
      error: out.ok ? null : (out.error || 'unknown'),
    });
    snapshotId = Number(ins.lastInsertRowid);
  } catch (err) {
    console.error('[cv] db insert failed:', err);
  }

  // Auto-analyze hook. Runs every Nth scheduled snapshot (1 = every
  // one). Manual captures always analyze if auto_analyze is on, so the
  // "Capture now" button feels immediate. Fire-and-forget so capture
  // latency doesn't include the LLM round-trip.
  if (out.ok && snapshotId && cfg.auto_analyze && !filePath.endsWith('.svg')) {
    const nth = Math.max(1, cfg.analyze_every_nth);
    const shouldAnalyze = trigger === 'manual' || snapshotId % nth === 0;
    if (shouldAnalyze) {
      const analyzer = require('./analyzer');
      analyzer.enqueueAnalyze(snapshotId)
        .catch((err) => console.error('[cv] auto-analyze failed:', err));
    }
  }

  // Fleet-forward hook (M6). Opportunistically upload every Nth scheduled
  // capture so the cloud always has recent thumbnails without the
  // operator having to click "Take snapshot". Only fires on scheduled
  // triggers — cloud-requested ('fleet') captures upload via the
  // take_snapshot command handler; manual captures stay local.
  if (out.ok && snapshotId && !filePath.endsWith('.svg') && trigger === 'scheduled' && cfg.fleet_forward_every_n > 0) {
    scheduledForwardCount += 1;
    if (scheduledForwardCount % cfg.fleet_forward_every_n === 0) {
      const fleetAgent = require('../fleet-agent');
      fleetAgent.uploadSnapshotToCloud({ path: filePath, snapshotId, source: 'cv' })
        .then((r) => {
          if (!r.ok) console.warn('[cv] fleet forward skipped:', r.error);
        })
        .catch((err) => console.error('[cv] fleet forward crashed:', err));
    }
  }

  return { ok: out.ok, path: filePath, error: out.error, batch_id: batchId, snapshot_id: snapshotId };
}

// Prune snapshots older than retention_days: delete files then rows.
async function prune() {
  const cfg = settingsForCapture();
  const rows = Q.pruneOldSnapshots(cfg.retention_days);
  let unlinked = 0;
  let failed = 0;
  for (const r of rows) {
    try { fs.unlinkSync(r.path); unlinked += 1; } catch { failed += 1; }
    Q.deleteSnapshot(r.id);
  }
  return { expired: rows.length, unlinked, failed };
}

// Scheduler: re-reads cadence every minute so tuning is live.
let tickHandle = null;
let lastCaptureAt = 0;

// Fleet-forward cursor (M6). Module-scoped so it resets on restart —
// which is fine: the first scheduled capture after boot forwards
// whenever counter % N === 0, and we don't need persistence for a
// simple Nth-sample heuristic.
let scheduledForwardCount = 0;
function startScheduler() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(async () => {
    const cfg = settingsForCapture();
    if (!cfg.enabled) return;
    const intervalMs = Math.max(1, cfg.cadence_minutes) * 60 * 1000;
    if (Date.now() - lastCaptureAt < intervalMs) return;
    lastCaptureAt = Date.now();
    try {
      await capture({ trigger: 'scheduled' });
    } catch (err) {
      console.error('[cv] scheduled capture failed:', err);
    }
  }, 60 * 1000);
  tickHandle.unref?.();
}

function stopScheduler() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

module.exports = {
  capture,
  prune,
  startScheduler,
  stopScheduler,
  storageRoot,
  settingsForCapture,
};
