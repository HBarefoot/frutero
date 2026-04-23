import { useState } from 'react';
import Panel from './Panel.jsx';
import { setLight, runTest, clearOverride } from '../lib/api.js';

export default function LightControl({ status, onRefresh }) {
  const on = !!status.light;
  const manual = !!status.manualOverride?.light;
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await setLight(!on);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await runTest('light', 5);
    } finally {
      setBusy(false);
    }
  }

  async function releaseOverride() {
    await clearOverride('light');
    await onRefresh();
  }

  return (
    <Panel
      title="Lights"
      subtitle="GPIO 17 · 12h photoperiod"
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
            ? 'bg-shroom-light/20 text-shroom-light ring-2 ring-shroom-light/50'
            : 'bg-slate-800 text-slate-400 ring-1 ring-shroom-border hover:bg-slate-700'
        }`}
      >
        <span>{on ? 'Lights ON' : 'Lights OFF'}</span>
        <span
          className={`inline-block h-3 w-3 rounded-full ${
            on ? 'bg-shroom-light shadow-[0_0_12px_rgba(250,204,21,0.7)]' : 'bg-slate-600'
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
    </Panel>
  );
}
