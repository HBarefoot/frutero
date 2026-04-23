import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { SensorCards } from '@/components/dashboard/sensor-card';
import { DeviceCard } from '@/components/dashboard/device-card';
import { LiveChart } from '@/components/dashboard/live-chart';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { useStatus } from '@/lib/status-context';

export default function DashboardPage() {
  const { status, alerts, refresh } = useStatus();

  const nextFire = useMemo(() => {
    const times = Object.values(status?.nextInvocations || {}).filter(Boolean);
    return times.sort()[0] || null;
  }, [status]);

  if (!status) return <Loading />;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live chamber conditions and device status"
        actions={
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw />
            Refresh
          </Button>
        }
      />

      <div className="space-y-6">
        <SensorCards sensor={status.sensor} alerts={alerts} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DeviceCard
            device="fan"
            on={!!status.fan}
            manualOverride={!!status.manualOverride?.fan}
            subtitle="GPIO 18 · FAE cycle"
            nextFire={nextFire}
            onRefresh={refresh}
          />
          <DeviceCard
            device="light"
            on={!!status.light}
            manualOverride={!!status.manualOverride?.light}
            subtitle="GPIO 17 · 12h photoperiod"
            onRefresh={refresh}
          />
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
