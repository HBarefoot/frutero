import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import { fetchDeviceLog } from '../lib/api.js';
import { formatRelative } from '../lib/format.js';

const triggerStyles = {
  manual: 'bg-slate-700 text-slate-200',
  api: 'bg-slate-700 text-slate-200',
  schedule: 'bg-shroom-accent/20 text-shroom-accent',
  threshold: 'bg-shroom-alert/20 text-shroom-alert',
};

export default function ActivityLog() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        setRows(await fetchDeviceLog(10));
      } catch {
        // ignore
      }
    }
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, []);

  return (
    <Panel title="Recent Activity" subtitle="last 10 device state changes">
      <ul className="space-y-1 text-sm">
        {rows.length === 0 && <li className="text-slate-500">No activity yet.</li>}
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between gap-2 border-b border-shroom-border/50 py-1.5 last:border-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-mono ${
                  r.device === 'fan'
                    ? 'bg-shroom-accent/20 text-shroom-accent'
                    : 'bg-shroom-light/20 text-shroom-light'
                }`}
              >
                {r.device}
              </span>
              <span className="text-slate-200">{r.state ? 'ON' : 'OFF'}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                  triggerStyles[r.trigger] || 'bg-slate-700 text-slate-300'
                }`}
              >
                {r.trigger}
              </span>
            </div>
            <span className="shrink-0 text-xs text-slate-500">{formatRelative(r.timestamp)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
