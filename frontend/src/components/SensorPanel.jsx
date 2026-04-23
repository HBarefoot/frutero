import { useEffect, useState } from 'react';
import Panel from './Panel.jsx';
import { fetchReadingStats } from '../lib/api.js';
import { formatRelative, metricStatus } from '../lib/format.js';

const statusClass = {
  optimal: 'text-shroom-accent',
  warning: 'text-shroom-warn',
  alert: 'text-shroom-alert',
  unknown: 'text-slate-400',
};

const statusDot = {
  optimal: 'bg-shroom-accent',
  warning: 'bg-shroom-warn',
  alert: 'bg-shroom-alert',
  unknown: 'bg-slate-600',
};

export default function SensorPanel({ sensor, alerts }) {
  const [stats, setStats] = useState(null);
  const tempCfg = alerts?.config?.temperature;
  const humidCfg = alerts?.config?.humidity;
  const tempStatus = metricStatus(sensor?.temperature, tempCfg?.min, tempCfg?.max);
  const humidStatus = metricStatus(sensor?.humidity, humidCfg?.min, humidCfg?.max);

  useEffect(() => {
    fetchReadingStats(24).then(setStats).catch(() => {});
    const i = setInterval(() => {
      fetchReadingStats(24).then(setStats).catch(() => {});
    }, 60000);
    return () => clearInterval(i);
  }, []);

  return (
    <Panel
      title="Environment"
      subtitle={`DHT22 · GPIO 4${sensor?.simulated ? ' · stub mode' : ''}`}
      right={
        sensor?.simulated && (
          <span className="rounded bg-shroom-warn/20 px-2 py-1 text-xs text-shroom-warn">
            ⚠ Simulated data
          </span>
        )
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Gauge
          label="Temperature"
          value={sensor?.temperature}
          suffix="°F"
          icon="🌡"
          status={tempStatus}
          stats={stats ? { min: stats.temp_min, max: stats.temp_max } : null}
          statsSuffix="°F"
        />
        <Gauge
          label="Humidity"
          value={sensor?.humidity}
          suffix="%"
          icon="💧"
          status={humidStatus}
          stats={stats ? { min: stats.humid_min, max: stats.humid_max } : null}
          statsSuffix="%"
        />
      </div>
      {sensor?.simulated && (
        <p className="mt-3 rounded border border-dashed border-shroom-border p-2 text-xs text-slate-400">
          Sensor not connected. Values are simulated so alerts and charts work unchanged.
          When DHT22 is wired, set <code className="text-slate-200">SENSOR_AVAILABLE: true</code>{' '}
          in <code className="text-slate-200">backend/config.js</code> and restart the service.
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Updated {formatRelative(sensor?.timestamp)}
      </p>
    </Panel>
  );
}

function Gauge({ label, value, suffix, icon, status, stats, statsSuffix }) {
  return (
    <div className="rounded-lg border border-shroom-border bg-shroom-bg/60 p-4">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>
          <span className="mr-1">{icon}</span>
          {label}
        </span>
        <span className="flex items-center gap-1">
          <span className={`inline-block h-2 w-2 rounded-full ${statusDot[status]}`} />
          <span className={statusClass[status]}>{status}</span>
        </span>
      </div>
      <div className={`mt-2 text-3xl font-bold sm:text-4xl ${statusClass[status]}`}>
        {value == null ? '—' : value.toFixed(1)}
        <span className="ml-1 text-lg font-normal text-slate-400">{suffix}</span>
      </div>
      {stats && stats.min != null && (
        <div className="mt-2 text-xs text-slate-500">
          24h min {stats.min.toFixed(1)}{statsSuffix} · max {stats.max.toFixed(1)}{statsSuffix}
        </div>
      )}
    </div>
  );
}
