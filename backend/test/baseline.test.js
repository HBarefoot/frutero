// Layer 0 baseline. Just enough to prove the buildApp refactor works
// and the test runner is wired correctly. Layer 1 adds the full smoke
// suite (HTTP routes, auth gating, etc.) on top of this.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP_DB = path.join(os.tmpdir(), `frutero-baseline-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.GPIO_STUB = 'true';
process.env.SENSOR_STUB = 'true';
process.env.NODE_ENV = 'test';
process.env.PUBLIC_DIR = path.join(__dirname, '..', 'public-test-stub');

// Make sure the static-dir path exists so express.static doesn't throw
// on fresh checkouts where backend/public hasn't been built yet.
try { fs.mkdirSync(process.env.PUBLIC_DIR, { recursive: true }); } catch { /* exists */ }

const db = require('../database');
db.init();
// Initialize GPIO in MOCK mode so health check reports gpio_mock=true.
// buildApp() doesn't call gpio.init() by design — that side-effect lives
// in main(). Tests that want a fully-wired server call init() themselves.
const gpio = require('../gpio');
gpio.init();
const { buildApp } = require('../server');

test.after(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* may not exist */ }
  }
});

test('buildApp returns an Express app instance', () => {
  const app = buildApp();
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.listen, 'function');
  assert.equal(typeof app.use, 'function');
});

test('buildApp app boots and binds to a random port', async () => {
  const app = buildApp();
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  assert.ok(port > 0 && port < 65536, `expected ephemeral port, got ${port}`);
  await new Promise((r) => server.close(r));
});

test('GET /api/health returns 200 + expected shape', async () => {
  const app = buildApp();
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.db_ok, true);
    assert.equal(body.gpio_mock, true, 'GPIO_STUB=true → gpio_mock should be true');
    assert.ok(typeof body.uptime_seconds === 'number');
    assert.ok(typeof body.version === 'string');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
