import { useState } from 'react';
import { Lightbulb, Play, Power, Waves, Wind } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { clearOverride, runTest, setFan, setLight } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const DEVICE_META = {
  fan:     { label: 'Fans',   icon: Wind,      accent: 'text-info',    soft: 'bg-info/10',    ring: 'ring-info/30' },
  light:   { label: 'Lights', icon: Lightbulb, accent: 'text-warning', soft: 'bg-warning/10', ring: 'ring-warning/30' },
  mister:  { label: 'Mister', icon: Waves,     accent: 'text-info',    soft: 'bg-info/10',    ring: 'ring-info/30' },
};

const API = {
  fan: setFan,
  light: setLight,
};

export function DeviceCard({
  device,
  on,
  manualOverride,
  subtitle,
  nextFire,
  onRefresh,
  disabled,
  children,
}) {
  const meta = DEVICE_META[device];
  const Icon = meta.icon;
  const { can } = useAuth();
  const readOnly = !can('mutate');
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (disabled) return;
    setBusy(true);
    try {
      await API[device](!on);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (disabled) return;
    setBusy(true);
    try {
      await runTest(device, 5);
    } finally {
      setBusy(false);
    }
  }

  async function releaseOverride() {
    await clearOverride(device);
    await onRefresh?.();
  }

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition',
        on && 'ring-1',
        on && meta.ring
      )}
    >
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'grid size-10 place-items-center rounded-md transition-colors',
                on ? meta.soft : 'bg-muted',
                on ? meta.accent : 'text-muted-foreground'
              )}
            >
              <Icon className="size-5" />
            </div>
            <div>
              <div className="text-base font-semibold">{meta.label}</div>
              {subtitle && (
                <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
              )}
            </div>
          </div>
          <Switch
            checked={on}
            disabled={busy || disabled || readOnly}
            onCheckedChange={toggle}
            aria-label={`Toggle ${meta.label.toLowerCase()}`}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant={on ? 'success' : 'muted'}>
              <Power className="size-3" />
              {on ? 'ON' : 'OFF'}
            </Badge>
            {manualOverride && (
              <Badge variant="warning" className="uppercase">
                manual
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {readOnly && (
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                read-only
              </span>
            )}
            {!readOnly && manualOverride && (
              <Button variant="ghost" size="sm" onClick={releaseOverride}>
                clear override
              </Button>
            )}
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                onClick={test}
                disabled={busy || disabled}
              >
                <Play />
                Test&nbsp;5s
              </Button>
            )}
          </div>
        </div>

        {children && <div className="mt-5 space-y-3">{children}</div>}

        {nextFire && (
          <div className="mt-4 rounded-md border border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
            Next scheduled: <span className="font-mono">{formatDateTime(nextFire)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
