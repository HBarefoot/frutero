import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Panel from './Panel.jsx';
import { fetchReadings } from '../lib/api.js';

const RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
];

export default function DataChart() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const rows = await fetchReadings(hours);
        if (!active) return;
        setData(
          rows.map((r) => ({
            t: new Date(r.timestamp).getTime(),
            temperature: r.temperature,
            humidity: r.humidity,
            simulated: !!r.simulated,
          }))
        );
      } catch {
        // ignore
      }
    }
    load();
    const i = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(i);
    };
  }, [hours]);

  const hasSimulated = useMemo(() => data.some((d) => d.simulated), [data]);

  const formatTick = (t) => {
    const d = new Date(t);
    if (hours >= 168) return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
    if (hours >= 24) return d.toLocaleTimeString([], { hour: '2-digit' });
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Panel
      title="Temperature & Humidity"
      subtitle={hasSimulated ? 'dashed line = simulated data' : 'live readings'}
      right={
        <div className="flex gap-1 rounded bg-shroom-bg p-1">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              onClick={() => setHours(r.hours)}
              className={`touch-btn rounded px-3 py-1 text-xs ${
                hours === r.hours ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="h-64">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            No readings yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="#1f2a3a" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={formatTick}
                stroke="#64748b"
                fontSize={11}
                minTickGap={40}
              />
              <YAxis
                yAxisId="temp"
                orientation="left"
                stroke="#f59e0b"
                fontSize={11}
                domain={['dataMin - 2', 'dataMax + 2']}
                tickFormatter={(v) => `${Math.round(v)}°`}
              />
              <YAxis
                yAxisId="humid"
                orientation="right"
                stroke="#3b82f6"
                fontSize={11}
                domain={[0, 100]}
                tickFormatter={(v) => `${Math.round(v)}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111826',
                  border: '1px solid #1f2a3a',
                  borderRadius: 6,
                  color: '#e2e8f0',
                  fontSize: 12,
                }}
                labelFormatter={(t) => new Date(t).toLocaleString()}
                formatter={(val, name) => {
                  if (name === 'temperature') return [`${val?.toFixed(1)} °F`, 'Temperature'];
                  if (name === 'humidity') return [`${val?.toFixed(1)} %`, 'Humidity'];
                  return [val, name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#cbd5e1' }} />
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="temperature"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray={hasSimulated ? '4 4' : undefined}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="humid"
                type="monotone"
                dataKey="humidity"
                stroke="#3b82f6"
                strokeWidth={2}
                strokeDasharray={hasSimulated ? '4 4' : undefined}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}
