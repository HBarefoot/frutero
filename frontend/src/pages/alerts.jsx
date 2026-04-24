import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, MessageCircle, Save, Send } from 'lucide-react';
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
import { PageHeader } from '@/components/layout/page-header';
import {
  fetchTelegramConfig,
  saveAlerts,
  saveTelegramConfig,
  testTelegram,
} from '@/lib/api';
import { useStatus } from '@/lib/status-context';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';

export default function AlertsPage() {
  const { alerts, refresh } = useStatus();
  const { can } = useAuth();
  const readOnly = !can('mutate');
  const isOwner = can('admin');
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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
              readOnly={readOnly}
              onChange={(t) => setForm({ ...form, temperature: t })}
            />
            <MetricRow
              metric="humidity"
              label="Humidity"
              unit="%"
              data={form.humidity}
              readOnly={readOnly}
              onChange={(h) => setForm({ ...form, humidity: h })}
            />
            <Button onClick={save} disabled={busy || readOnly} variant="soft" className="w-full">
              <Save />
              {saved ? 'Saved' : readOnly ? 'Read only' : 'Save thresholds'}
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

        {isOwner && <TelegramCard className="lg:col-span-2" />}
      </div>
    </>
  );
}

function TelegramCard({ className }) {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({ enabled: false, chat_id: '', bot_token: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  async function reload() {
    try {
      const d = await fetchTelegramConfig();
      setCfg(d);
      setForm({ enabled: d.enabled, chat_id: d.chat_id, bot_token: '' });
    } catch (err) {
      setError(errMsg(err));
    }
  }

  useEffect(() => { reload(); }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = { enabled: form.enabled, chat_id: form.chat_id };
      if (form.bot_token) payload.bot_token = form.bot_token;
      await saveTelegramConfig(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setTestResult(null);
    try {
      const r = await testTelegram();
      setTestResult(r);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <MessageCircle className="size-4 text-muted-foreground" />
            <CardTitle>Telegram notifications</CardTitle>
          </div>
          <CardDescription>
            Push alert firings to a Telegram chat. Owner-only. Create a bot via{' '}
            <span className="font-mono">@BotFather</span> and grab its chat_id by messaging the bot once.
          </CardDescription>
        </CardTitleGroup>
        <div className="flex items-center gap-2">
          {cfg?.enabled && cfg?.has_token && <Badge variant="success">configured</Badge>}
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            aria-label="Enable Telegram alerts"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="tg-chat">Chat ID</Label>
            <Input
              id="tg-chat"
              value={form.chat_id}
              onChange={(e) => setForm({ ...form, chat_id: e.target.value })}
              placeholder="e.g. 123456789 or -1001234567890"
              className="mt-1.5 font-mono"
            />
          </div>
          <div>
            <Label htmlFor="tg-token">Bot token</Label>
            <Input
              id="tg-token"
              type="password"
              value={form.bot_token}
              onChange={(e) => setForm({ ...form, bot_token: e.target.value })}
              placeholder={cfg?.token_masked || 'paste bot token'}
              className="mt-1.5 font-mono"
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Leave blank to keep the stored token. Shown once when pasted.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={busy} variant="soft">
            <Save />
            {saved ? 'Saved' : 'Save Telegram config'}
          </Button>
          <Button onClick={runTest} disabled={busy || !cfg?.has_token} variant="outline">
            <Send />
            Send test message
          </Button>
        </div>
        {testResult && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              testResult.sent
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-warning/30 bg-warning/10 text-warning'
            }`}
          >
            {testResult.sent
              ? 'Test message delivered to Telegram.'
              : `Test failed: ${testResult.reason || 'unknown'}`}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function errMsg(err) {
  return err?.response?.data?.error || err?.message || 'Request failed';
}

function MetricRow({ metric, label, unit, data, readOnly, onChange }) {
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
            disabled={readOnly}
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
            disabled={readOnly}
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
            disabled={readOnly}
            className="mt-1.5"
          />
        </div>
      </div>
    </div>
  );
}
