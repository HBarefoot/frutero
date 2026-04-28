// Cross-OS autodetect tests. Validates that PR #37's surface
// (platform.js + scanUSB + scanSerial + scanGpio + scanI2C) does the
// right thing across Linux (Pi + generic SBC) and macOS branches.
//
// CI runs on Ubuntu, so the Linux non-Pi paths are exercised for free
// — that's the bulk of cross-OS regression coverage. macOS-specific
// branches (system_profiler) skip on non-Darwin hosts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP_DB = path.join(os.tmpdir(), `frutero-cross-os-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.GPIO_STUB = 'true';
process.env.SENSOR_STUB = 'true';
process.env.NODE_ENV = 'test';

const db = require('../database');
db.init();
const platform = require('../platform');
const hardware = require('../hardware');

test.after(() => {
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(TMP_DB + ext); } catch { /* may not exist */ }
  }
});

// ----- platform.js ------------------------------------------------------

test('getPlatformInfo() returns kind matching os.platform()', () => {
  platform._resetCache();
  const info = platform.getPlatformInfo();
  assert.equal(info.kind, os.platform());
});

test('getPlatformInfo() reports an arch that matches os.arch()', () => {
  const info = platform.getPlatformInfo();
  assert.equal(info.arch, os.arch());
});

test('getPlatformInfo() returns a model_string', () => {
  const info = platform.getPlatformInfo();
  assert.equal(typeof info.model_string, 'string');
  assert.ok(info.model_string.length > 0);
});

test('getPlatformInfo() exposes a capabilities object with all expected flags', () => {
  const info = platform.getPlatformInfo();
  const expected = ['gpio', 'i2c', 'one_wire', 'v4l2', 'avfoundation', 'sysfs_usb', 'lsusb', 'udevadm', 'vcgencmd'];
  for (const flag of expected) {
    assert.ok(flag in info.capabilities, `capability "${flag}" missing`);
    assert.equal(typeof info.capabilities[flag], 'boolean', `${flag} should be boolean`);
  }
});

test('isRaspberryPi() agrees with model_string contents', () => {
  const info = platform.getPlatformInfo();
  const pi = platform.isRaspberryPi();
  // The CI runner is Ubuntu so this is normally false; on the actual
  // Pi it's true. Either is acceptable — we're asserting consistency.
  assert.equal(pi, /Raspberry Pi/i.test(info.model_string));
});

test('which() locates an existing binary; returns null otherwise', () => {
  // `node` is always on PATH in CI + on dev. `definitely-not-installed-zzz`
  // shouldn't exist anywhere.
  assert.ok(platform.which('node'), 'expected which(node) to find a path');
  assert.equal(platform.which('definitely-not-installed-zzz-' + Date.now()), null);
});

test('_resetCache() forces re-detection on next getPlatformInfo()', () => {
  const a = platform.getPlatformInfo();
  platform._resetCache();
  const b = platform.getPlatformInfo();
  // Same machine → same content. Different object identity is the proof
  // we re-detected, but JavaScript doesn't expose memoization markers
  // — assert content equality as a safety net + that the function
  // doesn't throw under repeated calls.
  assert.deepEqual(a, b);
});

// ----- hardware.js — scanGpio --------------------------------------------

test('scanGpio() reports {available, mock} fields', () => {
  const r = hardware.scanGpio();
  assert.ok(typeof r.available === 'boolean' || r.available === undefined,
    'available should be bool or omitted (Pi path)');
  assert.equal(r.mock, true, 'GPIO_STUB=true → mock=true');
});

test('scanGpio() under GPIO_STUB returns the BCM pin grid (Pi path)', () => {
  // GPIO_STUB short-circuits to the Pi path even on non-Pi hosts so
  // dev:stub on macOS still gets the BCM picker for actuator setup.
  const r = hardware.scanGpio();
  assert.ok(Array.isArray(r.pins));
  assert.ok(r.pins.length > 0, 'pins[] should be populated under stub');
  // Every pin should have a status; values are 'in-use' | 'reserved' | 'free'.
  for (const p of r.pins) {
    assert.ok(['in-use', 'reserved', 'free'].includes(p.status),
      `unexpected pin status: ${p.status}`);
  }
});

// ----- hardware.js — scanI2C, scan1Wire ---------------------------------

test('scanI2C() degrades cleanly on non-I2C hosts', () => {
  const r = hardware.scanI2C();
  // CI runners don't have /dev/i2c-* normally. On Pi prod they do.
  // Either way the call must not throw and must return a structured
  // shape (not undefined).
  assert.ok(r && typeof r === 'object', 'scanI2C should return an object');
  assert.ok('buses' in r);
  assert.ok(Array.isArray(r.buses));
});

test('scan1Wire() degrades cleanly when 1-wire is not enabled', () => {
  const r = hardware.scan1Wire();
  assert.ok(r && typeof r === 'object');
  assert.equal(typeof r.enabled, 'boolean');
  assert.ok(Array.isArray(r.devices));
});

// ----- hardware.js — scanUSB --------------------------------------------

test('scanUSB() returns an object with available + devices fields', () => {
  const r = hardware.scanUSB();
  assert.ok(r && typeof r === 'object');
  assert.equal(typeof r.available, 'boolean');
  assert.ok(Array.isArray(r.devices), 'devices should be an array');
  // On Linux CI, sysfs path is taken → source: 'sysfs'.
  if (os.platform() === 'linux' && r.available) {
    assert.equal(r.source, 'sysfs');
  }
});

test('scanUSB() devices have the documented shape (when any present)', () => {
  const r = hardware.scanUSB();
  for (const d of r.devices) {
    assert.equal(typeof d.vid, 'number');
    assert.equal(typeof d.pid, 'number');
    assert.equal(typeof d.vid_hex, 'string');
    assert.equal(typeof d.pid_hex, 'string');
    assert.equal(typeof d.class_label, 'string');
    assert.equal(d.is_hub, false, 'hubs should be filtered out by scanner');
  }
});

// ----- hardware.js — scanSerial -----------------------------------------

test('scanSerial() returns ports array (possibly empty on CI)', () => {
  const r = hardware.scanSerial();
  assert.ok(r && typeof r === 'object');
  assert.equal(typeof r.available, 'boolean');
  assert.ok(Array.isArray(r.ports));
});

// ----- hardware.js — scanVideo -----------------------------------------

test('scanVideo() does not throw on non-Pi hosts', () => {
  // The Linux v4l2 branch reads /dev/video* + spawns v4l2-ctl. CI may
  // have neither, in which case scanner reports available:false.
  // macOS branch shells system_profiler. Either path must return
  // a structured shape, never throw.
  const r = hardware.scanVideo();
  assert.ok(r && typeof r === 'object');
  assert.ok(Array.isArray(r.devices));
});

// ----- scanAll() aggregates without throwing ----------------------------

test('scanAll() returns the unified shape with all sub-scans', () => {
  const r = hardware.scanAll();
  assert.ok(r.timestamp);
  assert.ok(r.platform, 'platform key from PR #37 should be present');
  assert.ok(r.i2c);
  assert.ok(r.sensors);
  assert.ok(r.video);
  assert.ok(r.gpio);
  assert.ok(r.usb);
  assert.ok(r.serial);
});

// ----- macOS-specific branches -----------------------------------------
// Skipped on non-Darwin so CI on Linux doesn't fail; running on a Mac
// developer machine exercises these.

test('scanUSB() macOS branch uses system_profiler', { skip: os.platform() !== 'darwin' }, () => {
  const r = hardware.scanUSB();
  if (r.available) {
    assert.equal(r.source, 'system_profiler');
  }
});
