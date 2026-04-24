import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Eye,
  Lightbulb,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { fetchAIInsights } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

const CATEGORY_META = {
  observation: { Icon: Eye, tone: 'text-muted-foreground' },
  recommendation: { Icon: Lightbulb, tone: 'text-success' },
  warning: { Icon: AlertTriangle, tone: 'text-warning' },
};

export function AIInsightsWidget() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchAIInsights(20)
        .then((d) => { if (alive) setData(d); })
        .catch(() => { if (alive) setData({ entries: [], count_24h: 0 }); });
    };
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!data) return null;

  const entries = data.entries || [];
  const fresh = entries.filter((e) => e.status === 'new').slice(0, 3);

  if (entries.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <Brain className="size-4" />
            No AI insights yet.
          </div>
          <Link
            to="/ai"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Configure advisor <ArrowRight className="size-3" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  const hasWarn = fresh.some((e) => e.severity === 'warn');

  return (
    <Link to="/ai" className="block">
      <Card
        className={cn(
          'cursor-pointer transition hover:bg-muted/30',
          hasWarn && 'border-warning/40 bg-warning/5 hover:bg-warning/10'
        )}
      >
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Brain className={cn('size-4', hasWarn ? 'text-warning' : 'text-muted-foreground')} />
              <span className="text-sm font-semibold">AI insights</span>
              {fresh.length > 0 ? (
                <Badge variant={hasWarn ? 'warning' : 'info'}>
                  <Sparkles className="size-3" />
                  {fresh.length} new
                </Badge>
              ) : (
                <Badge variant="muted">up to date</Badge>
              )}
              <span className="text-[11px] text-muted-foreground">
                {data.count_24h} in last 24h
              </span>
            </div>
            <ArrowRight className="size-4 text-muted-foreground" />
          </div>

          {fresh.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {fresh.map((ins) => {
                const meta = CATEGORY_META[ins.category] || CATEGORY_META.observation;
                const Icon = meta.Icon;
                return (
                  <li key={ins.id} className="flex items-start gap-2 text-xs">
                    <Icon className={cn('mt-0.5 size-3.5 shrink-0', meta.tone)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{ins.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatRelative(ins.timestamp)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
