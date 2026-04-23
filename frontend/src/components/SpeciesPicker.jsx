import { useState } from 'react';
import Panel from './Panel.jsx';
import { applySpecies } from '../lib/api.js';

export default function SpeciesPicker({ settings, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const current = settings?.settings?.species || '';
  const presets = settings?.species_presets || {};

  async function pick(key) {
    setBusy(true);
    try {
      await applySpecies(key);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Species" subtitle="auto-populate thresholds and fan cycle">
      <div className="space-y-2">
        {Object.entries(presets).map(([key, preset]) => {
          const selected = key === current;
          return (
            <button
              key={key}
              type="button"
              disabled={busy}
              onClick={() => pick(key)}
              className={`touch-btn flex w-full items-start justify-between rounded border p-3 text-left transition disabled:opacity-50 ${
                selected
                  ? 'border-shroom-accent bg-shroom-accent/10'
                  : 'border-shroom-border bg-shroom-bg/60 hover:bg-slate-800/60'
              }`}
            >
              <div>
                <div className="text-sm font-medium text-slate-100">{preset.name}</div>
                <div className="mt-1 text-xs text-slate-400">
                  Temp {preset.temp_min}–{preset.temp_max}°F · RH {preset.humid_min}–
                  {preset.humid_max}% · fan every {preset.fan_interval}min
                </div>
              </div>
              {selected && <span className="text-xs text-shroom-accent">✓ active</span>}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
