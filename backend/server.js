const http = require('http');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config');
const db = require('./database');
const ws = require('./ws');
const gpio = require('./gpio');
const sensor = require('./sensor');
const alerts = require('./alerts');
const scheduler = require('./scheduler');
const automations = require('./automations');
const auth = require('./auth');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const statusRoutes = require('./routes/status');
const deviceRoutes = require('./routes/devices');
const scheduleRoutes = require('./routes/schedule');
const readingsRoutes = require('./routes/readings');
const alertsRoutes = require('./routes/alerts');
const settingsRoutes = require('./routes/settings');
const testRoutes = require('./routes/test');
const actuatorRoutes = require('./routes/actuators');
const hardwareRoutes = require('./routes/hardware');
const mistingRoutes = require('./routes/misting');
const cameraRoutes = require('./routes/camera');

async function main() {
  db.init();
  gpio.init();
  sensor.setAlerts(alerts);
  sensor.setAutomations(automations);
  auth.startSessionJanitor();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use(auth.attachUser);

  // Unauthenticated healthcheck. Lightweight probe for load balancers,
  // monitoring, and the future cloud fleet agent. Never exposes PII.
  const bootedAt = Date.now();
  app.get('/api/health', (_req, res) => {
    let dbOk = false;
    try { dbOk = typeof db.Q.countUsers() === 'number'; } catch { /* ignore */ }
    const latest = sensor.getLatest();
    // Sensor is "ok" if we've seen any reading in the last 5 minutes.
    const sensorOk = !!latest.timestamp
      && (Date.now() - new Date(latest.timestamp).getTime()) < 5 * 60 * 1000;
    const status = dbOk && (sensorOk || latest.simulated) ? 'ok' : 'degraded';
    res.status(dbOk ? 200 : 503).json({
      status,
      uptime_seconds: Math.floor((Date.now() - bootedAt) / 1000),
      db_ok: dbOk,
      sensor_ok: sensorOk,
      sensor_simulated: !!latest.simulated,
      gpio_mock: gpio.isMock(),
      version: '0.3',
    });
  });

  // Auth routes are unauthenticated (bootstrap / login / setup wizard /
  // invite accept). /auth/me requires a session but the router handles
  // that internally.
  app.use('/api', authRoutes);

  // Everything else under /api requires an authenticated session.
  app.use('/api', auth.requireAuth);

  // Any non-GET to /api (mutation) needs at least operator-level access.
  // Owner-only actions add `requireAdmin` inside their individual routers.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET') return next();
    return auth.requireMutate(req, res, next);
  });

  app.use('/api', statusRoutes);
  app.use('/api', deviceRoutes);
  app.use('/api', scheduleRoutes);
  app.use('/api', readingsRoutes);
  app.use('/api', alertsRoutes);
  app.use('/api', settingsRoutes);
  app.use('/api', testRoutes);
  app.use('/api', actuatorRoutes);
  app.use('/api', hardwareRoutes);
  app.use('/api', mistingRoutes);
  app.use('/api', cameraRoutes);
  app.use('/api', usersRoutes);

  const publicDir = path.isAbsolute(config.PUBLIC_DIR)
    ? config.PUBLIC_DIR
    : path.join(__dirname, config.PUBLIC_DIR);
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) next();
    });
  });

  app.use((err, _req, res, _next) => {
    console.error('[http] error:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  });

  const server = http.createServer(app);
  ws.attach(server);

  scheduler.reload();
  sensor.start();

  server.listen(config.PORT, () => {
    console.log(`[server] listening on :${config.PORT} (gpioMock=${gpio.isMock()})`);
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} received — shutting down`);
    try {
      sensor.stop();
      scheduler.shutdown();
      gpio.cleanup();
    } finally {
      server.close(() => process.exit(0));
      // Safety: force exit after 5s if server.close hangs
      setTimeout(() => process.exit(0), 5000).unref();
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException:', err);
    gpio.cleanup();
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[server] fatal:', err);
  try {
    gpio.cleanup();
  } catch {
    // ignore
  }
  process.exit(1);
});
