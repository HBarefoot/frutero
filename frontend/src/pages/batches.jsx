import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Check,
  Cpu,
  FlaskConical,
  Layers,
  Leaf,
  MessageSquarePlus,
  NotebookPen,
  Play,
  Plus,
  Sprout,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { SelectNative } from '@/components/ui/select-native';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import { SnapshotTimeline } from '@/components/camera/snapshot-timeline';
import { TimelapseCard } from '@/components/camera/timelapse-card';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { useStatus } from '@/lib/status-context';
import {
  addBatchNote,
  archiveBatch,
  createBatch,
  deleteBatch,
  fetchBatch,
  fetchBatches,
  updateBatch,
} from '@/lib/api';
import { formatRelative, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const PHASES = ['colonization', 'pinning', 'fruiting', 'harvested', 'culled'];

const PHASE_META = {
  colonization: { label: 'Colonization', variant: 'info' },
  pinning: { label: 'Pinning', variant: 'warning' },
  fruiting: { label: 'Fruiting', variant: 'success' },
  harvested: { label: 'Harvested', variant: 'muted' },
  culled: { label: 'Culled', variant: 'danger' },
};

export default function BatchesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { settings } = useStatus();
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  async function load() {
    try {
      setData(await fetchBatches());
    } catch (err) {
      toast.error(err);
    }
  }

  async function loadDetail(id) {
    if (!id) { setDetail(null); return; }
    try {
      setDetail(await fetchBatch(id));
    } catch (err) {
      toast.error(err);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { loadDetail(selectedId); }, [selectedId]);

  if (!data) return <PageSkeleton rows={3} />;

  const all = data.batches || [];
  const active = data.active;
  const archived = all.filter((b) => !b.is_active);

  return (
    <>
      <PageHeader
        title="Batches"
        description="Track each grow run through its lifecycle — colonization, pinning, fruiting, harvest."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <BatchList
            active={active}
            archived={archived}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selectedId && detail && (
            <>
              <BatchDetail
                detail={detail}
                canMutate={can('mutate')}
                onChange={async () => {
                  await Promise.all([load(), loadDetail(selectedId)]);
                }}
              />
              {detail.stats?.snapshots > 0 && (
                <>
                  <SnapshotTimeline batchId={detail.batch.id} />
                  <TimelapseCard
                    batchId={detail.batch.id}
                    snapshotCount={detail.stats.snapshots || 0}
                  />
                </>
              )}
            </>
          )}
        </div>

        {can('mutate') && (
          <NewBatchCard
            species_presets={settings?.species_presets || {}}
            activeBatch={active}
            onCreated={async () => {
              await load();
            }}
          />
        )}
      </div>
    </>
  );
}

// ---------- List + active banner ----------

function BatchList({ active, archived, selectedId, onSelect }) {
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-muted-foreground" />
            <CardTitle>All batches</CardTitle>
          </div>
          <CardDescription>
            {active ? '1 active · ' : 'none active · '}
            {archived.length} archived
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {active && (
          <div
            onClick={() => onSelect(active.id)}
            className={cn(
              'cursor-pointer rounded-lg border border-success/40 bg-success/5 p-3 transition hover:bg-success/10',
              selectedId === active.id && 'ring-1 ring-success/50'
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sprout className="size-4 text-success" />
                <span className="text-sm font-semibold">{active.name}</span>
                {active.species_key && (
                  <Badge variant="outline" className="font-mono">{active.species_key}</Badge>
                )}
                <Badge variant={PHASE_META[active.phase]?.variant}>{PHASE_META[active.phase]?.label}</Badge>
                <Badge variant="success" className="uppercase">active</Badge>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Day {active.days_elapsed} · started {formatRelative(active.started_at)}
            </div>
          </div>
        )}

        {archived.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Archived
            </div>
            <ul className="divide-y divide-border">
              {archived.map((b) => (
                <li
                  key={b.id}
                  onClick={() => onSelect(b.id)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 py-2 hover:bg-muted/40',
                    selectedId === b.id && 'bg-muted/40'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="truncate font-medium">{b.name}</span>
                      {b.species_key && (
                        <Badge variant="outline" className="text-[10px] font-mono">{b.species_key}</Badge>
                      )}
                      <Badge variant={PHASE_META[b.phase]?.variant || 'muted'} className="text-[10px]">
                        {PHASE_META[b.phase]?.label || b.phase}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {b.days_elapsed}d · {formatDateTime(b.started_at)}
                      {b.ended_at && ` → ${formatDateTime(b.ended_at)}`}
                      {b.yield_grams != null && ` · ${b.yield_grams}g yield`}
                    </div>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {!active && archived.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No batches yet. Start one on the right to begin tracking.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Detail ----------

function BatchDetail({ detail, canMutate, onChange }) {
  const toast = useToast();
  const b = detail.batch;
  const [note, setNote] = useState('');
  const [yieldDraft, setYieldDraft] = useState(b.yield_grams != null ? String(b.yield_grams) : '');
  const [busy, setBusy] = useState(false);

  async function changePhase(phase) {
    setBusy(true);
    try {
      await updateBatch(b.id, { phase });
      toast.success(`Phase → ${PHASE_META[phase]?.label || phase}`);
      await onChange();
    } catch (err) { toast.error(err); }
    finally { setBusy(false); }
  }

  async function saveNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await addBatchNote(b.id, note.trim());
      setNote('');
      await onChange();
    } catch (err) { toast.error(err); }
    finally { setBusy(false); }
  }

  async function saveYield() {
    setBusy(true);
    try {
      const parsed = yieldDraft.trim() === '' ? null : parseFloat(yieldDraft);
      await updateBatch(b.id, { yield_grams: parsed });
      toast.success('Yield saved');
      await onChange();
    } catch (err) { toast.error(err); }
    finally { setBusy(false); }
  }

  async function onArchive() {
    if (!confirm(`Archive batch '${b.name}'?`)) return;
    setBusy(true);
    try {
      await archiveBatch(b.id);
      toast.success('Archived');
      await onChange();
    } catch (err) { toast.error(err); }
    finally { setBusy(false); }
  }

  async function onDelete() {
    if (!confirm(`Delete batch '${b.name}' permanently? This can't be undone.`)) return;
    setBusy(true);
    try {
      await deleteBatch(b.id);
      toast.success('Deleted');
      await onChange();
    } catch (err) { toast.error(err); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4 text-muted-foreground" />
            <CardTitle>{b.name}</CardTitle>
          </div>
          <CardDescription>
            {b.species_key || 'no species'} · started {formatDateTime(b.started_at)} · Day {b.days_elapsed}
          </CardDescription>
        </CardTitleGroup>
        <div className="flex items-center gap-2">
          <Badge variant={PHASE_META[b.phase]?.variant}>{PHASE_META[b.phase]?.label}</Badge>
          {b.is_active ? (
            <Badge variant="success" className="uppercase">active</Badge>
          ) : (
            <Badge variant="muted" className="uppercase">archived</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {canMutate && b.is_active && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Phase
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PHASES.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={p === b.phase ? 'default' : 'outline'}
                  onClick={() => changePhase(p)}
                  disabled={busy || p === b.phase}
                >
                  {PHASE_META[p].label}
                </Button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Transitioning to Harvested or Culled archives the batch automatically.
            </p>
          </div>
        )}

        {canMutate && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="note">Add note</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="note"
                  value={note}
                  placeholder="e.g., fruits starting to pin on left side"
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveNote(); }}
                />
                <Button size="sm" onClick={saveNote} disabled={busy || !note.trim()}>
                  <MessageSquarePlus />
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="yield">Yield (grams)</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="yield"
                  type="number"
                  min="0"
                  step="0.1"
                  value={yieldDraft}
                  placeholder="—"
                  onChange={(e) => setYieldDraft(e.target.value)}
                />
                <Button size="sm" variant="outline" onClick={saveYield} disabled={busy}>
                  <Check />
                </Button>
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Timeline
          </div>
          {detail.events.length === 0 ? (
            <p className="text-xs text-muted-foreground">No events yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {detail.events.map((ev) => (
                <li key={ev.id} className="flex items-start gap-2 text-xs">
                  <div className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="muted" className="text-[10px] uppercase">{ev.kind.replace('_', ' ')}</Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelative(ev.timestamp)}
                      </span>
                      {ev.user_name && (
                        <span className="text-[11px] text-muted-foreground">· {ev.user_name}</span>
                      )}
                    </div>
                    {ev.detail && (
                      <div className="mt-0.5 text-foreground/90">{ev.detail}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {detail.insights?.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              AI insights for this batch
            </div>
            <ul className="space-y-2">
              {detail.insights.map((ins) => (
                <li key={ins.id} className="rounded-md border border-border bg-background/40 p-2.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] uppercase">{ins.category}</Badge>
                    <span className="text-[11px] text-muted-foreground">{formatRelative(ins.timestamp)}</span>
                  </div>
                  <div className="mt-1 font-semibold">{ins.title}</div>
                  <p className="mt-0.5 text-muted-foreground">{ins.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {detail.stats?.devices?.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Actuator usage this batch
            </div>
            <ul className="space-y-1 text-xs">
              {detail.stats.devices.map((d) => (
                <li key={d.device} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Cpu className="size-3.5 text-muted-foreground" />
                    {d.device}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {d.on_events} ON / {d.events} events
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canMutate && (
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            {b.is_active && (
              <Button variant="outline" size="sm" onClick={onArchive} disabled={busy}>
                <Archive />
                Archive
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={busy}
              className="text-muted-foreground hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 />
              Delete
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- New batch ----------

function NewBatchCard({ species_presets, activeBatch, onCreated }) {
  const toast = useToast();
  const speciesKeys = Object.keys(species_presets);
  const [form, setForm] = useState({
    name: '',
    species_key: speciesKeys[0] || '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  const defaultName = useMemo(() => {
    const d = new Date();
    const iso = d.toISOString().slice(0, 10);
    const prefix = form.species_key
      ? species_presets[form.species_key]?.name?.split(' ').map((s) => s[0]).join('').toUpperCase()
      : 'GR';
    return `${prefix || 'GR'}-${iso}`;
  }, [form.species_key, species_presets]);

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() && !defaultName) return;
    setBusy(true);
    try {
      await createBatch({
        name: form.name.trim() || defaultName,
        species_key: form.species_key || null,
        notes: form.notes.trim() || null,
      });
      setForm({ ...form, name: '', notes: '' });
      toast.success('Batch started');
      await onCreated();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Plus className="size-4 text-muted-foreground" />
            <CardTitle>Start a batch</CardTitle>
          </div>
          <CardDescription>
            {activeBatch
              ? 'Starting a new batch archives the current one.'
              : 'Begin tracking a new grow run.'}
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="batch-name">Name</Label>
            <Input
              id="batch-name"
              value={form.name}
              placeholder={defaultName}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="batch-species">Species</Label>
            <SelectNative
              id="batch-species"
              value={form.species_key}
              onChange={(e) => setForm({ ...form, species_key: e.target.value })}
              className="mt-1.5"
            >
              <option value="">— none —</option>
              {speciesKeys.map((k) => (
                <option key={k} value={k}>
                  {species_presets[k].name}
                </option>
              ))}
            </SelectNative>
          </div>
          <div>
            <Label htmlFor="batch-notes">Notes (optional)</Label>
            <Input
              id="batch-notes"
              value={form.notes}
              placeholder="Substrate, inoculation details…"
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            <Play />
            {busy ? 'Starting…' : 'Start batch'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
