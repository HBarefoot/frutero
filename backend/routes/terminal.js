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
// http-proxy-middleware v3 moved hooks under the `on` map.
const proxy = createProxyMiddleware({
  target: 'http://127.0.0.1:7681',
  changeOrigin: true,
  ws: true,
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

router.use('/terminal', auth.requireAdmin, proxy);

// Export both router (for HTTP) and the underlying proxy (server.js
// wires it into the upgrade event for WebSocket forwarding).
module.exports = { router, proxy };
