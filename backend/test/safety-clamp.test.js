// Safety clamp tests. Validates the mister safety logic that prevents
// substrate flooding (a single bug here can kill a $500 grow block).
//
// Tests through the existing gpio.setActuator() / safetyStatus() public
// API — no SafetyClamp class extraction. The clamp logic lives in
// gpio.js applyStateInternal + checkSafety + recordTransition; this
// fixture seeds an actuator with the same shape prod uses, fires
// transitions, and asserts the clamp behaves.
//
// Time-sensitive assertions (cooldown elapsed) manipulate gpio's
// internal `lastOffAt` Map directly via reflection rather than burning
// 30s of wall time per assertion. We're testing the clamp logic, not
// the wall-clock wait.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TMP_DB = path.join(os.tmpdir(), `frutero-safety-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.GPIO_STUB = 'true';
process.env.SENSOR_STUB = 'true';
process.env.NODE_ENV = 'test';

const db = require('../database');
db.init();
const gpio = require('../gpio');
gpio.init();
const { Q } = db;

const KEY = 'mister_test';

test.before(() => {
  // Seed a mister actuator with the canonical safety profile.
  Q.insertActuator({
    key: KEY,
    name: 'Mister (test)',
    kind: 'mister',
    gpio_pin: 27,
    inverted: false,
    enabled: true,
    auto_off_seconds: 10,
    config: { safety: { max_on_seconds: 30, min_off_seconds: 30, daily_max_seconds: 60 } },
  });
  gpio.reloadActuators();
});

test.after(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* may not exist */ }
  }
});

// Wipe gpio's in-memory clamp state between tests so each starts from
// a cold lastOffAt + zero daily usage without dropping the actuator
// row. The test-only export _resetForTesting() clears the Maps; we
// call reloadActuators() after to ensure the actuator metadata is
// still wired (reset doesn't touch `actuators`).
function resetClampState() {
  gpio._resetForTesting();
  gpio.reloadActuators();
}

// ----- safetyStatus shape -----------------------------------------------

test('safetyStatus returns clamp config + zero usage on a fresh actuator', () => {
  resetClampState();
  const s = gpio.safetyStatus(KEY);
  assert.ok(s, 'safetyStatus should be non-null for an actuator with safety config');
  assert.equal(s.safety.max_on_seconds, 30);
  assert.equal(s.safety.min_off_seconds, 30);
  assert.equal(s.safety.daily_max_seconds, 60);
  assert.equal(s.daily_used_seconds, 0);
  assert.equal(s.daily_remaining_seconds, 60);
});

// ----- min_off cooldown -------------------------------------------------

test('setActuator(true) succeeds on a fresh actuator', () => {
  resetClampState();
  const r = gpio.setActuator(KEY, true, 'manual');
  assert.equal(r.state, true);
  assert.equal(r.device, KEY);
});

test('setActuator(true) within min_off_seconds throws SafetyError', () => {
  resetClampState();
  // Fire on, then off — establishes lastOffAt = now.
  gpio.setActuator(KEY, true, 'manual');
  gpio.setActuator(KEY, false, 'manual');
  // Immediate retry should hit the 30s min_off clamp.
  assert.throws(
    () => gpio.setActuator(KEY, true, 'manual'),
    (err) => err.code === 'SAFETY_BLOCKED' && /min_off_seconds/.test(err.message),
    'expected SafetyError with min_off_seconds reason',
  );
});

test('setActuator(true) succeeds after min_off_seconds elapses', () => {
  resetClampState();
  gpio.setActuator(KEY, true, 'manual');
  gpio.setActuator(KEY, false, 'manual');
  // Simulate 31 seconds passing by rewinding lastOffAt directly via
  // gpio's internal state. Since gpio doesn't export the Map, we
  // exploit a property of recordTransition: calling setActuator with
  // a manual reload after manipulating state via a back-channel
  // doesn't give us what we want. Instead, just busy-wait would
  // burn 30s. Cleanest: drive recordTransition's `now` by faking
  // Date.now temporarily.
  const realNow = Date.now;
  const future = realNow() + 31_000;
  Date.now = () => future;
  try {
    const r = gpio.setActuator(KEY, true, 'manual');
    assert.equal(r.state, true, 'reactivation should succeed past min_off');
  } finally {
    Date.now = realNow;
  }
});

// ----- daily_max_seconds budget -----------------------------------------

test('daily_max_seconds blocks activation once exhausted', () => {
  resetClampState();
  // Fire on → off cycles to accumulate daily usage. We can't easily
  // burn 60+ wall-clock seconds; manipulate Date.now to make each
  // on→off cycle "cost" 35 seconds.
  const realNow = Date.now;
  let virtualNow = realNow();
  Date.now = () => virtualNow;
  try {
    // Cycle 1: 35s of on time
    gpio.setActuator(KEY, true, 'manual');
    virtualNow += 35_000;
    gpio.setActuator(KEY, false, 'manual');
    // Skip past min_off
    virtualNow += 31_000;
    // Cycle 2: another 35s — total 70s, over the 60s budget
    gpio.setActuator(KEY, true, 'manual');
    virtualNow += 35_000;
    gpio.setActuator(KEY, false, 'manual');
    // Skip past min_off
    virtualNow += 31_000;
    // Now activation should be blocked by daily_max
    assert.throws(
      () => gpio.setActuator(KEY, true, 'manual'),
      (err) => err.code === 'SAFETY_BLOCKED' && /daily_max_seconds/.test(err.message),
      'expected SafetyError with daily_max_seconds reason',
    );
    const s = gpio.safetyStatus(KEY);
    assert.ok(s.daily_used_seconds >= 60, `daily_used_seconds should be ≥60, got ${s.daily_used_seconds}`);
    assert.equal(s.daily_remaining_seconds, 0);
  } finally {
    Date.now = realNow;
  }
});

// ----- off path is never blocked ----------------------------------------

test('setActuator(false) always succeeds even when on-clamps would block', () => {
  resetClampState();
  gpio.setActuator(KEY, true, 'manual');
  // Off path bypasses checkSafety entirely (checkSafety returns null
  // when wantOn=false). Verify by calling repeatedly — second call
  // when already-off must not throw.
  const r1 = gpio.setActuator(KEY, false, 'manual');
  assert.equal(r1.state, false);
  const r2 = gpio.setActuator(KEY, false, 'manual');
  assert.equal(r2.state, false, 'second off-call should succeed (idempotent)');
});

// ----- schedule trigger honors clamps -----------------------------------

test('schedule-fire path honors min_off_seconds (not just manual triggers)', () => {
  resetClampState();
  gpio.setActuator(KEY, true, 'schedule');
  gpio.setActuator(KEY, false, 'schedule');
  // A schedule-fired retry within min_off must also throw, not silently
  // pass. This is the trigger-source regression class — make sure the
  // clamp doesn't get gated on a particular trigger value.
  assert.throws(
    () => gpio.setActuator(KEY, true, 'schedule'),
    (err) => err.code === 'SAFETY_BLOCKED',
    'schedule trigger must hit the same clamp as manual',
  );
});

// ----- safetyStatus reflects in-flight on -------------------------------

test('safetyStatus.daily_used_seconds increments after on→off cycle', () => {
  resetClampState();
  const realNow = Date.now;
  let virtualNow = realNow();
  Date.now = () => virtualNow;
  try {
    gpio.setActuator(KEY, true, 'manual');
    virtualNow += 5_000; // 5 seconds on
    gpio.setActuator(KEY, false, 'manual');
    const s = gpio.safetyStatus(KEY);
    // Allow ±1s slack since recordTransition's math involves Date.now
    // rounding. We expect ~5s of usage recorded.
    assert.ok(s.daily_used_seconds >= 4 && s.daily_used_seconds <= 6,
      `expected ~5s daily usage, got ${s.daily_used_seconds}`);
  } finally {
    Date.now = realNow;
  }
});
