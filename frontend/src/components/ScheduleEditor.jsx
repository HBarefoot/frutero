import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import {
  fetchSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from '../lib/api.js';

const PRESETS = [
  {
    label: 'Standard light (12/12)',
    items: [
      { device: 'light', action: 'on', cron_expression: '0 6 * * *', label: 'Lights ON 6 AM' },
      { device: 'light', action: 'off', cron_expression: '0 18 * * *', label: 'Lights OFF 6 PM' },
    ],
  },
  {
    label: 'FAE cycle (every 30min)',
    items: [
      { device: 'fan', action: 'on', cron_expression: '*/30 * * * *', label: 'Fan cycle every 30min' },
    ],
  },
  {
    label: 'High humidity (fans every 15min)',
    items: [
      { device: 'fan', action: 'on', cron_expression: '*/15 * * * *', label: 'Fan cycle every 15min' },
    ],
  },
];

export default function ScheduleEditor({ onRefresh }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    device: 'fan',
    action: 'on',
    cron_expression: '*/30 * * * *',
    label: '',
  });
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setRows(await fetchSchedules());
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function onAdd(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createSchedule({ ...form, enabled: true });
      setForm({ ...form, label: '' });
      await reload();
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(row) {
    await updateSchedule(row.id, { enabled: !row.enabled });
    await reload();
    onRefresh();
  }

  async function onDelete(row) {
    if (!confirm(`Delete schedule "${row.label || row.cron_expression}"?`)) return;
    await deleteSchedule(row.id);
    await reload();
    onRefresh();
  }

  async function applyPreset(preset) {
    setBusy(true);
    try {
      for (const item of preset.items) {
        await createSchedule({ ...item, enabled: true });
      }
      await reload();
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Schedules" subtitle="cron-based automation">
      <ul className="space-y-2">
        {rows.length === 0 && (
          <li className="text-sm text-slate-500">No schedules yet.</li>
        )}
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-2 rounded border border-shroom-border bg-shroom-bg/60 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-mono ${
                    row.device === 'fan'
                      ? 'bg-shroom-accent/20 text-shroom-accent'
                      : 'bg-shroom-light/20 text-shroom-light'
                  }`}
                >
                  {row.device} {row.action}
                </span>
                <span className="truncate text-slate-200">{row.label || row.cron_expression}</span>
              </div>
              <div className="mt-0.5 font-mono text-xs text-slate-500">{row.cron_expression}</div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onToggle(row)}
                className={`touch-btn rounded px-2 py-1 text-xs ${
                  row.enabled
                    ? 'bg-shroom-accent/20 text-shroom-accent'
                    : 'bg-slate-700 text-slate-400'
                }`}
              >
                {row.enabled ? 'on' : 'off'}
              </button>
              <button
                type="button"
                onClick={() => onDelete(row)}
                className="touch-btn rounded px-2 py-1 text-xs text-slate-400 hover:bg-shroom-alert/20 hover:text-shroom-alert"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={onAdd} className="mt-4 space-y-2 rounded border border-shroom-border bg-shroom-bg/40 p-3">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={form.device}
            onChange={(e) => setForm({ ...form, device: e.target.value })}
            className="rounded border border-shroom-border bg-shroom-bg px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="fan">Fan</option>
            <option value="light">Light</option>
          </select>
          <select
            value={form.action}
            onChange={(e) => setForm({ ...form, action: e.target.value })}
            className="rounded border border-shroom-border bg-shroom-bg px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        </div>
        <input
          type="text"
          placeholder="cron expression e.g. 0 6 * * *"
          value={form.cron_expression}
          onChange={(e) => setForm({ ...form, cron_expression: e.target.value })}
          className="w-full rounded border border-shroom-border bg-shroom-bg px-2 py-1.5 font-mono text-sm text-slate-100"
          required
        />
        <input
          type="text"
          placeholder="label (optional)"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          className="w-full rounded border border-shroom-border bg-shroom-bg px-2 py-1.5 text-sm text-slate-100"
        />
        <button
          type="submit"
          disabled={busy}
          className="touch-btn w-full rounded bg-shroom-accent/20 py-2 text-sm font-medium text-shroom-accent hover:bg-shroom-accent/30 disabled:opacity-50"
        >
          Add schedule
        </button>
      </form>

      <div className="mt-4">
        <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">Presets</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              disabled={busy}
              className="touch-btn rounded bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              + {p.label}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
