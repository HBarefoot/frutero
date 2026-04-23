import { useEffect, useState } from 'react';
import { Droplets, Save, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { fetchMistingStatus, saveMistingConfig } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export function MistingPanel({ actuator, onRefresh }) {
  const { can } = useAuth();
  const readOnly = !can('mutate');
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ enabled: false, threshold: '85', pulseSec: '10' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function reload() {
    try {
      const d = await fetchMistingStatus();
      setData(d);
      setForm({
        enabled: !!d.mister?.enabled,
        threshold: Number.isFinite(d.mister?.threshold) ? String(d.mister.threshold) : '85',
        pulseSec: Number.isFinite(d.mister?.pulseSec) ? String(d.mister.pulseSec) : '10',
      });
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    }
  }

  useEffect(() => { reload(); }, []);
  // Poll the safety countdown so the UI reflects min-off-time draining.
  useEffect(() => {
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveMistingConfig({
        enabled: form.enabled,
        actuator_key: actuator.key,
        humidity_threshold: parseFloat(form.threshold) || 0,
        pulse_seconds: parseInt(form.pulseSec, 10) || 10,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await reload();
      await onRefresh?.();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  const safety = data?.mister?.safety_status;

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets className="size-4 text-info" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Humidity automation
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{form.enabled ? 'on' : 'off'}</span>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            disabled={readOnly}
            aria-label="Toggle misting automation"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="mist-thresh">Fire when humidity &lt;</Label>
          <Input
            id="mist-thresh"
            type="number"
            min="1"
            max="100"
            step="0.5"
            value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: e.target.value })}
            className="mt-1.5"
            disabled={readOnly}
          />
        </div>
        <div>
          <Label htmlFor="mist-pulse">Pulse (sec)</Label>
          <Input
            id="mist-pulse"
            type="number"
            min="1"
            max="600"
            value={form.pulseSec}
            onChange={(e) => setForm({ ...form, pulseSec: e.target.value })}
            className="mt-1.5"
            disabled={readOnly}
          />
        </div>
      </div>

      <Button onClick={save} disabled={busy || readOnly} variant="soft" className="mt-3 w-full" size="sm">
        <Save />
        {saved ? 'Saved' : 'Save automation'}
      </Button>

      {safety && (
        <div className="mt-3 rounded-md border border-border bg-card/40 px-3 py-2">
          <div className="mb-1 flex items-center gap-2">
            <ShieldAlert className="size-3.5 text-warning" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Safety clamps
            </span>
          </div>
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            <li className="flex justify-between">
              <span>Max single on-time</span>
              <span className="font-mono">{safety.safety.max_on_seconds}s</span>
            </li>
            <li className="flex justify-between">
              <span>Min off between pulses</span>
              <span className="font-mono">
                {safety.safety.min_off_seconds}s
                {safety.min_off_remaining_seconds > 0 && (
                  <Badge variant="warning" className="ml-2">
                    cooldown {safety.min_off_remaining_seconds}s
                  </Badge>
                )}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Daily cap</span>
              <span className="font-mono">
                {safety.daily_used_seconds}s / {safety.safety.daily_max_seconds}s
              </span>
            </li>
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
