const schedule = require('node-schedule');
const { CronExpressionParser } = require('cron-parser');
const gpio = require('./gpio');
const { Q } = require('./database');

const jobs = new Map();           // schedule id → node-schedule Job
const autoOffTimers = new Map();  // actuator key → Timeout

function runScheduledAction(row) {
  const key = row.device;
  const wantOn = row.action === 'on';

  if (!gpio.hasActuator(key)) {
    console.warn(`[scheduler] schedule #${row.id} references unknown actuator '${key}' — skipping`);
    return;
  }

  // Manual override: skip THIS scheduled event but clear the flag so the
  // next scheduled transition runs normally.
  if (gpio.isManualOverride(key)) {
    console.log(
      `[scheduler] skipping ${key} ${row.action} (schedule #${row.id}) — manual override active; clearing for next run`
    );
    gpio.clearManualOverride(key);
    return;
  }

  try {
    gpio.setActuator(key, wantOn, 'schedule');
  } catch (err) {
    console.error(`[scheduler] failed to apply ${key} ${row.action}:`, err);
    return;
  }

  // Pulse-style actuators (fan, mister) have a non-null auto_off_seconds.
  // For 'on' transitions we schedule an auto-off; for 'off' we clear any
  // pending auto-off so we don't double-write later.
  if (wantOn) {
    const seconds = gpio.autoOffSeconds(key);
    if (seconds && seconds > 0) {
      armAutoOff(key, seconds);
    }
  } else {
    clearAutoOff(key);
  }
}

function armAutoOff(key, seconds) {
  clearAutoOff(key);
  const timer = setTimeout(() => {
    try { gpio.setActuator(key, false, 'schedule'); }
    catch (err) { console.error(`[scheduler] auto-off ${key} failed:`, err); }
    finally { autoOffTimers.delete(key); }
  }, seconds * 1000);
  autoOffTimers.set(key, timer);
}

function clearAutoOff(key) {
  const t = autoOffTimers.get(key);
  if (t) {
    clearTimeout(t);
    autoOffTimers.delete(key);
  }
}

function clearAllAutoOff() {
  for (const t of autoOffTimers.values()) clearTimeout(t);
  autoOffTimers.clear();
}

function register(row) {
  try {
    const job = schedule.scheduleJob(row.cron_expression, () => runScheduledAction(row));
    if (job) {
      jobs.set(row.id, job);
    } else {
      console.warn(`[scheduler] invalid cron for schedule #${row.id}: ${row.cron_expression}`);
    }
  } catch (err) {
    console.error(`[scheduler] register failed for schedule #${row.id}:`, err);
  }
}

function unregisterAll() {
  for (const [id, job] of jobs) {
    try { job.cancel(); } catch { /* ignore */ }
    jobs.delete(id);
  }
  clearAllAutoOff();
}

function reload() {
  unregisterAll();
  const rows = Q.listEnabledSchedules();
  for (const row of rows) register(row);
  console.log(`[scheduler] loaded ${jobs.size} schedule(s)`);
}

function nextInvocations() {
  const out = {};
  for (const [id, job] of jobs) {
    const next = job.nextInvocation();
    out[id] = next ? next.toDate().toISOString() : null;
  }
  return out;
}

// Earliest upcoming 'on' invocation per actuator key, e.g.
// { fan: '2026-04-23T18:30:00.000Z', mister: null }. Used by the devices
// page to show each actuator's next scheduled fire.
function nextByDevice() {
  const rows = Q.listEnabledSchedules();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = {};
  for (const [id, job] of jobs) {
    const row = byId.get(id);
    if (!row || row.action !== 'on') continue;
    const next = job.nextInvocation();
    if (!next) continue;
    const iso = next.toDate().toISOString();
    const existing = out[row.device];
    if (!existing || iso < existing) out[row.device] = iso;
  }
  return out;
}

function runTimedTest(key, durationSec, userId = null) {
  if (!gpio.hasActuator(key)) {
    throw new Error(`unknown actuator '${key}'`);
  }
  // 'test' trigger leaves manualOverride unchanged — the next scheduled
  // transition runs normally instead of being skipped once.
  gpio.setActuator(key, true, 'test', userId);
  setTimeout(() => {
    try { gpio.setActuator(key, false, 'test', userId); }
    catch (err) { console.error('[scheduler] test auto-off failed:', err); }
  }, durationSec * 1000);
}

function shutdown() {
  unregisterAll();
}

// For a given actuator key, find the most-recent cron fire time across
// all enabled schedules targeting it, and return whether that fire was
// an 'on' or 'off'. Returns null if no schedule targets this actuator.
//
// Used at boot to figure out which latching devices (lights, heaters)
// should be ON right now based on the schedule — without this, a
// mid-photoperiod restart leaves lights off until the next 06:00 cron
// fire, which can be ~20 hours away.
function computeDesiredState(key) {
  const rows = Q.listEnabledSchedules().filter((s) => s.device === key);
  if (!rows.length) return null;

  const now = new Date();
  let bestTime = null;
  let bestAction = null;

  for (const s of rows) {
    try {
      const iter = CronExpressionParser.parse(s.cron_expression, { currentDate: now });
      const prevDate = iter.prev().toDate();
      if (!bestTime || prevDate > bestTime) {
        bestTime = prevDate;
        bestAction = s.action;
      }
    } catch (err) {
      console.warn(`[scheduler] bad cron '${s.cron_expression}' for schedule #${s.id}:`, err.message);
    }
  }

  return bestAction; // 'on' | 'off' | null
}

module.exports = {
  reload, unregisterAll, nextInvocations, nextByDevice, runTimedTest,
  computeDesiredState, shutdown,
};
