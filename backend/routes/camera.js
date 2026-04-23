const express = require('express');
const camera = require('../camera');
const { Q } = require('../database');
const auth = require('../auth');

const router = express.Router();

router.get('/camera', (_req, res) => {
  res.json(camera.status());
});

router.put('/camera', auth.requireAdmin, (req, res) => {
  const body = req.body || {};
  const errs = [];
  if (body.device !== undefined && (typeof body.device !== 'string' || !/^\/dev\/video\d+$/.test(body.device))) {
    errs.push('device must be a /dev/videoN path');
  }
  if (body.resolution !== undefined && !/^\d+x\d+$/.test(body.resolution)) {
    errs.push('resolution must be like 640x480');
  }
  if (body.fps !== undefined) {
    const n = Number(body.fps);
    if (!Number.isFinite(n) || n < 1 || n > 60) errs.push('fps must be 1-60');
  }
  if (body.quality !== undefined) {
    const n = Number(body.quality);
    if (!Number.isFinite(n) || n < 1 || n > 31) errs.push('quality must be 1-31');
  }
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });

  if (body.device !== undefined) Q.setSetting('camera_device', body.device);
  if (body.resolution !== undefined) Q.setSetting('camera_resolution', body.resolution);
  if (body.fps !== undefined) Q.setSetting('camera_fps', String(body.fps));
  if (body.quality !== undefined) Q.setSetting('camera_quality', String(body.quality));

  auth.logAudit(req, 'camera.config', null, body);
  res.json(camera.status());
});

router.get('/camera/snapshot', (req, res) => camera.snapshot(res));
router.get('/camera/stream', (req, res) => camera.stream(req, res));

module.exports = router;
