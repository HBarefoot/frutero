import { useEffect, useState } from 'react';
import { formatUptime } from '../lib/format.js';

export default function StatusBar({ wsStatus, uptime, alertCount, recentAlert, onDismissAlert }) {
  const [now, setNow] = useState(() => new Date());
  const [tickUptime, setTickUptime] = useState(uptime);

  useEffect(() => {
    setTickUptime(uptime);
  }, [uptime]);

  useEffect(() => {
    const i = setInterval(() => {
      setNow(new Date());
      setTickUptime((u) => (u != null ? u + 1 : u));
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const connected = wsStatus === 'connected';
  const dot = connected ? 'bg-shroom-accent' : 'bg-shroom-alert animate-pulse';

  return (
    <header className="sticky top-0 z-20 border-b border-shroom-border bg-shroom-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-xl">🍄</span>
          <span className="text-sm font-semibold tracking-tight sm:text-base">
            Mushroom Grow Controller
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs sm:text-sm">
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
            <span className="text-slate-300">{connected ? 'Connected' : 'Disconnected'}</span>
          </span>
          <span className="hidden text-slate-500 sm:inline">·</span>
          <span className="hidden text-slate-400 sm:inline">{formatUptime(tickUptime)}</span>
          <span className="hidden text-slate-500 md:inline">·</span>
          <span className="hidden font-mono text-slate-400 md:inline">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {alertCount > 0 && (
            <span className="rounded-full bg-shroom-alert/20 px-2 py-0.5 font-mono text-shroom-alert">
              {alertCount}
            </span>
          )}
        </div>
      </div>
      {recentAlert && (
        <div className="border-t border-shroom-alert/30 bg-shroom-alert/10 px-4 py-2 text-xs text-shroom-alert sm:px-6">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <span>⚠ {recentAlert.message}</span>
            <button
              type="button"
              className="touch-btn rounded px-2 text-shroom-alert hover:bg-shroom-alert/20"
              onClick={onDismissAlert}
            >
              dismiss
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
