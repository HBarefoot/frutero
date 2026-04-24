import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { SensorCards } from '@/components/dashboard/sensor-card';
import { DeviceCard } from '@/components/dashboard/device-card';
import { LiveChart } from '@/components/dashboard/live-chart';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { ActiveBatchCard } from '@/components/dashboard/active-batch-card';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useStatus } from '@/lib/status-context';
import { cn } from '@/lib/cn';

export default function DashboardPage() {
  const { status, alerts, actuators, refresh } = useStatus();
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const nextFire = useMemo(() => {
    const times = Object.values(status?.nextInvocations || {}).filter(Boolean);
    return times.sort()[0] || null;
  }, [status]);

  const enabledActuators = useMemo(
    () => Object.values(actuators).filter((a) => a.enabled),
    [actuators]
  );

  if (!status) return <PageSkeleton rows={4} />;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live chamber conditions and device status"
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="space-y-6">
        <ActiveBatchCard />
        <SensorCards sensor={status.sensor} sensorHealth={status.sensor_health} alerts={alerts} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {enabledActuators.map((a) => (
            <DeviceCard
              key={a.key}
              actuator={a}
              nextFire={nextFire}
              onRefresh={refresh}
            />
          ))}
        </div>

        <LiveChart />

        <ActivityFeed limit={10} />
      </div>
    </>
  );
}

function Loading() {
  return (
    <Card>
      <CardContent className="py-16 text-center text-sm text-muted-foreground">
        Loading chamber status…
      </CardContent>
    </Card>
  );
}
