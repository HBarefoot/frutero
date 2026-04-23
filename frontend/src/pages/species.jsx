import { useState } from 'react';
import { Check, Leaf, Sprout } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardTitleGroup,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { applySpecies } from '@/lib/api';
import { useStatus } from '@/lib/status-context';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

export default function SpeciesPage() {
  const { settings, refresh } = useStatus();
  const { can } = useAuth();
  const readOnly = !can('mutate');
  const [busy, setBusy] = useState(false);
  const current = settings?.settings?.species || '';
  const presets = settings?.species_presets || {};

  async function pick(key) {
    setBusy(true);
    try {
      await applySpecies(key);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Species presets"
        description="Auto-populate thresholds and fan cycle for the species you're fruiting"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(presets).map(([key, preset]) => (
          <SpeciesCard
            key={key}
            presetKey={key}
            preset={preset}
            selected={key === current}
            disabled={busy || readOnly}
            readOnly={readOnly}
            onSelect={() => pick(key)}
          />
        ))}
      </div>
    </>
  );
}

function SpeciesCard({ presetKey, preset, selected, disabled, readOnly, onSelect }) {
  return (
    <Card
      className={cn(
        'transition',
        selected && 'ring-1 ring-primary/50'
      )}
    >
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Leaf className="size-4 text-muted-foreground" />
            <CardTitle className="text-base normal-case">{preset.name}</CardTitle>
          </div>
          <CardDescription className="capitalize">{presetKey.replace('_', ' ')}</CardDescription>
        </CardTitleGroup>
        {selected && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
            <Check className="size-3" />
            Active
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <SpecRow label="Temperature" value={`${preset.temp_min}–${preset.temp_max} °F`} />
          <SpecRow label="Humidity" value={`${preset.humid_min}–${preset.humid_max} %`} />
          <SpecRow label="Photoperiod" value={`${preset.light_hours} h`} />
          <SpecRow label="Fan cycle" value={`Every ${preset.fan_interval} min`} />
          {preset.mister_threshold !== undefined && (
            <SpecRow
              label="Mist trigger"
              value={`< ${preset.mister_threshold}% · ${preset.mister_pulse_seconds}s`}
            />
          )}
        </dl>
        <Button
          variant={selected ? 'secondary' : 'soft'}
          className="w-full"
          onClick={onSelect}
          disabled={disabled || selected}
        >
          <Sprout />
          {selected ? 'Applied' : readOnly ? 'Read only' : 'Apply preset'}
        </Button>
      </CardContent>
    </Card>
  );
}

function SpecRow({ label, value }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-foreground">{value}</dd>
    </div>
  );
}
