import { PageHeader } from '@/components/layout/page-header';
import { ActivityFeed } from '@/components/dashboard/activity-feed';

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        description="All device state changes across the chamber"
      />
      <ActivityFeed limit={50} title="Full activity log" />
    </>
  );
}
