const express = require('express');
const { Q } = require('../database');

const router = express.Router();

router.get('/readings', (req, res) => {
  let hours = parseInt(req.query.hours, 10);
  if (!Number.isFinite(hours) || hours <= 0) hours = 24;
  if (hours > 168) hours = 168;
  res.json(Q.getReadings(hours));
});

router.get('/readings/stats', (req, res) => {
  let hours = parseInt(req.query.hours, 10);
  if (!Number.isFinite(hours) || hours <= 0) hours = 24;
  if (hours > 168) hours = 168;
  res.json(Q.getReadingStats(hours));
});

router.get('/device-log', (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  if (limit > 500) limit = 500;
  res.json(Q.getDeviceLog(limit));
});

module.exports = router;
