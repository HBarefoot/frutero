import { useEffect, useState } from 'react';
import {
  Check,
  Leaf,
  Loader2,
  Pencil,
  Plus,
  Sprout,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardTitleGroup,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import {
  applySpecies,
  createSpecies,
  deleteSpecies,
  fetchSpecies,
  suggestSpeciesRegimen,
  updateSpecies,
} from '@/lib/api';
import { useStatus } from '@/lib/status-context';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

export default function SpeciesPage() {
  const { settings, refresh } = useStatus();
  const { can } = useAuth();
  const isAdmin = can('admin');
  const readOnly = !can('mutate');

  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | <key>
  const current = settings?.settings?.species || '';

  async function load() {
    try {
      const out = await fetchSpecies();
      setList(out.species || []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function pick(key) {
    setBusy(true);
    try {
      await applySpecies(key);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(key) {
    if (!confirm('Delete this species? This won\'t remove past batches that referenced it.')) return;
    setBusy(true);
    try {
      await deleteSpecies(key);
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Species"
        description="Auto-populate thresholds, fan cycle, and misting for the species you're fruiting"
        actions={
          !readOnly && (
            <Button onClick={() => setEditing('new')} disabled={busy}>
              <Plus />
              Add species
            </Button>
          )
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {editing && (
        <SpeciesEditor
          species={editing === 'new' ? null : list.find((s) => s.key === editing)}
          onClose={() => setEditing(null)}
          onSaved={async () => { await load(); setEditing(null); }}
          isAdmin={isAdmin}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <SpeciesCard
            key={s.key}
            species={s}
            selected={s.key === current}
            disabled={busy || readOnly}
            readOnly={readOnly}
            isAdmin={isAdmin}
            onApply={() => pick(s.key)}
            onEdit={() => setEditing(s.key)}
            onDelete={() => onDelete(s.key)}
          />
        ))}
        {list.length === 0 && (
          <p className="text-xs text-muted-foreground">No species defined yet — click Add species.</p>
        )}
      </div>
    </>
  );
}

function SpeciesCard({ species, selected, disabled, readOnly, isAdmin, onApply, onEdit, onDelete }) {
  return (
    <Card className={cn('transition', selected && 'ring-1 ring-primary/50')}>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Leaf className="size-4 text-muted-foreground" />
            <CardTitle className="text-base normal-case">{species.name}</CardTitle>
          </div>
          <CardDescription className="flex items-center gap-2">
            <span className="capitalize">{species.key.replace(/_/g, ' ')}</span>
            <SourceBadge source={species.source} />
          </CardDescription>
        </CardTitleGroup>
        {selected && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
            <Check className="size-3" />
            Active
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <SpecRow label="Temperature" value={`${species.temp_min}–${species.temp_max} °F`} />
          <SpecRow label="Humidity" value={`${species.humid_min}–${species.humid_max} %`} />
          <SpecRow label="Photoperiod" value={`${species.light_hours} h`} />
          <SpecRow label="Fan cycle" value={`Every ${species.fan_interval} min`} />
          {species.mister_threshold != null && (
            <SpecRow
              label="Mist trigger"
              value={`< ${species.mister_threshold}% · ${species.mister_pulse_seconds || 10}s`}
            />
          )}
        </dl>
        {species.notes && (
          <p className="rounded-md border border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
            {species.notes}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant={selected ? 'secondary' : 'soft'}
            className="flex-1"
            onClick={onApply}
            disabled={disabled || selected}
          >
            <Sprout />
            {selected ? 'Applied' : readOnly ? 'Read only' : 'Apply'}
          </Button>
          {!readOnly && (
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit">
              <Pencil />
            </Button>
          )}
          {isAdmin && species.source !== 'built-in' && (
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete">
              <Trash2 />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SourceBadge({ source }) {
  if (source === 'built-in') {
    return <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">built-in</span>;
  }
  if (source === 'ai-suggested') {
    return <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-primary"><Sparkles className="size-2.5" />ai</span>;
  }
  return <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">custom</span>;
}

function SpecRow({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-foreground">{value}</dd>
    </div>
  );
}

const EMPTY = {
  name: '',
  temp_min: 60, temp_max: 75,
  humid_min: 80, humid_max: 95,
  light_hours: 12,
  fan_interval: 30,
  mister_threshold: '',
  mister_pulse_seconds: '',
  notes: '',
};

function SpeciesEditor({ species, onClose, onSaved, isAdmin }) {
  const isNew = !species;
  const [form, setForm] = useState(() => species ? { ...EMPTY, ...species, mister_threshold: species.mister_threshold ?? '', mister_pulse_seconds: species.mister_pulse_seconds ?? '' } : { ...EMPTY });
  const [aiNotes, setAiNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Sticky for the editor session: once AI fills the numeric fields,
  // the species is saved as 'ai-suggested' even if the operator tweaks
  // a value afterward (refining an AI suggestion is still AI-sourced).
  const [aiSuggested, setAiSuggested] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function suggest() {
    if (!form.name.trim()) {
      setErr('Enter a name first so the AI knows what species to look up.');
      return;
    }
    setAiBusy(true);
    setErr(null);
    try {
      const out = await suggestSpeciesRegimen({ name: form.name.trim(), notes: aiNotes });
      const r = out.regimen;
      setForm((f) => ({
        ...f,
        // Don't overwrite the operator's name/key — they typed those.
        temp_min: r.temp_min,
        temp_max: r.temp_max,
        humid_min: r.humid_min,
        humid_max: r.humid_max,
        light_hours: r.light_hours,
        fan_interval: r.fan_interval,
        mister_threshold: r.mister_threshold ?? '',
        mister_pulse_seconds: r.mister_pulse_seconds ?? '',
        notes: r.notes || f.notes,
      }));
      setAiSuggested(true);
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.response?.data?.error || e.message);
    } finally {
      setAiBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload = normalizeForApi(form);
      if (isNew) {
        await createSpecies({ ...payload, source: aiSuggested ? 'ai-suggested' : 'custom' });
      } else {
        await updateSpecies(species.key, payload);
      }
      await onSaved();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitleGroup>
          <CardTitle>{isNew ? 'New species' : `Edit ${species.name}`}</CardTitle>
          <CardDescription>
            {isNew
              ? 'Define a regimen, or click Ask AI to suggest one based on the species name.'
              : 'Tighten the ranges to your setup or update the notes. Built-in species can be edited but not deleted.'}
          </CardDescription>
        </CardTitleGroup>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Pink Oyster" />
          </Field>
          <div />
          <Field label="Temp min (°F)">
            <Input type="number" value={form.temp_min} onChange={(e) => set('temp_min', Number(e.target.value))} />
          </Field>
          <Field label="Temp max (°F)">
            <Input type="number" value={form.temp_max} onChange={(e) => set('temp_max', Number(e.target.value))} />
          </Field>
          <Field label="Humidity min (%)">
            <Input type="number" value={form.humid_min} onChange={(e) => set('humid_min', Number(e.target.value))} />
          </Field>
          <Field label="Humidity max (%)">
            <Input type="number" value={form.humid_max} onChange={(e) => set('humid_max', Number(e.target.value))} />
          </Field>
          <Field label="Light hours / day">
            <Input type="number" min="0" max="24" value={form.light_hours} onChange={(e) => set('light_hours', Number(e.target.value))} />
          </Field>
          <Field label="Fan cycle (minutes)">
            <Input type="number" min="1" max="240" value={form.fan_interval} onChange={(e) => set('fan_interval', Number(e.target.value))} />
          </Field>
          <Field label="Mist threshold (% humidity, optional)">
            <Input type="number" min="0" max="100" value={form.mister_threshold} onChange={(e) => set('mister_threshold', e.target.value)} placeholder="leave empty to disable" />
          </Field>
          <Field label="Mist pulse (seconds, optional)">
            <Input type="number" min="1" max="120" value={form.mister_pulse_seconds} onChange={(e) => set('mister_pulse_seconds', e.target.value)} placeholder="leave empty to disable" />
          </Field>
          <Field label="Notes (optional)" className="sm:col-span-2">
            <textarea
              value={form.notes || ''}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Fruiting tips, contamination risks, FAE notes..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </Field>
        </div>

        {isAdmin && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
              <Sparkles className="size-3.5" />
              Ask AI for a regimen
            </div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Fills temp / humidity / light / fan / mist values from the species name.
              Operator notes (climate, substrate, target yield) refine the suggestion.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={aiNotes}
                onChange={(e) => setAiNotes(e.target.value)}
                placeholder="Optional: hot/cold climate, substrate, target yield…"
                className="flex-1 text-xs"
                maxLength={500}
              />
              <Button onClick={suggest} disabled={aiBusy || !form.name.trim()} variant="outline">
                {aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Ask AI
              </Button>
            </div>
          </div>
        )}

        {err && (
          <p className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !form.name.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children, className }) {
  return (
    <label className={cn('block', className)}>
      <Label className="text-[11px]">{label}</Label>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// Convert form values (mostly strings from input fields) to numbers
// where the API expects them. Empty mist fields → null so the server
// can store them as "no automation".
function normalizeForApi(form) {
  const numOrNull = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    name: form.name.trim(),
    temp_min: Number(form.temp_min),
    temp_max: Number(form.temp_max),
    humid_min: Number(form.humid_min),
    humid_max: Number(form.humid_max),
    light_hours: Number(form.light_hours),
    fan_interval: Number(form.fan_interval),
    mister_threshold: numOrNull(form.mister_threshold),
    mister_pulse_seconds: numOrNull(form.mister_pulse_seconds),
    notes: form.notes ? String(form.notes).slice(0, 1000) : null,
  };
}
