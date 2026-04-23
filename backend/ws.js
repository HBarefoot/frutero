const { WebSocketServer } = require('ws');

let wss;
const clients = new Set();

function attach(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
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
    for (const ws of clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        clients.delete(ws);
      }
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

module.exports = { attach, broadcast };
