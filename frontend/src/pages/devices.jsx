import { useEffect, useState, useMemo } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { DeviceCard } from '@/components/dashboard/device-card';
import { MistingPanel } from '@/components/dashboard/misting-panel';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useStatus } from '@/lib/status-context';
import { updateActuator } from '@/lib/api';

export default function DevicesPage() {
  const { status, actuators, refresh } = useStatus();

  const nextByDevice = status?.nextByDevice || {};
  const allActuators = useMemo(() => Object.values(actuators), [actuators]);

  if (!status) return <PageSkeleton rows={2} />;

  return (
    <>
      <PageHeader
        title="Devices"
        description="Direct control of relays and actuators connected to the chamber"
      />

      {allActuators.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {allActuators.map((a) => (
            <DeviceCard
              key={a.key}
              actuator={a}
              nextFire={nextByDevice[a.key] || null}
              onRefresh={refresh}
            >
              {a.kind === 'fan' && a.enabled && (
                <FanOnDurationPanel actuator={a} onRefresh={refresh} />
              )}
              {a.kind === 'mister' && a.enabled && (
                <MistingPanel actuator={a} onRefresh={refresh} />
              )}
            </DeviceCard>
          ))}
        </div>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
      <p className="text-sm text-muted-foreground">
        No actuators configured yet. Add one from the <strong>Hardware</strong> page.
      </p>
    </div>
  );
}

function FanOnDurationPanel({ actuator, onRefresh }) {
  const [onDur, setOnDur] = useState(String(actuator.auto_off_seconds ?? 60));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setOnDur(String(actuator.auto_off_seconds ?? 60));
  }, [actuator.auto_off_seconds]);

  async function save() {
    setBusy(true);
    try {
      const n = Math.max(1, parseInt(onDur, 10) || 60);
      await updateActuator(actuator.key, { auto_off_seconds: n });
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
        Fan on-duration
      </div>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label htmlFor="fan-on-dur">Auto-off after (sec)</Label>
          <Input
            id="fan-on-dur"
            type="number"
            min="1"
            value={onDur}
            onChange={(e) => setOnDur(e.target.value)}
            className="mt-1.5"
          />
        </div>
        <Button onClick={save} disabled={busy} variant="soft" size="sm">
          <Save />
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Cycle frequency is set on the <strong>Schedules</strong> page.
      </p>
    </div>
  );
}
