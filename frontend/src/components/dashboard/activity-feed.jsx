import { useEffect, useState } from 'react';
import { Activity, Lightbulb, Waves, Wind } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardTitleGroup,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchDeviceLog } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

const DEVICE_ICON = {
  fan: Wind,
  light: Lightbulb,
  mister: Waves,
};

const TRIGGER_VARIANT = {
  manual: 'muted',
  api: 'muted',
  schedule: 'success',
  threshold: 'danger',
  'clear-override': 'muted',
};

export function ActivityFeed({ limit = 10, title = 'Recent activity' }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetchDeviceLog(limit);
        if (alive) setRows(r);
      } catch {
        // ignore
      }
    };
    load();
    const i = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [limit]);

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription>Last {limit} device state changes</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <ActivityRow key={r.id} row={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ row }) {
  const Icon = DEVICE_ICON[row.device] || Activity;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-md',
            row.state ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium capitalize">{row.device}</span>
            <span className="text-muted-foreground">{row.state ? 'ON' : 'OFF'}</span>
            <Badge
              variant={TRIGGER_VARIANT[row.trigger] || 'muted'}
              className="text-[10px] uppercase"
            >
              {row.trigger}
            </Badge>
          </div>
        </div>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatRelative(row.timestamp)}
      </span>
    </li>
  );
}
