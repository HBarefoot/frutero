import { useEffect, useState } from 'react';
import {
  Download,
  Film,
  Loader2,
  Play,
  Sparkles,
  Trash2,
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
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import {
  deleteTimelapse,
  fetchTimelapses,
  generateTimelapse,
  timelapseVideoUrl,
} from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';

// Per-batch (or unbatched) timelapse generator + player. Shows existing
// timelapses at the top, with a compact generator form at the bottom.
// Polls while a generation is in flight so newly-ready videos appear
// without a manual refresh.
export function TimelapseCard({ batchId = null, snapshotCount = null }) {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fps, setFps] = useState(10);
  const [activeGeneration, setActiveGeneration] = useState(null);

  async function load() {
    try {
      const r = await fetchTimelapses({ batch_id: batchId });
      setRows(r.entries);
    } catch (err) {
      toast.error(err);
    }
  }

  useEffect(() => { load(); }, [batchId]);

  // Poll every 5s while we're waiting for a generation to land; the
  // backend is fire-and-forget so the list is the only signal.
  useEffect(() => {
    if (!activeGeneration) return;
    const baseline = rows?.length ?? 0;
    const t = setInterval(async () => {
      try {
        const r = await fetchTimelapses({ batch_id: batchId });
        setRows(r.entries);
        if ((r.entries?.length ?? 0) > baseline) {
          toast.success('Timelapse ready');
          setActiveGeneration(null);
          return;
        }
        if (Date.now() - activeGeneration.startedAt > 5 * 60 * 1000) {
          toast.warn('Still rendering after 5 min · check back later');
          setActiveGeneration(null);
        }
      } catch { /* keep trying */ }
    }, 5000);
    return () => clearInterval(t);
  }, [activeGeneration, batchId, rows, toast]);

  async function onGenerate() {
    setBusy(true);
    try {
      const r = await generateTimelapse({ batch_id: batchId, fps });
      if (r.started) {
        setActiveGeneration({ startedAt: Date.now(), fps });
        toast.info(`Rendering timelapse at ${fps} fps…`);
      } else if (r.already_running) {
        toast.warn('A timelapse is already rendering · results will appear shortly');
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id) {
    if (!can('admin')) return;
    if (!confirm('Delete this timelapse?')) return;
    try {
      await deleteTimelapse(id);
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  if (rows == null) return null;

  // snapshotCount === null means "unknown" (Camera page case) — show
  // the generator and let the backend reject with no_snapshots if
  // there aren't any. snapshotCount = 0 means "known zero" and hides
  // the generator (e.g., a fresh batch with no captures yet).
  const canGenerate = can('mutate') && (snapshotCount == null || snapshotCount >= 2);

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Film className="size-4 text-muted-foreground" />
            <CardTitle>Timelapses</CardTitle>
          </div>
          <CardDescription>
            {rows.length === 0
              ? 'No timelapses yet.'
              : `${rows.length} rendered${activeGeneration ? ' · one in progress' : ''}`}
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map((t) => (
              <TimelapseRow key={t.id} row={t} onDelete={onDelete} canAdmin={can('admin')} />
            ))}
          </ul>
        )}

        {canGenerate && (
          <div className="rounded-md border border-border bg-background/40 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="tl-fps" className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  fps
                </Label>
                <Input
                  id="tl-fps"
                  type="number"
                  min="1"
                  max="60"
                  value={fps}
                  onChange={(e) => setFps(Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 10)))}
                  className="mt-1 w-20"
                />
              </div>
              <Button onClick={onGenerate} disabled={busy || !!activeGeneration} size="sm">
                {busy || activeGeneration ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {activeGeneration ? 'Rendering…' : 'Generate'}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                {snapshotCount != null
                  ? `Stitches ${snapshotCount} snapshot${snapshotCount === 1 ? '' : 's'} into an mp4 at ${fps}fps → ~${Math.max(1, Math.round(snapshotCount / fps))}s video.`
                  : `Stitches all ${batchId != null ? 'batch' : 'unbatched'} snapshots into an mp4 at ${fps}fps.`}
              </p>
            </div>
          </div>
        )}

        {!canGenerate && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Needs at least 2 snapshots. Enable scheduled captures or click &ldquo;Capture now&rdquo;.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function TimelapseRow({ row, onDelete, canAdmin }) {
  const [playing, setPlaying] = useState(false);
  return (
    <li className="overflow-hidden rounded-md border border-border bg-background/40">
      <div className="flex items-center justify-between gap-2 p-2 text-xs">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Badge variant={row.status === 'ready' ? 'success' : 'warning'}>
            {row.status}
          </Badge>
          <span className="font-mono text-muted-foreground">
            {row.frames} frames · {row.fps}fps ·{' '}
            {row.duration_seconds ? `${Math.round(row.duration_seconds)}s` : '—'}
          </span>
          {row.resolution && (
            <span className="hidden sm:inline text-muted-foreground">· {row.resolution}</span>
          )}
          <span className="text-muted-foreground">· {formatRelative(row.created_at)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {row.status === 'ready' && (
            <>
              <Button size="sm" variant="outline" onClick={() => setPlaying((v) => !v)}>
                <Play />
                {playing ? 'Close' : 'Play'}
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <a href={timelapseVideoUrl(row.id)} download>
                  <Download />
                </a>
              </Button>
            </>
          )}
          {canAdmin && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(row.id)}
              className="text-muted-foreground hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      {playing && row.status === 'ready' && (
        <video
          src={timelapseVideoUrl(row.id)}
          controls
          autoPlay
          className="block w-full bg-black"
        />
      )}
      {row.error && (
        <div className="border-t border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
          {row.error}
        </div>
      )}
    </li>
  );
}
