const schedule = require('node-schedule');
const config = require('./config');
const gpio = require('./gpio');
const { Q } = require('./database');

const jobs = new Map(); // id → node-schedule Job
const autoOffTimers = new Map(); // device → Timeout

function fanOnDuration() {
  const fromSetting = parseInt(Q.getAllSettings().fan_on_duration, 10);
  return Number.isFinite(fromSetting) && fromSetting > 0
    ? fromSetting
    : config.FAN_ON_DURATION;
}

function runScheduledAction(row) {
  const device = row.device;
  const wantOn = row.action === 'on';

  // Manual override: skip THIS scheduled event but clear the flag so
  // the next scheduled transition runs normally.
  if (gpio.isManualOverride(device)) {
    console.log(
      `[scheduler] skipping ${device} ${row.action} (schedule #${row.id}) — manual override active; clearing for next run`
    );
    gpio.clearManualOverride(device);
    return;
  }

  try {
    if (device === 'fan') {
      gpio.setFan(wantOn, 'schedule');
    } else if (device === 'light') {
      gpio.setLight(wantOn, 'schedule');
    }
  } catch (err) {
    console.error(`[scheduler] failed to apply ${device} ${row.action}:`, err);
    return;
  }

  // Fan-on schedules auto-off after FAN_ON_DURATION (the FAE cycle pattern).
  if (device === 'fan' && wantOn) {
    clearFanAutoOff();
    const ms = fanOnDuration() * 1000;
    const timer = setTimeout(() => {
      try {
        gpio.setFan(false, 'schedule');
      } catch (err) {
        console.error('[scheduler] fan auto-off failed:', err);
      } finally {
        autoOffTimers.delete('fan');
      }
    }, ms);
    autoOffTimers.set('fan', timer);
  }
}

function clearFanAutoOff() {
  const t = autoOffTimers.get('fan');
  if (t) {
    clearTimeout(t);
    autoOffTimers.delete('fan');
  }
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
    try {
      job.cancel();
    } catch {
      // ignore
    }
    jobs.delete(id);
  }
  clearFanAutoOff();
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

function runTimedTest(device, durationSec) {
  const setter = device === 'fan' ? gpio.setFan : gpio.setLight;
  setter(true, 'api');
  setTimeout(() => {
    try {
      setter(false, 'api');
    } catch (err) {
      console.error('[scheduler] test auto-off failed:', err);
    }
  }, durationSec * 1000);
}

function shutdown() {
  unregisterAll();
}

module.exports = { reload, unregisterAll, nextInvocations, runTimedTest, shutdown };
