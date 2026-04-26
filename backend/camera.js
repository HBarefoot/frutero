const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { Q } = require('./database');

const DEFAULT_DEVICE = '/dev/video0';
const DEFAULT_RES = '640x480';
const DEFAULT_FPS = 10;
const DEFAULT_QUALITY = 7; // ffmpeg -q:v scale (lower = better)

// MJPEG-passthrough probe. UVC webcams that natively output Motion-JPEG
// (e.g. Logitech C920/C922) let us skip a YUYV→JPEG software re-encode on
// every frame. On a Pi 4B that re-encode is the difference between a smooth
// stream and CPU-bound stutter. We probe `v4l2-ctl --list-formats-ext`
// once per device path and cache; if MJPG is offered we add
// `-input_format mjpeg` to the ffmpeg invocation and switch the codec to
// `copy` so ffmpeg just relays bytes.
const mjpegProbeCache = new Map(); // device path -> bool
function supportsMjpeg(device) {
  if (mjpegProbeCache.has(device)) return mjpegProbeCache.get(device);
  let supported = false;
  try {
    const out = execFileSync('v4l2-ctl', ['-d', device, '--list-formats-ext'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    supported = /MJPG|Motion-JPEG/.test(out);
  } catch { /* v4l2-ctl missing, device gone, or perms — fall back to YUYV */ }
  mjpegProbeCache.set(device, supported);
  console.log(`[camera] ${device}: MJPEG passthrough ${supported ? 'enabled (-c:v copy)' : 'unavailable (YUYV re-encode)'}`);
  return supported;
}

// Low-light mode profile. The Logitech C922 (and similar UVC webcams) has
// no IR sensitivity — true night vision needs different hardware (Pi NoIR
// + IR LEDs, or an actual security cam). What we CAN do via v4l2 controls
// is push the sensor 2-3 stops harder so a dim chamber (e.g. lights on a
// schedule with a brief window of darkness) is visible instead of pitch
// black.
//
// Day profile = device defaults. Night profile = brightness boost, gain
// boost, backlight compensation on, and let the camera drop framerate to
// take longer exposures. Applied before every ffmpeg spawn so the camera's
// internal state matches the user's setting (UVC controls are sticky on
// the device until rebooted, so we always set both directions explicitly).
const DAY_PROFILE = {
  brightness: 128,
  gain: 0,
  backlight_compensation: 0,
};
const NIGHT_PROFILE = {
  brightness: 200,
  gain: 180,
  backlight_compensation: 1,
};
function applyLowLightProfile(device, mode) {
  const profile = mode === 'on' ? NIGHT_PROFILE : DAY_PROFILE;
  const ctrls = Object.entries(profile).map(([k, v]) => `${k}=${v}`).join(',');
  try {
    execFileSync('v4l2-ctl', ['-d', device, `--set-ctrl=${ctrls}`], {
      timeout: 2000,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    // Non-fatal: camera might not expose every control, or v4l2-ctl is
    // missing. Stream still works with whatever the camera's current
    // state is.
    console.warn(`[camera] v4l2 ${mode === 'on' ? 'night' : 'day'} profile failed for ${device}: ${err.message?.slice(0, 200)}`);
  }
}

// UVC webcams enforce single-reader: only one process can hold /dev/videoN
// at a time. When the user toggles stream → snapshot the kernel takes a
// moment to release the device after SIGTERM, so a naive spawn races with
// the outgoing ffmpeg and hits EBUSY. We serialize all camera spawns here:
// a new request waits for any live ffmpeg to exit before opening.
let current = null; // { proc, exited: Promise<void> }

function killCurrent() {
  if (!current) return Promise.resolve();
  const c = current;
  current = null;
  try { c.proc.kill('SIGTERM'); } catch { /* ignore */ }
  return c.exited;
}

function trackFfmpeg(proc) {
  const exited = new Promise((resolve) => {
    proc.once('exit', resolve);
  });
  current = { proc, exited };
  proc.once('exit', () => {
    if (current && current.proc === proc) current = null;
  });
  return exited;
}

// The USB camera is independent of GPIO — reading from /dev/videoN never
// affects relays or sensors, so we don't gate it on GPIO_STUB. Stub mode
// triggers only when the configured device doesn't exist or isn't readable,
// e.g. no camera plugged in, or running on a dev machine.
function settings() {
  const all = Q.getAllSettings();
  return {
    device: all.camera_device || DEFAULT_DEVICE,
    resolution: all.camera_resolution || DEFAULT_RES,
    fps: parseInt(all.camera_fps, 10) || DEFAULT_FPS,
    quality: parseInt(all.camera_quality, 10) || DEFAULT_QUALITY,
    lowlight_mode: all.camera_lowlight_mode === 'on' ? 'on' : 'off',
  };
}

function deviceExists(path) {
  try { fs.accessSync(path, fs.constants.R_OK); return true; }
  catch { return false; }
}

function status() {
  const cfg = settings();
  const available = deviceExists(cfg.device);
  return {
    stub: !available,
    device: cfg.device,
    resolution: cfg.resolution,
    fps: cfg.fps,
    quality: cfg.quality,
    lowlight_mode: cfg.lowlight_mode,
    available,
  };
}

// Single static SVG used as the placeholder when no real camera is wired.
// Returned as image/svg+xml so an <img> tag in the UI just renders it.
function stubFrame(message = 'Stub mode — no live feed') {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
       <rect width="100%" height="100%" fill="#0b1115"/>
       <g fill="#94a3b8" font-family="ui-monospace, monospace">
         <text x="320" y="220" text-anchor="middle" font-size="22">📷</text>
         <text x="320" y="260" text-anchor="middle" font-size="16">${message}</text>
         <text x="320" y="290" text-anchor="middle" font-size="11" fill="#475569">${new Date().toISOString()}</text>
       </g>
     </svg>`,
    'utf-8'
  );
}

async function snapshot(res) {
  const cfg = settings();
  if (!deviceExists(cfg.device)) {
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-store');
    res.send(stubFrame(`No camera at ${cfg.device}`));
    return;
  }

  // Wait for any previous stream/snapshot to fully release the device
  // before opening a new ffmpeg. Without this a stream→snapshot toggle
  // races and hits EBUSY.
  await killCurrent();

  applyLowLightProfile(cfg.device, cfg.lowlight_mode);

  const useMjpeg = supportsMjpeg(cfg.device);
  const inputArgs = ['-f', 'v4l2'];
  if (useMjpeg) inputArgs.push('-input_format', 'mjpeg');
  inputArgs.push('-video_size', cfg.resolution, '-i', cfg.device);
  const outputArgs = useMjpeg
    ? ['-frames:v', '1', '-c:v', 'copy', '-f', 'mjpeg', '-']
    : ['-frames:v', '1', '-q:v', String(cfg.quality), '-f', 'image2', '-'];
  const ff = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', ...inputArgs, ...outputArgs],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  trackFfmpeg(ff);

  let responded = false;
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  ff.stdout.pipe(res);

  ff.stderr.on('data', (d) => {
    console.error('[camera] snapshot ffmpeg:', d.toString().trim());
  });
  ff.on('error', (err) => {
    if (responded) return;
    responded = true;
    res.status(503).type('text/plain').send(
      err.code === 'ENOENT' ? 'ffmpeg not installed' : `camera error: ${err.message}`
    );
  });
  ff.on('close', () => { responded = true; });

  res.on('close', () => {
    try { ff.kill('SIGTERM'); } catch { /* ignore */ }
  });
}

async function stream(req, res) {
  const cfg = settings();
  if (!deviceExists(cfg.device)) {
    // Single placeholder frame — an <img> tag will render it as a static image.
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-store');
    res.send(stubFrame(`No camera at ${cfg.device}`));
    return;
  }

  // Same reason as snapshot: let the outgoing ffmpeg (if any) release the
  // UVC device before we open a new one.
  await killCurrent();

  applyLowLightProfile(cfg.device, cfg.lowlight_mode);

  // Self-terminate streams after 15 min even if the client keeps the
  // connection open. A forgotten background tab otherwise pins ffmpeg
  // + the USB bandwidth indefinitely. Viewers that are still live
  // reconnect automatically via the browser's <img> reload path.
  const MAX_STREAM_SECONDS = 900;
  const useMjpeg = supportsMjpeg(cfg.device);
  const inputArgs = ['-f', 'v4l2'];
  if (useMjpeg) inputArgs.push('-input_format', 'mjpeg');
  inputArgs.push(
    '-video_size', cfg.resolution,
    '-framerate', String(cfg.fps),
    '-i', cfg.device,
  );
  const outputArgs = useMjpeg
    ? ['-t', String(MAX_STREAM_SECONDS), '-c:v', 'copy', '-f', 'mpjpeg', '-']
    : ['-t', String(MAX_STREAM_SECONDS), '-q:v', String(cfg.quality), '-f', 'mpjpeg', '-'];
  const ff = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', ...inputArgs, ...outputArgs],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  trackFfmpeg(ff);

  res.set('Content-Type', 'multipart/x-mixed-replace; boundary=ffmpeg');
  res.set('Cache-Control', 'no-store');
  res.set('Connection', 'close');

  ff.stdout.pipe(res);
  ff.stderr.on('data', (d) => {
    console.error('[camera] stream ffmpeg:', d.toString().trim());
  });
  ff.on('error', (err) => {
    console.error('[camera] stream ffmpeg spawn error:', err);
    if (!res.headersSent) res.status(503).end();
  });

  // Tear down ffmpeg when the client disconnects.
  const kill = () => { try { ff.kill('SIGTERM'); } catch { /* ignore */ } };
  res.on('close', kill);
  req.on('close', kill);
}

module.exports = { snapshot, stream, status, supportsMjpeg, applyLowLightProfile };
