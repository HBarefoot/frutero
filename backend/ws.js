const { WebSocketServer } = require('ws');
const auth = require('./auth');

let wss;
const clients = new Set();

function attach(server) {
  // noServer mode: server.js dispatches upgrade events to handleUpgrade
  // for /ws, /terminal goes to the ttyd proxy. Path filtering used to
  // happen inside WebSocketServer (path: '/ws') but that aborts every
  // upgrade that doesn't match — including /terminal — so we route at
  // the http.Server level now.
  //
  // permessage-deflate disabled: when enabled, Chromium-based browsers
  // hitting our WSS endpoint over a self-signed-cert origin sometimes
  // close the freshly-established WS with code 1002 "WebSocket Protocol
  // Error" — frame negotiation between browser deflate and Node ws's
  // deflate desyncs. Our payloads are tiny (sensor readings, alerts;
  // a few hundred bytes per message), so compression overhead isn't
  // worth the interop fragility.
  wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  function handleUpgrade(req, socket, head) {
    const sess = auth.resolveSessionFromHeader(req.headers.cookie);
    if (!sess) {
      console.log('[ws] handleUpgrade: 401 (no/invalid session)');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    req.user = sess.user;
    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        console.log(`[ws] handleUpgrade: 101 → connection emitted for user ${sess.user.email}`);
        wss.emit('connection', ws, req);
      });
    } catch (err) {
      console.error('[ws] handleUpgrade: threw:', err.message);
      try { socket.destroy(); } catch { /* ignore */ }
    }
  }
  // Expose for server.js's upgrade router.
  attach.handleUpgrade = handleUpgrade;

  wss.on('connection', (ws, req) => {
    ws.user = req.user || null;
    clients.add(ws);
    ws.isAlive = true;
    console.log(`[ws] connection added: user=${ws.user?.email || '?'} clients=${clients.size}`);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'subscribe') {
          ws.subscribed = true;
        }
      } catch {
        // ignore malformed client messages
      }
    });

    ws.on('close', (code, reason) => {
      clients.delete(ws);
      console.log(`[ws] close: user=${ws.user?.email || '?'} code=${code} reason=${reason?.toString() || '(none)'} remaining=${clients.size}`);
    });

    ws.on('error', (err) => {
      clients.delete(ws);
      console.log(`[ws] error: user=${ws.user?.email || '?'} ${err.message}`);
    });
  });

  // How many consecutive missed pongs we tolerate before terminating.
  // Default 2 = the client has up to ~60s to respond, instead of the
  // 30s a single-tick check gave. Buys headroom for transient CPU
  // stalls (e.g., the multi-handshake burst when a new tab opens
  // /terminal/) without holding dead sockets indefinitely.
  const MISSED_PONG_THRESHOLD = 2;

  const heartbeat = setInterval(() => {
    let alive = 0;
    let terminated = 0;
    for (const ws of clients) {
      if (ws.isAlive === false) {
        ws.missedPongs = (ws.missedPongs || 0) + 1;
        if (ws.missedPongs >= MISSED_PONG_THRESHOLD) {
          ws.terminate();
          clients.delete(ws);
          terminated += 1;
          continue;
        }
        // First miss — log once + skip the ping for this tick (sending
        // another would race with the late pong). Wait one more tick.
        console.log(`[ws] missed pong (#${ws.missedPongs}); will retry`);
        continue;
      }
      ws.isAlive = false;
      ws.missedPongs = 0;
      try {
        ws.ping();
        alive += 1;
      } catch {
        clients.delete(ws);
      }
    }
    // Diagnostic: surface termination counts so we can see if a CPU
    // spike during /terminal init caused the existing /ws to miss a
    // pong and get terminated.
    if (terminated > 0) {
      console.log(`[ws] heartbeat tick: alive=${alive} terminated=${terminated}`);
    }
  }, 30000);
  // Don't let the heartbeat keep the event loop alive during shutdown —
  // without this, the `server.close()` callback never fires because this
  // interval is still live, and the 5s safety timeout has .unref().
  heartbeat.unref();

  wss.on('close', () => clearInterval(heartbeat));

  // Also clear heartbeat + drop all client sockets when the underlying
  // HTTP server closes — WebSocketServer doesn't always propagate this.
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const ws of clients) {
      try {
        ws.terminate();
      } catch {
        // ignore
      }
    }
    clients.clear();
  });
}

function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(payload);
      } catch {
        // drop; next heartbeat will clean up
      }
    }
  }
}

module.exports = { attach, broadcast, handleUpgrade: (...a) => attach.handleUpgrade(...a) };
