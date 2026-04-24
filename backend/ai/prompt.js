const { Q } = require('../database');
const gpio = require('../gpio');
const sensor = require('../sensor');

const SYSTEM_PROMPT = `You are an expert mushroom-cultivation advisor embedded in a grow-chamber automation platform called frutero.

Every few hours you review the chamber's current conditions, device state, active species program, recent events, and automation config. Your job is to surface up to 3 **actionable insights** for the grower.

Constraints:
- You are an **advisor**, not a controller. You NEVER actuate devices. The owner reviews and applies changes manually.
- Be concise. Each insight's body should be 1–3 short sentences.
- Prefer plain-English grower language. Avoid jargon unless the grower's context already uses it.
- Only speak up when there is something meaningful to say. It is fine (and often correct) to return 0 insights.
- Safety clamps on the mister (max-on, min-off, daily cap) exist to protect the piezo disc — never recommend disabling them.

Output schema: Return a JSON object matching this shape exactly:

{
  "insights": [
    {
      "category": "observation" | "recommendation" | "warning",
      "severity": "info" | "warn",
      "title": "Short, specific title (<=80 chars)",
      "body": "Plain-language explanation (1-3 sentences)",
      "actions": [
        { "label": "User-facing button label", "hint": "What to click in the UI, e.g., 'Devices → Mister → lower threshold to 82'" }
      ]
    }
  ]
}

If there is nothing useful to say, return { "insights": [] }. Never wrap the JSON in code fences or prose.`;

function buildContext() {
  const settings = Q.getAllSettings();
  const actuators = gpio.listActuators();
  const health = sensor.getHealth();
  const latest = sensor.getLatest();
  const schedules = Q.listSchedules();
  const alertConfigs = Q.getAlertConfig();
  const alertHistory = Q.getAlertHistory(10);
  const recentActivity = Q.getDeviceLog(15);

  const snapshot = {
    timestamp: new Date().toISOString(),
    species: {
      current: settings.species || null,
      presets: Object.fromEntries(
        Object.entries(require('../config').SPECIES_PRESETS).map(([k, v]) => [k, {
          name: v.name,
          temp_range: `${v.temp_min}-${v.temp_max}°F`,
          humid_range: `${v.humid_min}-${v.humid_max}%`,
          fan_interval_min: v.fan_interval,
          mister_threshold: v.mister_threshold,
          mister_pulse_sec: v.mister_pulse_seconds,
        }])
      ),
    },
    sensor: {
      last_reading: latest.timestamp
        ? { temp_f: latest.temperature, humidity_pct: latest.humidity, simulated: latest.simulated }
        : null,
      health: {
        ok: health.ok,
        silent: health.silent,
        silent_seconds: health.silent_seconds,
        last_success_at: health.last_success_at,
      },
    },
    actuators: actuators.map((a) => ({
      key: a.key,
      kind: a.kind,
      name: a.name,
      state: a.state,
      manual_override: a.manualOverride,
      auto_off_seconds: a.auto_off_seconds,
      safety: a.config?.safety || null,
    })),
    schedules: schedules.map((s) => ({
      device: s.device,
      action: s.action,
      cron: s.cron_expression,
      enabled: !!s.enabled,
      label: s.label,
    })),
    alert_config: alertConfigs,
    recent_alerts: alertHistory.map((a) => ({
      timestamp: a.timestamp,
      metric: a.metric,
      value: a.value,
      threshold: a.threshold,
      message: a.message,
    })),
    mister_automation: {
      enabled: settings.mister_automation_enabled === '1',
      humidity_threshold: parseFloat(settings.mister_humidity_threshold) || null,
      pulse_seconds: parseInt(settings.mister_pulse_seconds, 10) || null,
    },
    recent_activity: recentActivity.map((r) => ({
      timestamp: r.timestamp,
      device: r.device,
      state: !!r.state,
      trigger: r.trigger,
    })),
  };

  return snapshot;
}

function userPrompt(snapshot) {
  return `Here is the current chamber state as JSON. Review it and return up to 3 insights per the system instructions. Respond with JSON only — no prose, no code fences.

${JSON.stringify(snapshot, null, 2)}`;
}

module.exports = { SYSTEM_PROMPT, buildContext, userPrompt };
