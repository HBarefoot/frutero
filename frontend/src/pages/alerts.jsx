import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, Save } from 'lucide-react';
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
import { PageHeader } from '@/components/layout/page-header';
import { saveAlerts } from '@/lib/api';
import { useStatus } from '@/lib/status-context';
import { formatDateTime } from '@/lib/format';

export default function AlertsPage() {
  const { alerts, refresh } = useStatus();
  const [form, setForm] = useState({
    temperature: { min: '', max: '', enabled: true },
    humidity: { min: '', max: '', enabled: true },
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const cfg = alerts?.config;
    if (!cfg) return;
    setForm({
      temperature: {
        min: cfg.temperature?.min ?? '',
        max: cfg.temperature?.max ?? '',
        enabled: cfg.temperature?.enabled !== false,
      },
      humidity: {
        min: cfg.humidity?.min ?? '',
        max: cfg.humidity?.max ?? '',
        enabled: cfg.humidity?.enabled !== false,
      },
    });
  }, [alerts?.config]);

  async function save() {
    setBusy(true);
    try {
      await saveAlerts({
        temperature: {
          min: form.temperature.min === '' ? null : Number(form.temperature.min),
          max: form.temperature.max === '' ? null : Number(form.temperature.max),
          enabled: form.temperature.enabled,
        },
        humidity: {
          min: form.humidity.min === '' ? null : Number(form.humidity.min),
          max: form.humidity.max === '' ? null : Number(form.humidity.max),
          enabled: form.humidity.enabled,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const history = alerts?.history || [];

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Threshold rules and alert history"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitleGroup>
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-muted-foreground" />
                <CardTitle>Thresholds</CardTitle>
              </div>
              <CardDescription>
                Trigger an alert when a reading leaves the safe range
              </CardDescription>
            </CardTitleGroup>
          </CardHeader>
          <CardContent className="space-y-4">
            <MetricRow
              metric="temperature"
              label="Temperature"
              unit="°F"
              data={form.temperature}
              onChange={(t) => setForm({ ...form, temperature: t })}
            />
            <MetricRow
              metric="humidity"
              label="Humidity"
              unit="%"
              data={form.humidity}
              onChange={(h) => setForm({ ...form, humidity: h })}
            />
            <Button onClick={save} disabled={busy} variant="soft" className="w-full">
              <Save />
              {saved ? 'Saved' : 'Save thresholds'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitleGroup>
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-muted-foreground" />
                <CardTitle>Recent alerts</CardTitle>
              </div>
              <CardDescription>Last {Math.min(history.length, 20)} events</CardDescription>
            </CardTitleGroup>
          </CardHeader>
          <CardContent className="pt-0">
            {history.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No alerts yet. That's a good thing.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {history.slice(0, 20).map((a, i) => (
                  <li
                    key={a.id || i}
                    className="flex items-start justify-between gap-3 py-2.5 text-sm"
                  >
                    <span className="text-danger">{a.message}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDateTime(a.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function MetricRow({ metric, label, unit, data, onChange }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <Label className="text-sm normal-case tracking-normal text-foreground">
          {label}
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {data.enabled ? 'Enabled' : 'Disabled'}
          </span>
          <Switch
            checked={data.enabled}
            onCheckedChange={(v) => onChange({ ...data, enabled: v })}
            aria-label={`${label} alerts`}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${metric}-min`}>Min ({unit})</Label>
          <Input
            id={`${metric}-min`}
            type="number"
            value={data.min}
            onChange={(e) => onChange({ ...data, min: e.target.value })}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor={`${metric}-max`}>Max ({unit})</Label>
          <Input
            id={`${metric}-max`}
            type="number"
            value={data.max}
            onChange={(e) => onChange({ ...data, max: e.target.value })}
            className="mt-1.5"
          />
        </div>
      </div>
    </div>
  );
}
