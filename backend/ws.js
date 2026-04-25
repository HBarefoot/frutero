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
  // verifyClient is the same pattern that worked pre-noServer-refactor.
  // ws-lib auto-rejects with 401 when cb(false, ...) is called; we
  // don't have to write the HTTP response manually. This keeps the
  // upgrade state-machine identical to the attached-mode setup that
  // browsers were happy with.
  wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    verifyClient: (info, cb) => {
      const sess = auth.resolveSessionFromHeader(info.req.headers.cookie);
      if (!sess) {
        console.log('[ws] verifyClient: rejected (no/invalid session)');
        return cb(false, 401, 'Unauthorized');
      }
      info.req.user = sess.user;
      cb(true);
    },
  });

  function handleUpgrade(req, socket, head) {
    // Diagnostic: log WS-relevant request headers so we know what the
    // browser sent. Specifically: extensions + protocol + version.
    const wsHeaders = {
      ext: req.headers['sec-websocket-extensions'] || '(none)',
      proto: req.headers['sec-websocket-protocol'] || '(none)',
      ver: req.headers['sec-websocket-version'] || '(none)',
      key_len: (req.headers['sec-websocket-key'] || '').length,
      head_len: head?.length ?? 'undef',
    };
    console.log(`[ws] req: ext=${wsHeaders.ext} proto=${wsHeaders.proto} ver=${wsHeaders.ver} key_len=${wsHeaders.key_len} head_len=${wsHeaders.head_len}`);

    // Diagnostic: capture exactly what ws-lib writes to the socket
    // during the upgrade. If the 101 response or any frame after it
    // is malformed, this surfaces the byte sequence.
    const origWrite = socket.write.bind(socket);
    let writes = 0;
    socket.write = function patchedWrite(chunk, ...args) {
      writes += 1;
      try {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        // Show first 200 bytes as JSON-escaped string so newlines + binary
        // are visible. Truncate to keep journalctl lines short.
        const preview = buf.toString('utf8', 0, Math.min(buf.length, 200));
        console.log(`[ws] socket.write #${writes} ${buf.length}B: ${JSON.stringify(preview)}`);
      } catch { /* ignore preview errors */ }
      return origWrite(chunk, ...args);
    };
    // Restore original write after a short delay so subsequent frames
    // (which we DON'T want to log per-message) go through unwrapped.
    setTimeout(() => {
      try { socket.write = origWrite; } catch { /* ignore */ }
    }, 1000);

    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const userEmail = req.user?.email || '?';
        console.log(`[ws] handleUpgrade: 101 → connection emitted for user ${userEmail}`);
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
