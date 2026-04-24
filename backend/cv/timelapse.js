const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Q } = require('../database');
const capture = require('./capture');

// ffmpeg-based timelapse generator. Walks backend/data/snapshots/batch-<id>/,
// picks out .jpg files (stub .svg frames are skipped so a chamber
// without a live camera doesn't produce an empty video), and stitches
// them into an mp4 using an image2 concat pattern.
//
// Output lives under backend/data/timelapses/batch-<id>-<created_at>.mp4
// The cv_timelapses row indexes it and carries metadata (frame count,
// fps, duration, size, resolution, status, error).
//
// Serialization: at most one ffmpeg generation at a time — Pi 4B with
// 4GB RAM can easily OOM if two concurrent encodes run. Operators
// who kick off a second generation while one is running get a clear
// `already_running` response.

const DEFAULT_FPS = 10;
const MAX_FRAMES = 3000; // safety cap: ~5 min at 10 fps output

function storageRoot() {
  return path.resolve(
    path.dirname(capture.storageRoot()),
    'timelapses',
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listFrames(batchId) {
  const dir = batchId != null
    ? path.join(capture.storageRoot(), `batch-${batchId}`)
    : path.join(capture.storageRoot(), 'unbatched');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jpg'))
    .sort() // ISO timestamps → chronological
    .map((f) => path.join(dir, f));
}

function runFfmpeg(args, cwd) {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', args, {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    ff.stderr.on('data', (b) => { stderr += b.toString(); });
    ff.on('error', (err) => {
      resolve({ ok: false, error: err.code === 'ENOENT' ? 'ffmpeg_not_installed' : err.message });
    });
    ff.on('close', (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-3).join(' · ');
        resolve({ ok: false, error: tail || `exit_${code}` });
      } else {
        resolve({ ok: true, stderr });
      }
    });
  });
}

let runningChain = Promise.resolve();
let inFlight = false;

async function generate({ batch_id = null, fps = DEFAULT_FPS } = {}) {
  if (inFlight) {
    return { ok: false, already_running: true };
  }
  inFlight = true;

  try {
    const frames = listFrames(batch_id);
    if (frames.length < 2) {
      return { ok: false, error: 'need_at_least_2_frames', frames: frames.length };
    }
    if (frames.length > MAX_FRAMES) {
      // Cap at MAX_FRAMES, evenly sampled so the full window still
      // shows. We're not going to render a 30-minute video on a Pi.
      const stride = Math.ceil(frames.length / MAX_FRAMES);
      const subset = [];
      for (let i = 0; i < frames.length; i += stride) subset.push(frames[i]);
      frames.length = 0;
      frames.push(...subset);
    }

    // ffmpeg concat demuxer: a tiny list file of `file <path>` lines.
    // Avoids glob-pattern dependency and works whether filenames
    // sort alphabetically or not. Also lets us skip non-jpg rows.
    const outDir = storageRoot();
    ensureDir(outDir);
    const ts = new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
    const label = batch_id != null ? `batch-${batch_id}` : 'unbatched';
    const outPath = path.join(outDir, `${label}-${ts}.mp4`);
    const listPath = path.join(outDir, `${label}-${ts}.list`);

    const frameDuration = 1 / fps;
    const listBody = frames
      .map((p) => `file '${p}'\nduration ${frameDuration}`)
      .concat([`file '${frames[frames.length - 1]}'`]) // concat demuxer needs the last file repeated
      .join('\n');
    fs.writeFileSync(listPath, listBody);

    const ffArgs = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0',
      '-i', listPath,
      '-vf', 'scale=iw:ih:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'veryfast',
      '-crf', '23',
      '-movflags', '+faststart',
      '-y',
      outPath,
    ];

    const result = await runFfmpeg(ffArgs);
    fs.unlink(listPath, () => {}); // best-effort cleanup

    if (!result.ok) {
      const row = Q.insertTimelapse({
        batch_id,
        path: outPath,
        frames: frames.length,
        fps,
        status: 'error',
        error: result.error,
      });
      return { ok: false, error: result.error, timelapse_id: Number(row.lastInsertRowid) };
    }

    const stat = fs.statSync(outPath);
    const duration = frames.length / fps;

    // Probe resolution from the first frame (cheap). Skip if file is
    // unreadable — it's metadata, not load-bearing.
    let resolution = null;
    try {
      const probe = await new Promise((resolve) => {
        const p = spawn('ffprobe', [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height',
          '-of', 'csv=p=0:s=x',
          outPath,
        ], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        p.stdout.on('data', (b) => { out += b.toString(); });
        p.on('close', () => resolve(out.trim()));
        p.on('error', () => resolve(''));
      });
      if (probe) resolution = probe;
    } catch { /* best-effort */ }

    const ins = Q.insertTimelapse({
      batch_id,
      path: outPath,
      frames: frames.length,
      fps,
      duration_seconds: duration,
      size_bytes: stat.size,
      resolution,
      status: 'ready',
    });

    return {
      ok: true,
      timelapse_id: Number(ins.lastInsertRowid),
      path: outPath,
      frames: frames.length,
      fps,
      duration_seconds: duration,
      size_bytes: stat.size,
      resolution,
    };
  } finally {
    inFlight = false;
  }
}

// enqueueGenerate wraps generate() through a single-slot mutex so the
// route layer can fire-and-forget without blocking the HTTP response
// on a potentially-long ffmpeg encode.
function enqueueGenerate(opts) {
  const task = runningChain.then(() => generate(opts)).catch((err) => {
    console.error('[timelapse] generation failed:', err);
    return { ok: false, error: err.message };
  });
  runningChain = task;
  return task;
}

function removeOnDisk(row) {
  if (!row?.path) return;
  try { fs.unlinkSync(row.path); } catch { /* ignore */ }
}

module.exports = { generate, enqueueGenerate, storageRoot, removeOnDisk };
