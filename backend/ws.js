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
  wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(req, socket, head) {
    const sess = auth.resolveSessionFromHeader(req.headers.cookie);
    if (!sess) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    req.user = sess.user;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
  // Expose for server.js's upgrade router.
  attach.handleUpgrade = handleUpgrade;

  wss.on('connection', (ws, req) => {
    ws.user = req.user || null;
    clients.add(ws);
    ws.isAlive = true;

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

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  const heartbeat = setInterval(() => {
    let alive = 0;
    let terminated = 0;
    for (const ws of clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        clients.delete(ws);
        terminated += 1;
        continue;
      }
      ws.isAlive = false;
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
