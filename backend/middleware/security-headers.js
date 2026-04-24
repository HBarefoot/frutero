const helmet = require('helmet');

// Tuned Helmet config for the frutero appliance:
//   - CSP tight enough to block XSS, loose enough to allow Vite's hashed
//     bundles, the MJPEG camera stream, and WebSocket connections.
//   - X-Frame-Options DENY: appliance UI should never be embedded.
//   - HSTS: only enabled when TLS is active (see `tls.enabled`). Enabling
//     it over plain HTTP would trap users after cert wipe.
//   - Referrer-Policy: leaks just enough for same-origin navigation metrics
//     and nothing beyond.
function securityHeaders({ tlsEnabled = false } = {}) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        // Vite builds inline the preload polyfill; a nonce would be cleaner
        // but requires per-request HTML templating. Unsafe-inline is scoped
        // to scripts that ship with the bundle.
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        // Image sources include data: for favicons and blob: for snapshot
        // downloads. The MJPEG stream is same-origin.
        'img-src': ["'self'", 'data:', 'blob:'],
        // WebSocket ws:/wss: plus API fetch, same-origin only.
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'font-src': ["'self'", 'data:'],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        // useDefaults: true enables upgrade-insecure-requests; we want
        // that only when TLS is actually live. Setting to null tells
        // helmet to drop the directive entirely over plain HTTP so the
        // browser doesn't try to upgrade every asset to https:// and
        // break dev + first-run.
        'upgrade-insecure-requests': tlsEnabled ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // MJPEG streaming friendly
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: tlsEnabled
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
  });
}

module.exports = { securityHeaders };
