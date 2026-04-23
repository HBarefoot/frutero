import { useState } from 'react';
import {
  Droplets,
  Fan,
  Flame,
  Lightbulb,
  Play,
  Power,
  Plug,
  Waves,
  Wind,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { clearOverride, runTest, setDevice } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

// Per-kind visual treatment. Unknown kinds fall back to KIND_DEFAULT.
const KIND_META = {
  fan:        { icon: Wind,      accent: 'text-info',    soft: 'bg-info/10',    ring: 'ring-info/30' },
  light:      { icon: Lightbulb, accent: 'text-warning', soft: 'bg-warning/10', ring: 'ring-warning/30' },
  mister:     { icon: Waves,     accent: 'text-info',    soft: 'bg-info/10',    ring: 'ring-info/30' },
  humidifier: { icon: Droplets,  accent: 'text-info',    soft: 'bg-info/10',    ring: 'ring-info/30' },
  pump:       { icon: Droplets,  accent: 'text-info',    soft: 'bg-info/10',    ring: 'ring-info/30' },
  heater:     { icon: Flame,     accent: 'text-warning', soft: 'bg-warning/10', ring: 'ring-warning/30' },
  exhaust:    { icon: Fan,       accent: 'text-info',    soft: 'bg-info/10',    ring: 'ring-info/30' },
};
const KIND_DEFAULT = { icon: Plug, accent: 'text-muted-foreground', soft: 'bg-muted', ring: 'ring-muted-foreground/30' };

export function DeviceCard({
  actuator,           // preferred: { key, name, kind, state, manualOverride, gpio_pin, inverted, auto_off_seconds }
  device,             // legacy prop: actuator key (resolved from status if `actuator` not given)
  on,                 // legacy
  manualOverride,     // legacy
  subtitle,
  nextFire,
  onRefresh,
  disabled,
  children,
}) {
  const key = actuator?.key ?? device;
  const kind = actuator?.kind ?? device;
  const label = actuator?.name ?? defaultLabel(device);
  const isOn = actuator ? !!actuator.state : !!on;
  const isOverride = actuator ? !!actuator.manualOverride : !!manualOverride;
  const meta = KIND_META[kind] || KIND_DEFAULT;
  const Icon = meta.icon;
  const { can } = useAuth();
  const readOnly = !can('mutate');
  const [busy, setBusy] = useState(false);

  const subtitleText = subtitle ?? (actuator ? defaultSubtitle(actuator) : null);

  async function toggle() {
    if (disabled) return;
    setBusy(true);
    try {
      await setDevice(key, !isOn);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (disabled) return;
    setBusy(true);
    try {
      await runTest(key, 5);
    } finally {
      setBusy(false);
    }
  }

  async function releaseOverride() {
    await clearOverride(key);
    await onRefresh?.();
  }

  return (
    <Card className={cn('relative overflow-hidden transition', isOn && 'ring-1', isOn && meta.ring)}>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'grid size-10 place-items-center rounded-md transition-colors',
                isOn ? meta.soft : 'bg-muted',
                isOn ? meta.accent : 'text-muted-foreground'
              )}
            >
              <Icon className="size-5" />
            </div>
            <div>
              <div className="text-base font-semibold">{label}</div>
              {subtitleText && (
                <div className="mt-0.5 text-xs text-muted-foreground">{subtitleText}</div>
              )}
            </div>
          </div>
          <Switch
            checked={isOn}
            disabled={busy || disabled || readOnly}
            onCheckedChange={toggle}
            aria-label={`Toggle ${label.toLowerCase()}`}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant={isOn ? 'success' : 'muted'}>
              <Power className="size-3" />
              {isOn ? 'ON' : 'OFF'}
            </Badge>
            {isOverride && (
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
            {!readOnly && isOverride && (
              <Button variant="ghost" size="sm" onClick={releaseOverride}>
                clear override
              </Button>
            )}
            {!readOnly && (
              <Button variant="outline" size="sm" onClick={test} disabled={busy || disabled}>
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

function defaultLabel(device) {
  if (!device) return 'Device';
  return device.charAt(0).toUpperCase() + device.slice(1);
}

function defaultSubtitle(a) {
  const bits = [`GPIO ${a.gpio_pin}`];
  if (a.inverted) bits.push('NC wiring');
  if (a.auto_off_seconds) bits.push(`auto-off ${a.auto_off_seconds}s`);
  return bits.join(' · ');
}
