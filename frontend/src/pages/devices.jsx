import { useEffect, useMemo, useState } from 'react';
import { Save, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardTitleGroup } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import { DeviceCard } from '@/components/dashboard/device-card';
import { useStatus } from '@/lib/status-context';
import { saveSettings } from '@/lib/api';

export default function DevicesPage() {
  const { status, settings, refresh } = useStatus();

  const nextFire = useMemo(() => {
    const times = Object.values(status?.nextInvocations || {}).filter(Boolean);
    return times.sort()[0] || null;
  }, [status]);

  if (!status) return null;

  return (
    <>
      <PageHeader
        title="Devices"
        description="Direct control of relays and actuators connected to the chamber"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeviceCard
          device="fan"
          on={!!status.fan}
          manualOverride={!!status.manualOverride?.fan}
          subtitle="GPIO 18 · FAE cycle · 2× 80mm"
          nextFire={nextFire}
          onRefresh={refresh}
        >
          <FanCycleSettings settings={settings} onRefresh={refresh} />
        </DeviceCard>

        <DeviceCard
          device="light"
          on={!!status.light}
          manualOverride={!!status.manualOverride?.light}
          subtitle="GPIO 17 · 12h photoperiod"
          onRefresh={refresh}
        />

        <MisterPlaceholder />
      </div>
    </>
  );
}

function FanCycleSettings({ settings, onRefresh }) {
  const [onDur, setOnDur] = useState(settings.settings?.fan_on_duration || '60');
  const [interval, setInterval_] = useState(settings.settings?.fan_cycle_interval || '30');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setOnDur(settings.settings?.fan_on_duration || '60');
    setInterval_(settings.settings?.fan_cycle_interval || '30');
  }, [settings.settings?.fan_on_duration, settings.settings?.fan_cycle_interval]);

  async function save() {
    setBusy(true);
    try {
      await saveSettings({
        fan_on_duration: String(parseInt(onDur, 10) || 60),
        fan_cycle_interval: String(parseInt(interval, 10) || 30),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Cycle settings
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="fan-on-dur">On (sec)</Label>
          <Input
            id="fan-on-dur"
            type="number"
            min="1"
            value={onDur}
            onChange={(e) => setOnDur(e.target.value)}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="fan-interval">Cycle (min)</Label>
          <Input
            id="fan-interval"
            type="number"
            min="1"
            value={interval}
            onChange={(e) => setInterval_(e.target.value)}
            className="mt-1.5"
          />
        </div>
      </div>
      <Button
        onClick={save}
        disabled={busy}
        variant="soft"
        className="mt-3 w-full"
        size="sm"
      >
        <Save />
        {saved ? 'Saved' : 'Save cycle'}
      </Button>
    </div>
  );
}

function MisterPlaceholder() {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Waves className="size-4 text-muted-foreground" />
            <CardTitle>Mister</CardTitle>
          </div>
          <CardDescription>Ultrasonic fogger · coming with Phase 4</CardDescription>
        </CardTitleGroup>
        <Badge variant="muted">soon</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Hardware arriving soon. Once wired to GPIO 27 (relay K3), this card will expose
          humidity-threshold misting, manual pulse, and scheduled modes — all with built-in
          max-on-time / daily-cap safety clamps so the atomizer disc can't dry-fire.
        </p>
      </CardContent>
    </Card>
  );
}
