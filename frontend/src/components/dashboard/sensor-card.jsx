import { useEffect, useState } from 'react';
import { Droplets, Thermometer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { fetchReadingStats } from '@/lib/api';
import { formatRelative, metricStatus } from '@/lib/format';
import { cn } from '@/lib/cn';

const STATUS_META = {
  optimal: { label: 'Optimal', variant: 'success' },
  warning: { label: 'Warning', variant: 'warning' },
  alert: { label: 'Alert', variant: 'danger' },
  unknown: { label: 'No data', variant: 'muted' },
};

export function SensorCards({ sensor, alerts }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchReadingStats(24)
        .then((s) => alive && setStats(s))
        .catch(() => {});
    load();
    const i = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, []);

  const tempCfg = alerts?.config?.temperature;
  const humidCfg = alerts?.config?.humidity;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SensorCard
        label="Temperature"
        icon={Thermometer}
        value={sensor?.temperature}
        unit="°F"
        status={metricStatus(sensor?.temperature, tempCfg?.min, tempCfg?.max)}
        range={tempCfg}
        stats={stats ? { min: stats.temp_min, max: stats.temp_max } : null}
        updated={sensor?.timestamp}
        simulated={sensor?.simulated}
      />
      <SensorCard
        label="Humidity"
        icon={Droplets}
        value={sensor?.humidity}
        unit="%"
        status={metricStatus(sensor?.humidity, humidCfg?.min, humidCfg?.max)}
        range={humidCfg}
        stats={stats ? { min: stats.humid_min, max: stats.humid_max } : null}
        updated={sensor?.timestamp}
        simulated={sensor?.simulated}
      />
    </div>
  );
}

function SensorCard({ label, icon: Icon, value, unit, status, range, stats, updated, simulated }) {
  const meta = STATUS_META[status];
  const accent =
    status === 'optimal'
      ? 'text-success'
      : status === 'warning'
      ? 'text-warning'
      : status === 'alert'
      ? 'text-danger'
      : 'text-muted-foreground';

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Icon className="size-4" />
            {label}
          </div>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
        <div className="mt-4 flex items-baseline gap-1">
          <span className={cn('text-5xl font-semibold tabular-nums tracking-tight', accent)}>
            {value == null ? '—' : value.toFixed(1)}
          </span>
          <span className="text-lg text-muted-foreground">{unit}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
          <div className="rounded-md border border-border px-2.5 py-2">
            <div className="uppercase tracking-wide text-muted-foreground">Target</div>
            <div className="mt-0.5 font-mono text-foreground">
              {range?.min != null && range?.max != null
                ? `${range.min}${unit}–${range.max}${unit}`
                : '—'}
            </div>
          </div>
          <div className="rounded-md border border-border px-2.5 py-2">
            <div className="uppercase tracking-wide text-muted-foreground">24h range</div>
            <div className="mt-0.5 font-mono text-foreground">
              {stats?.min != null && stats?.max != null
                ? `${stats.min.toFixed(1)}–${stats.max.toFixed(1)}${unit}`
                : '—'}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Updated {formatRelative(updated)}</span>
          {simulated && <span className="uppercase tracking-wide">Simulated</span>}
        </div>
      </CardContent>
    </Card>
  );
}
