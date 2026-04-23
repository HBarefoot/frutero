const fs = require('fs');
const { spawn } = require('child_process');
const { Q } = require('./database');

const DEFAULT_DEVICE = '/dev/video0';
const DEFAULT_RES = '640x480';
const DEFAULT_FPS = 10;
const DEFAULT_QUALITY = 7; // ffmpeg -q:v scale (lower = better)

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

function snapshot(res) {
  const cfg = settings();
  if (!deviceExists(cfg.device)) {
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-store');
    res.send(stubFrame(`No camera at ${cfg.device}`));
    return;
  }

  const ff = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'v4l2',
      '-video_size', cfg.resolution,
      '-i', cfg.device,
      '-frames:v', '1',
      '-q:v', String(cfg.quality),
      '-f', 'image2',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

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

function stream(req, res) {
  const cfg = settings();
  if (!deviceExists(cfg.device)) {
    // Single placeholder frame — an <img> tag will render it as a static image.
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-store');
    res.send(stubFrame(`No camera at ${cfg.device}`));
    return;
  }

  const ff = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'v4l2',
      '-video_size', cfg.resolution,
      '-framerate', String(cfg.fps),
      '-i', cfg.device,
      '-q:v', String(cfg.quality),
      '-f', 'mpjpeg',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

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

module.exports = { snapshot, stream, status };
