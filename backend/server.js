const http = require('http');
const https = require('https');
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
const { securityHeaders } = require('./middleware/security-headers');
const { originCheck } = require('./middleware/origin-check');
const { loadTlsCredentials } = require('./tls');

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
const securityRoutes = require('./routes/security');
const clientErrorsRoutes = require('./routes/client-errors');

async function main() {
  db.init();
  gpio.init();
  sensor.setAlerts(alerts);
  sensor.setAutomations(automations);
  auth.startSessionJanitor();

  const tlsCreds = loadTlsCredentials();
  const tlsActive = !!tlsCreds;

  const app = express();
  app.set('trust proxy', true);
  // Helmet's HSTS + CSP upgrade-insecure-requests only enable when TLS
  // is actually live — avoids trapping operators in HTTPS-redirect hell
  // if the cert is later removed for some reason.
  app.use(securityHeaders({ tlsEnabled: tlsActive }));
  app.use(originCheck({
    trustedOrigins: (process.env.TRUSTED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }));
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
  app.use('/api', securityRoutes);
  app.use('/api', clientErrorsRoutes);

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

  // Primary server carries the real app. If TLS is live, it's HTTPS on
  // HTTPS_PORT and an auxiliary HTTP redirector listens on PORT. If TLS
  // is off, the app serves HTTP directly on PORT.
  const primaryServer = tlsActive
    ? https.createServer(tlsCreds, app)
    : http.createServer(app);
  ws.attach(primaryServer);

  let redirectServer = null;
  if (tlsActive) {
    const redirectApp = express();
    redirectApp.use((req, res) => {
      const host = (req.headers.host || '').split(':')[0];
      const target = `https://${host}:${config.HTTPS_PORT}${req.url}`;
      res.redirect(301, target);
    });
    redirectServer = http.createServer(redirectApp);
  }

  scheduler.reload();
  // Re-apply latching actuator states (lights, heaters) based on the
  // most-recent scheduled fire. Safe to run always; no-op when nothing
  // needs restoring. Pulse devices are intentionally excluded inside.
  gpio.restoreScheduledStates(scheduler);
  sensor.start();

  const primaryPort = tlsActive ? config.HTTPS_PORT : config.PORT;
  primaryServer.listen(primaryPort, () => {
    console.log(
      `[server] ${tlsActive ? 'HTTPS' : 'HTTP'} listening on :${primaryPort} (gpioMock=${gpio.isMock()})`
    );
  });
  if (redirectServer) {
    redirectServer.listen(config.PORT, () => {
      console.log(
        `[server] HTTP redirect on :${config.PORT} → https://:${config.HTTPS_PORT}`
      );
    });
  }

  const shutdown = (signal) => {
    console.log(`[server] ${signal} received — shutting down`);
    try {
      sensor.stop();
      scheduler.shutdown();
      gpio.cleanup();
    } finally {
      if (redirectServer) {
        try { redirectServer.close(); } catch { /* ignore */ }
      }
      primaryServer.close(() => process.exit(0));
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
