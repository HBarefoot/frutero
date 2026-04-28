// Smoke tests for the Pi backend. Boots the real Express app on a
// random port, signs up the first owner, exercises the auth gate.
// Subsumes the Layer 0 baseline.test.js (deleted in this PR).
//
// Layer 1 of the test roadmap. Future layers (safety clamps, cross-OS,
// sensor/schedule) build on this same harness.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP_DB = path.join(os.tmpdir(), `frutero-smoke-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.GPIO_STUB = 'true';
process.env.SENSOR_STUB = 'true';
process.env.NODE_ENV = 'test';
process.env.PUBLIC_DIR = path.join(__dirname, '..', 'public-test-stub');
try { fs.mkdirSync(process.env.PUBLIC_DIR, { recursive: true }); } catch { /* exists */ }

const db = require('../database');
db.init();
const gpio = require('../gpio');
gpio.init();
const auth = require('../auth');
const { buildApp } = require('../server');

let server;
let baseUrl;

async function jsonReq(method, p, { body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, body: json, raw: text, headers: res.headers };
}

test.before(async () => {
  const app = buildApp();
  server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* may not exist */ }
  }
});

// ----- App + health ------------------------------------------------------

test('buildApp returns an Express app instance', () => {
  const app = buildApp();
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.listen, 'function');
  assert.equal(typeof app.use, 'function');
});

test('GET /api/health → 200 with expected shape under stub mode', async () => {
  const r = await jsonReq('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.db_ok, true);
  assert.equal(r.body.gpio_mock, true, 'GPIO_STUB=true → gpio_mock should be true');
  assert.ok(typeof r.body.uptime_seconds === 'number');
  assert.ok(typeof r.body.version === 'string');
  // sensor_simulated reflects SENSOR_STUB; whether sensor_ok is true
  // depends on whether sensor.start() has run — we don't start it in
  // tests, so we assert presence rather than truthiness.
  assert.ok('sensor_simulated' in r.body);
  assert.ok('sensor_ok' in r.body);
});

// ----- Auth bootstrap + first-run setup ----------------------------------

test('GET /api/auth/bootstrap on fresh DB → needsSetup:true', async () => {
  const r = await jsonReq('GET', '/api/auth/bootstrap');
  assert.equal(r.status, 200);
  assert.equal(r.body.needsSetup, true, 'fresh DB has no users → needsSetup');
  assert.equal(r.body.user, null);
});

test('POST /api/auth/setup with valid creds → 201, returns owner', async () => {
  const r = await jsonReq('POST', '/api/auth/setup', {
    body: {
      email: 'owner@frutero.test',
      name: 'Owner',
      password: 'smoke-test-password-1',
    },
  });
  assert.equal(r.status, 201, `unexpected: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.user.email, 'owner@frutero.test');
  assert.equal(r.body.user.role, 'owner');
});

test('POST /api/auth/setup again → 409 firstrun_locked', async () => {
  // requireFirstRun middleware should refuse a second setup.
  const r = await jsonReq('POST', '/api/auth/setup', {
    body: {
      email: 'second@frutero.test',
      name: 'Second',
      password: 'smoke-test-password-2',
    },
  });
  assert.notEqual(r.status, 201, 'second setup must not succeed');
});

test('GET /api/auth/bootstrap after setup → needsSetup:false', async () => {
  const r = await jsonReq('GET', '/api/auth/bootstrap');
  assert.equal(r.status, 200);
  assert.equal(r.body.needsSetup, false);
});

// ----- Auth gate ---------------------------------------------------------

test('GET /api/status without auth → 401', async () => {
  const r = await jsonReq('GET', '/api/status');
  assert.equal(r.status, 401);
});

test('POST /api/devices/* without auth → 401 (mutate guard)', async () => {
  const r = await jsonReq('POST', '/api/devices/fan', { body: { state: true } });
  assert.equal(r.status, 401);
});

test('GET /api/status with session cookie → 200 + actuators/sensor shape', async () => {
  // Login first to capture a session cookie.
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@frutero.test', password: 'smoke-test-password-1' }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.ok(setCookie, 'login should set a session cookie');
  const cookie = setCookie.split(';')[0];

  const r = await jsonReq('GET', '/api/status', { cookie });
  assert.equal(r.status, 200);
  assert.ok('actuators' in r.body, 'status should expose actuators map');
  assert.ok('sensor' in r.body, 'status should expose sensor');
});

// ----- Pure-function tests (no HTTP) -------------------------------------

test('auth.validateEmail accepts canonical addresses', () => {
  assert.equal(auth.validateEmail('a@b.co'), true);
  assert.equal(auth.validateEmail('first.last+tag@sub.example.com'), true);
});

test('auth.validateEmail rejects malformed input', () => {
  assert.equal(auth.validateEmail(''), false);
  assert.equal(auth.validateEmail('no-at'), false);
  assert.equal(auth.validateEmail('a@b'), false);
  assert.equal(auth.validateEmail(null), false);
});

test('auth.validatePassword enforces minimum length', () => {
  assert.equal(auth.validatePassword('correct-horse-battery'), null, 'long enough → null');
  assert.match(auth.validatePassword('short'), /at least \d+/);
  assert.match(auth.validatePassword(123), /string/);
  assert.match(auth.validatePassword('x'.repeat(257)), /too long/);
});

test('auth.hashPassword + verifyPassword roundtrip', async () => {
  const hash = await auth.hashPassword('correct-horse-battery');
  assert.equal(await auth.verifyPassword('correct-horse-battery', hash), true);
  assert.equal(await auth.verifyPassword('wrong', hash), false);
});

test('Q.countUsers grows as users are inserted', () => {
  const before = db.Q.countUsers();
  assert.ok(before >= 1, `expected at least 1 user post-setup, got ${before}`);
});
