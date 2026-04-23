import { useEffect, useMemo, useState } from 'react';
import { FileSearch, User } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardTitleGroup,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { PageHeader } from '@/components/layout/page-header';
import { fetchAuditLog } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';

const CATEGORY_VARIANTS = {
  auth: 'info',
  user: 'warning',
  invite: 'warning',
  device: 'success',
  actuator: 'success',
  schedule: 'muted',
  misting: 'info',
  camera: 'info',
};

function categoryOf(action) {
  return (action || '').split('.')[0] || 'other';
}

export default function AuditPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);
  const [filter, setFilter] = useState({ action: '', user: '' });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAuditLog(limit)
      .then((d) => { if (!cancelled) setEntries(d.entries || []); })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [limit]);

  const actions = useMemo(() => {
    const set = new Set(entries.map((e) => e.action));
    return [...set].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filter.action && e.action !== filter.action) return false;
      if (filter.user) {
        const needle = filter.user.toLowerCase();
        const hay = `${e.user_name || ''} ${e.user_email || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [entries, filter]);

  if (user?.role !== 'owner') {
    return (
      <>
        <PageHeader title="Audit log" description="Owner-only" />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Only the chamber owner can view the audit log.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every privileged action taken on this chamber"
      />

      <Card>
        <CardHeader>
          <CardTitleGroup>
            <div className="flex items-center gap-2">
              <FileSearch className="size-4 text-muted-foreground" />
              <CardTitle>Entries</CardTitle>
            </div>
            <CardDescription>
              {loading ? 'Loading…' : `${filtered.length} of ${entries.length} shown`}
            </CardDescription>
          </CardTitleGroup>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="audit-action">Action</Label>
              <SelectNative
                id="audit-action"
                value={filter.action}
                onChange={(e) => setFilter({ ...filter, action: e.target.value })}
                className="mt-1.5"
              >
                <option value="">all actions</option>
                {actions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </SelectNative>
            </div>
            <div>
              <Label htmlFor="audit-user">User</Label>
              <Input
                id="audit-user"
                placeholder="name or email"
                value={filter.user}
                onChange={(e) => setFilter({ ...filter, user: e.target.value })}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="audit-limit">Load</Label>
              <SelectNative
                id="audit-limit"
                value={String(limit)}
                onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                className="mt-1.5"
              >
                <option value="50">last 50</option>
                <option value="100">last 100</option>
                <option value="250">last 250</option>
                <option value="500">last 500</option>
              </SelectNative>
            </div>
          </div>

          {filtered.length === 0 && !loading ? (
            <div className="rounded-md border border-dashed border-border bg-background/30 px-3 py-8 text-center text-sm text-muted-foreground">
              No entries match the current filter.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((e) => (
                <AuditRow key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function AuditRow({ entry }) {
  const cat = categoryOf(entry.action);
  const variant = CATEGORY_VARIANTS[cat] || 'muted';
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={variant} className="font-mono">{entry.action}</Badge>
          {entry.target && (
            <span className="truncate font-mono text-xs text-muted-foreground">{entry.target}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <User className="size-3" />
          {entry.user_name ? (
            <>
              <span>{entry.user_name}</span>
              <span className="font-mono">&lt;{entry.user_email}&gt;</span>
            </>
          ) : (
            <span className="italic">system</span>
          )}
          {entry.ip && <span className="font-mono">· {entry.ip}</span>}
        </div>
        {entry.detail && (
          <pre className="truncate rounded-md border border-border bg-background/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {entry.detail}
          </pre>
        )}
      </div>
      <time className="shrink-0 font-mono text-xs text-muted-foreground">
        {formatDateTime(entry.timestamp)}
      </time>
    </li>
  );
}
