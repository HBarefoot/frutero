import { useMemo, useState } from 'react';
import Panel from './Panel.jsx';
import { setFan, runTest, clearOverride, saveSettings } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

export default function FanControl({ status, settings, onRefresh }) {
  const on = !!status.fan;
  const manual = !!status.manualOverride?.fan;
  const [busy, setBusy] = useState(false);
  const [onDur, setOnDur] = useState(settings.settings?.fan_on_duration || '60');
  const [interval, setInterval_] = useState(settings.settings?.fan_cycle_interval || '30');

  const nextFire = useMemo(() => {
    const entries = Object.entries(status.nextInvocations || {});
    if (entries.length === 0) return null;
    const schedules = status.schedules || [];
    // We don't have schedules in status, so just show earliest upcoming time.
    const times = entries.map(([, iso]) => iso).filter(Boolean).sort();
    return times[0] || null;
  }, [status]);

  async function toggle() {
    setBusy(true);
    try {
      await setFan(!on);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await runTest('fan', 5);
    } finally {
      setBusy(false);
    }
  }

  async function saveCycle() {
    setBusy(true);
    try {
      await saveSettings({
        fan_on_duration: String(parseInt(onDur, 10) || 60),
        fan_cycle_interval: String(parseInt(interval, 10) || 30),
      });
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function releaseOverride() {
    await clearOverride('fan');
    await onRefresh();
  }

  return (
    <Panel
      title="Fans"
      subtitle="GPIO 18 · FAE cycle"
      right={
        manual && (
          <button
            type="button"
            onClick={releaseOverride}
            className="touch-btn rounded bg-shroom-warn/20 px-2 text-xs text-shroom-warn hover:bg-shroom-warn/30"
          >
            clear override
          </button>
        )
      }
    >
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`touch-btn flex w-full items-center justify-between rounded-lg px-5 py-5 text-left text-lg font-semibold transition ${
          on
            ? 'bg-shroom-accent/20 text-shroom-accent ring-2 ring-shroom-accent/50'
            : 'bg-slate-800 text-slate-400 ring-1 ring-shroom-border hover:bg-slate-700'
        }`}
      >
        <span>{on ? 'Fans ON' : 'Fans OFF'}</span>
        <span
          className={`inline-block h-3 w-3 rounded-full ${
            on ? 'bg-shroom-accent shadow-[0_0_12px_rgba(16,185,129,0.7)]' : 'bg-slate-600'
          }`}
        />
      </button>

      <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <button
          type="button"
          onClick={test}
          disabled={busy}
          className="touch-btn rounded bg-slate-800 px-3 py-2 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          Run test (5s)
        </button>
        {manual && <span className="text-shroom-warn">• manual override active</span>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-400">
          ON duration (sec)
          <input
            type="number"
            min="1"
            value={onDur}
            onChange={(e) => setOnDur(e.target.value)}
            className="mt-1 w-full rounded border border-shroom-border bg-shroom-bg px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Cycle (min)
          <input
            type="number"
            min="1"
            value={interval}
            onChange={(e) => setInterval_(e.target.value)}
            className="mt-1 w-full rounded border border-shroom-border bg-shroom-bg px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={saveCycle}
        disabled={busy}
        className="touch-btn mt-3 w-full rounded bg-slate-800 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
      >
        Save cycle settings
      </button>

      {nextFire && (
        <p className="mt-3 text-xs text-slate-500">Next fire: {formatDateTime(nextFire)}</p>
      )}
    </Panel>
  );
}
