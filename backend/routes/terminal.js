const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const auth = require('../auth');

// Proxy /terminal/* to the local ttyd on 127.0.0.1:7681. Two layers of
// auth:
//   1. Pi session cookie via auth.requireAdmin (stops anyone without an
//      admin login from even reaching ttyd).
//   2. ttyd basic auth ("frutero:<terminal_password>") inside the proxy
//      (defense-in-depth — if the cookie auth is ever bypassed by a
//      proxy bug or future refactor, the credential prompt still gates
//      shell access).
//
// ttyd is started with --base-path /terminal so its HTML serves assets
// relative to /terminal/, eliminating the need for client-side path
// rewrites. We don't strip the prefix here.

const router = express.Router();

// Anchor the auth gate before the proxy. Note: WebSocket upgrade
// requests don't carry the session cookie automatically — browsers
// only send cookies for same-origin XHR/WS, which holds here since
// the page itself was served from the same origin via this proxy.
// The Express requireAdmin middleware checks `req.user`, which the
// auth middleware populates from the cookie at attachUser time.
// Auth gate. JSON 401 for API-style requests (XHR / fetch), redirect to
// /login?next= for browser navigations so the cloud "Open Terminal"
// button doesn't dump a raw {"error":"unauthenticated"} into a fresh tab.
function terminalAuthGate(req, res, next) {
  const adminOK = req.user && auth.PERMISSIONS.admin.includes(req.user.role);
  if (adminOK) return next();
  const acceptsHtml = (req.headers.accept || '').includes('text/html');
  if (acceptsHtml) {
    const next_ = req.originalUrl || '/terminal/';
    return res.redirect(302, `/login?next=${encodeURIComponent(next_)}`);
  }
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  return res.status(403).json({ error: 'forbidden', required: 'admin' });
}

// http-proxy-middleware v3 moved hooks under the `on` map.
const proxy = createProxyMiddleware({
  target: 'http://127.0.0.1:7681',
  changeOrigin: true,
  ws: true,
  // Express's router.use('/terminal', ...) strips the prefix from
  // req.url before this middleware sees it, but ttyd is started with
  // --base-path /terminal and expects the prefix to be present. Restore
  // it before forwarding so /terminal/ → ttyd's /terminal/ index, not
  // the 404-returning bare /.
  //
  // WebSocket upgrades go through proxy.upgrade() directly (server.js)
  // without Express ever touching req.url, so the prefix is still
  // present. Guard against double-prefixing.
  pathRewrite: (path) => path.startsWith('/terminal') ? path : `/terminal${path}`,
  on: {
    // Strip security-relevant headers before forwarding so ttyd
    // doesn't see the operator's session cookie. ttyd has its own
    // credential gate; cross-leakage isn't useful.
    proxyReq: (proxyReq) => {
      proxyReq.removeHeader('cookie');
    },
    // Make the "ttyd not running" path return a clean 502 instead of
    // a default error page — operator sees state via /security/terminal.
    error: (_err, _req, res) => {
      if (res && res.writableEnded === false) {
        res.statusCode = 502;
        res.end('terminal_unreachable');
      }
    },
  },
});

router.use('/terminal', terminalAuthGate, proxy);

// Export both router (for HTTP) and the underlying proxy (server.js
// wires it into the upgrade event for WebSocket forwarding).
module.exports = { router, proxy };
