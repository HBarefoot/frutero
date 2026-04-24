import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FlaskConical, Sprout } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { fetchActiveBatch } from '@/lib/api';
import { formatRelative } from '@/lib/format';

const PHASE_META = {
  colonization: { label: 'Colonization', variant: 'info' },
  pinning: { label: 'Pinning', variant: 'warning' },
  fruiting: { label: 'Fruiting', variant: 'success' },
  harvested: { label: 'Harvested', variant: 'muted' },
  culled: { label: 'Culled', variant: 'danger' },
};

export function ActiveBatchCard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchActiveBatch()
        .then((d) => { if (alive) setData(d); })
        .catch(() => { if (alive) setData({ active: null }); });
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!data) return null; // don't flash before first load
  const b = data.active;

  if (!b) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <FlaskConical className="size-4" />
            No active batch — start one to link readings and insights.
          </div>
          <Link
            to="/batches"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Start batch <ArrowRight className="size-3" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  const lastEvent = data.events?.[0];
  const meta = PHASE_META[b.phase] || { label: b.phase, variant: 'muted' };

  return (
    <Link to="/batches" className="block">
      <Card className="cursor-pointer border-success/40 bg-success/5 transition hover:bg-success/10">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Sprout className="size-4 shrink-0 text-success" />
              <span className="truncate text-sm font-semibold">{b.name}</span>
              {b.species_key && (
                <Badge variant="outline" className="font-mono">{b.species_key}</Badge>
              )}
              <Badge variant={meta.variant}>{meta.label}</Badge>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Day {b.days_elapsed}</span>
              <ArrowRight className="size-3.5" />
            </div>
          </div>
          {lastEvent && (
            <div className="mt-1.5 truncate text-[11px] text-muted-foreground">
              <span className="font-mono uppercase">{lastEvent.kind.replace('_', ' ')}</span>
              {lastEvent.detail && ' · '}
              {lastEvent.detail}
              <span className="ml-1.5">({formatRelative(lastEvent.timestamp)})</span>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
