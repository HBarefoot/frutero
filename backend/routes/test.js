const express = require('express');
const scheduler = require('../scheduler');
const auth = require('../auth');

const router = express.Router();

router.post('/test', (req, res) => {
  const { device, duration } = req.body || {};
  if (!['fan', 'light'].includes(device)) {
    return res.status(400).json({ error: 'device must be fan|light' });
  }
  const sec = Number(duration);
  if (!Number.isFinite(sec) || sec <= 0 || sec > 300) {
    return res.status(400).json({ error: 'duration must be 1-300 seconds' });
  }
  scheduler.runTimedTest(device, sec, req.user?.id ?? null);
  auth.logAudit(req, 'device.test', `device:${device}`, { duration: sec });
  res.json({ success: true, message: `${device} ON for ${sec}s` });
});

module.exports = router;
