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
import { LineChart as LineChartIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardTitleGroup, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { fetchReadings } from '@/lib/api';

const RANGES = [
  { label: '1h',  hours: 1 },
  { label: '6h',  hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d',  hours: 168 },
];

export function LiveChart() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const rows = await fetchReadings(hours);
        if (!alive) return;
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
    };
    load();
    const i = setInterval(load, 60000);
    return () => {
      alive = false;
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

  const tempColor = 'hsl(var(--warning))';
  const humidColor = 'hsl(var(--info))';

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <LineChartIcon className="size-4 text-muted-foreground" />
            <CardTitle>Temperature &amp; Humidity</CardTitle>
          </div>
          <CardDescription>
            {hasSimulated ? 'Dashed = simulated data' : 'Live readings'}
          </CardDescription>
        </CardTitleGroup>
        <RangeTabs value={hours} onChange={setHours} />
      </CardHeader>
      <CardContent>
        <div className="h-72 w-full">
          {data.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              No readings yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="t"
                  tickFormatter={formatTick}
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  minTickGap={40}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="temp"
                  orientation="left"
                  stroke={tempColor}
                  fontSize={11}
                  domain={['dataMin - 2', 'dataMax + 2']}
                  tickFormatter={(v) => `${Math.round(v)}°`}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="humid"
                  orientation="right"
                  stroke={humidColor}
                  fontSize={11}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${Math.round(v)}%`}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    color: 'hsl(var(--popover-foreground))',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  labelFormatter={(t) => new Date(t).toLocaleString()}
                  formatter={(val, name) => {
                    if (name === 'temperature') return [`${val?.toFixed(1)} °F`, 'Temperature'];
                    if (name === 'humidity') return [`${val?.toFixed(1)} %`, 'Humidity'];
                    return [val, name];
                  }}
                />
                <Legend
                  wrapperStyle={{
                    fontSize: 11,
                    color: 'hsl(var(--muted-foreground))',
                    paddingTop: 8,
                  }}
                  iconType="plainline"
                />
                <Line
                  yAxisId="temp"
                  type="monotone"
                  dataKey="temperature"
                  stroke={tempColor}
                  strokeWidth={2}
                  strokeDasharray={hasSimulated ? '4 4' : undefined}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="humid"
                  type="monotone"
                  dataKey="humidity"
                  stroke={humidColor}
                  strokeWidth={2}
                  strokeDasharray={hasSimulated ? '4 4' : undefined}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RangeTabs({ value, onChange }) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background p-1">
      {RANGES.map((r) => (
        <button
          key={r.hours}
          type="button"
          onClick={() => onChange(r.hours)}
          className={cn(
            'rounded px-2.5 py-1 text-xs transition-colors',
            value === r.hours
              ? 'bg-secondary text-secondary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
