import { useEffect, useState } from 'react';
import {
  Aperture,
  CameraOff,
  Clock,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import {
  fetchCVConfig,
  fetchCVSnapshots,
  saveCVConfig,
  snapshotImageUrl,
  triggerSnapshot,
} from '@/lib/api';
import { formatRelative, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

export function SnapshotTimeline({ batchId } = {}) {
  const toast = useToast();
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);

  async function load() {
    try {
      setData(await fetchCVSnapshots({ batch_id: batchId, limit: 48 }));
    } catch (err) {
      toast.error(err);
    }
  }

  useEffect(() => { load(); }, [batchId]);
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [batchId]);

  async function captureNow() {
    if (!can('mutate')) return;
    setBusy(true);
    try {
      const r = await triggerSnapshot();
      if (r.ok) {
        toast.success(r.batch_id ? `Snapshot saved to batch #${r.batch_id}` : 'Snapshot saved (no batch)');
        await load();
      } else {
        toast.error(r.error || 'capture failed');
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const entries = data?.entries || [];
  const good = entries.filter((e) => !e.error);
  const errored = entries.filter((e) => e.error);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitleGroup>
            <div className="flex items-center gap-2">
              <ImageIcon className="size-4 text-muted-foreground" />
              <CardTitle>Snapshot timeline</CardTitle>
            </div>
            <CardDescription>
              {data
                ? `${entries.length} recent · ${data.count_24h} in last 24h${errored.length ? ` · ${errored.length} failed` : ''}`
                : 'Loading…'}
            </CardDescription>
          </CardTitleGroup>
          {can('mutate') && (
            <Button variant="outline" size="sm" onClick={captureNow} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Aperture />}
              Capture now
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <CameraOff className="size-6 text-muted-foreground/50" />
              No snapshots yet. Enable scheduled captures or click &ldquo;Capture now&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {entries.map((s) => (
                <SnapshotTile key={s.id} snap={s} onClick={() => setSelected(s)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected && (
        <SnapshotLightbox snap={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function SnapshotTile({ snap, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-md border border-border bg-background/40 text-left transition hover:ring-1 hover:ring-primary/40',
        snap.error && 'border-danger/40'
      )}
    >
      {snap.error ? (
        <div className="flex aspect-video items-center justify-center p-2 text-[11px] text-danger">
          {snap.error}
        </div>
      ) : (
        <img
          src={snapshotImageUrl(snap.id)}
          alt={`Snapshot at ${snap.timestamp}`}
          loading="lazy"
          className="block aspect-video w-full object-cover"
        />
      )}
      <div className="border-t border-border bg-card/80 px-1.5 py-1 text-[10px] text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>{formatRelative(snap.timestamp)}</span>
          {snap.batch_id && <Badge variant="outline" className="text-[9px]">batch {snap.batch_id}</Badge>}
        </div>
      </div>
    </button>
  );
}

function SnapshotLightbox({ snap, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/85 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-w-4xl w-full">
        <div className="overflow-hidden rounded-lg border border-border bg-black">
          <img
            src={snapshotImageUrl(snap.id)}
            alt={`Snapshot at ${snap.timestamp}`}
            className="block max-h-[80vh] w-full object-contain"
          />
        </div>
        <div className="mt-2 flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="size-3" /> {formatDateTime(snap.timestamp)}
            </span>
            {snap.width && snap.height && (
              <span className="font-mono text-muted-foreground">{snap.width}×{snap.height}</span>
            )}
            {snap.batch_id && <Badge variant="outline">batch #{snap.batch_id}</Badge>}
            <Badge variant="muted" className="uppercase">{snap.trigger}</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// Compact CV config card, embedded alongside the camera config on the
// Camera page for owners.
export function CVConfigCard() {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setCfg(await fetchCVConfig()); }
    catch (err) { toast.error(err); }
  }
  useEffect(() => { load(); }, []);

  async function savePatch(patch) {
    setBusy(true);
    try {
      const next = await saveCVConfig(patch);
      setCfg(next);
      toast.success('CV config saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" />
            <CardTitle>Scheduled snapshots</CardTitle>
          </div>
          <CardDescription>
            Auto-capture every N minutes, auto-attach to the active batch.
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
          <div>
            <div className="text-sm font-medium">Enabled</div>
            <p className="text-[11px] text-muted-foreground">
              Captures one frame every {cfg.cadence_minutes} min. Disabled = no scheduled captures; manual still works.
            </p>
          </div>
          <Switch
            checked={cfg.enabled}
            onCheckedChange={(v) => savePatch({ enabled: v })}
            aria-label="Toggle scheduled snapshots"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cv-cadence">Cadence (minutes)</Label>
            <Input
              id="cv-cadence"
              type="number"
              min="1"
              max="1440"
              defaultValue={cfg.cadence_minutes}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                if (n && n !== cfg.cadence_minutes) savePatch({ cadence_minutes: n });
              }}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="cv-retention">Keep (days)</Label>
            <Input
              id="cv-retention"
              type="number"
              min="1"
              max="3650"
              defaultValue={cfg.retention_days}
              onBlur={(e) => {
                const n = parseInt(e.target.value, 10);
                if (n && n !== cfg.retention_days) savePatch({ retention_days: n });
              }}
              className="mt-1.5"
            />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Snapshots land in <code className="font-mono">backend/data/snapshots/batch-&lt;id&gt;/</code> on disk and expire
          after the retention window. At {cfg.cadence_minutes}min cadence + {cfg.resolution || '1920x1080'}, budget
          ≈ <code className="font-mono">{Math.round((60 / cfg.cadence_minutes) * 24 * 0.11)}MB/day</code>.
        </p>
      </CardContent>
    </Card>
  );
}
