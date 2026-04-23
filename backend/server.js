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

async function main() {
  db.init();
  gpio.init();
  sensor.setAlerts(alerts);
  auth.startSessionJanitor();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use(auth.attachUser);

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
