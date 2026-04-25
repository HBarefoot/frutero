const { Q } = require('../database');

// Opt-in access log. Off by default so it doesn't fill journald in
// production. Toggled via the `access_log_enabled` setting from the
// Security page; the toggle is read on every request so it can be
// flipped without a server restart.
//
// Filtered to skip noisy polls (/api/status every few seconds) and
// static assets — both add log volume without diagnostic value for
// the terminal-init bug we're chasing.

const SKIP_PATHS = ['/api/status', '/healthz', '/manifest.json', '/sw.js', '/favicon.ico'];
const SKIP_PREFIXES = ['/assets/'];

function shouldSkip(req) {
  if (SKIP_PATHS.includes(req.path)) return true;
  for (const p of SKIP_PREFIXES) {
    if (req.path.startsWith(p)) return true;
  }
  return false;
}

module.exports = function accessLog() {
  return function accessLogMiddleware(req, res, next) {
    // Cheap setting read; getAllSettings is cached in better-sqlite3
    // prepared statements so this is microseconds.
    const enabled = Q.getAllSettings().access_log_enabled === '1';
    if (!enabled || shouldSkip(req)) return next();

    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const userId = req.user?.id ?? '-';
      console.log(
        `[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(0)}ms user=${userId}`
      );
    });
    next();
  };
};
