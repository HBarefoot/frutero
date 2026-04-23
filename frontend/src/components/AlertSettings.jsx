import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import { saveAlerts } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

export default function AlertSettings({ alerts, onRefresh }) {
  const [form, setForm] = useState({
    temperature: { min: '', max: '', enabled: true },
    humidity: { min: '', max: '', enabled: true },
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = alerts?.config;
    if (!cfg) return;
    setForm({
      temperature: {
        min: cfg.temperature?.min ?? '',
        max: cfg.temperature?.max ?? '',
        enabled: cfg.temperature?.enabled !== false,
      },
      humidity: {
        min: cfg.humidity?.min ?? '',
        max: cfg.humidity?.max ?? '',
        enabled: cfg.humidity?.enabled !== false,
      },
    });
  }, [alerts?.config]);

  async function save() {
    setBusy(true);
    try {
      await saveAlerts({
        temperature: {
          min: form.temperature.min === '' ? null : Number(form.temperature.min),
          max: form.temperature.max === '' ? null : Number(form.temperature.max),
          enabled: form.temperature.enabled,
        },
        humidity: {
          min: form.humidity.min === '' ? null : Number(form.humidity.min),
          max: form.humidity.max === '' ? null : Number(form.humidity.max),
          enabled: form.humidity.enabled,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Alerts" subtitle="threshold monitoring">
      <Row
        label="Temperature"
        suffix="°F"
        data={form.temperature}
        onChange={(t) => setForm({ ...form, temperature: t })}
      />
      <Row
        label="Humidity"
        suffix="%"
        data={form.humidity}
        onChange={(h) => setForm({ ...form, humidity: h })}
      />
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="touch-btn mt-3 w-full rounded bg-shroom-accent/20 py-2 text-sm font-medium text-shroom-accent hover:bg-shroom-accent/30 disabled:opacity-50"
      >
        {saved ? 'Saved ✓' : 'Save thresholds'}
      </button>

      <div className="mt-4">
        <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">
          Recent alerts
        </p>
        <ul className="space-y-1 text-xs text-slate-400">
          {(alerts?.history || []).slice(0, 10).map((a, i) => (
            <li key={a.id || i} className="flex justify-between gap-2">
              <span className="text-shroom-alert">{a.message}</span>
              <span className="shrink-0 text-slate-500">{formatDateTime(a.timestamp)}</span>
            </li>
          ))}
          {(!alerts?.history || alerts.history.length === 0) && (
            <li className="text-slate-500">No alerts yet.</li>
          )}
        </ul>
      </div>
    </Panel>
  );
}

function Row({ label, suffix, data, onChange }) {
  return (
    <div className="mb-3 rounded border border-shroom-border bg-shroom-bg/60 p-3">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-200">{label}</span>
        <label className="flex items-center gap-1 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => onChange({ ...data, enabled: e.target.checked })}
          />
          enabled
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-400">
          min {suffix}
          <input
            type="number"
            value={data.min}
            onChange={(e) => onChange({ ...data, min: e.target.value })}
            className="mt-1 w-full rounded border border-shroom-border bg-shroom-bg px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          max {suffix}
          <input
            type="number"
            value={data.max}
            onChange={(e) => onChange({ ...data, max: e.target.value })}
            className="mt-1 w-full rounded border border-shroom-border bg-shroom-bg px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
      </div>
    </div>
  );
}
