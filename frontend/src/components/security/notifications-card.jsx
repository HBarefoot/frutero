import { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  CircleSlash,
  Cloud,
  Loader2,
  Mail,
  MessageCircle,
  Send,
  Webhook,
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
import { useToast } from '@/components/ui/toast';
import {
  fetchNotificationsConfig,
  saveNotificationsConfig,
  testNotification,
} from '@/lib/api';

const EMPTY_FORM = {
  min_severity: 'info',
  telegram: { enabled: false, chat_id: '', bot_token: '' },
  email: { enabled: false, host: '', port: 587, secure: false, user: '', password: '', from: '', to: '' },
  webhook: { enabled: false, style: 'generic', url: '' },
  push: { enabled: false },
  cloud: { enabled: false },
};

export function NotificationsCard() {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(null);

  async function load() {
    try {
      const c = await fetchNotificationsConfig();
      setConfig(c);
      setForm({
        min_severity: c.min_severity,
        telegram: { enabled: c.telegram.enabled, chat_id: c.telegram.chat_id, bot_token: '' },
        email: {
          enabled: c.email.enabled,
          host: c.email.host,
          port: c.email.port,
          secure: c.email.secure,
          user: c.email.user,
          from: c.email.from,
          to: c.email.to,
          password: '',
        },
        webhook: { enabled: c.webhook.enabled, style: c.webhook.style, url: '' },
        push: { enabled: !!c.push?.enabled },
        cloud: { enabled: !!c.cloud?.enabled },
      });
    } catch (err) {
      toast.error(err);
    }
  }

  useEffect(() => { load(); }, []);

  async function savePatch(patch) {
    setBusy(true);
    try {
      const next = await saveNotificationsConfig(patch);
      setConfig(next);
      toast.success('Saved');
      // Clear write-only fields after save
      setForm((f) => ({
        ...f,
        telegram: { ...f.telegram, bot_token: '' },
        email: { ...f.email, password: '' },
        webhook: { ...f.webhook, url: '' },
      }));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function runTest(channel) {
    setTesting(channel);
    try {
      const r = await testNotification(channel);
      if (r.ok) {
        toast.success(`${channel} test delivered`);
      } else {
        toast.error(`${channel} test failed: ${r.reason}${r.detail ? ' — ' + r.detail : ''}`);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(null);
    }
  }

  if (!config) {
    return (
      <Card>
        <CardHeader>
          <CardTitleGroup>
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-muted-foreground" />
              <CardTitle>Notifications</CardTitle>
            </div>
            <CardDescription>Loading…</CardDescription>
          </CardTitleGroup>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" />
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>
            Deliver alerts (temp/humidity/sensor-silence) and warn-severity AI insights to Telegram, email, and webhooks.
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border border-border bg-background/40 px-3 py-2">
          <Label htmlFor="min-sev" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Minimum severity
          </Label>
          <SelectNative
            id="min-sev"
            value={form.min_severity}
            onChange={(e) => {
              setForm({ ...form, min_severity: e.target.value });
              savePatch({ min_severity: e.target.value });
            }}
            className="mt-1.5 max-w-xs"
          >
            <option value="info">info — deliver everything</option>
            <option value="warn">warn — only urgent alerts</option>
          </SelectNative>
        </div>

        <ChannelSection
          icon={MessageCircle}
          label="Telegram"
          enabled={form.telegram.enabled}
          hasCredential={config.telegram.has_token}
          credentialLabel="Bot token"
          onToggle={(v) => {
            setForm({ ...form, telegram: { ...form.telegram, enabled: v } });
            savePatch({ telegram: { enabled: v } });
          }}
          onTest={() => runTest('telegram')}
          testing={testing === 'telegram'}
          busy={busy}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tg-chat">Chat ID</Label>
              <Input
                id="tg-chat"
                value={form.telegram.chat_id}
                onChange={(e) => setForm({ ...form, telegram: { ...form.telegram, chat_id: e.target.value } })}
                placeholder="-100… or numeric user id"
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="tg-token">Bot token</Label>
              <Input
                id="tg-token"
                type="password"
                autoComplete="off"
                value={form.telegram.bot_token}
                placeholder={config.telegram.has_token ? '•••••• (set — type to replace)' : '123:ABC…'}
                onChange={(e) => setForm({ ...form, telegram: { ...form.telegram, bot_token: e.target.value } })}
                className="mt-1.5 font-mono"
              />
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              savePatch({
                telegram: {
                  chat_id: form.telegram.chat_id,
                  ...(form.telegram.bot_token ? { bot_token: form.telegram.bot_token } : {}),
                },
              })
            }
            disabled={busy}
          >
            Save Telegram
          </Button>
        </ChannelSection>

        <ChannelSection
          icon={Mail}
          label="Email (SMTP)"
          enabled={form.email.enabled}
          hasCredential={config.email.has_password}
          credentialLabel="SMTP password"
          onToggle={(v) => {
            setForm({ ...form, email: { ...form.email, enabled: v } });
            savePatch({ email: { enabled: v } });
          }}
          onTest={() => runTest('email')}
          testing={testing === 'email'}
          busy={busy}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sm-host">SMTP host</Label>
              <Input
                id="sm-host"
                value={form.email.host}
                placeholder="smtp.gmail.com"
                onChange={(e) => setForm({ ...form, email: { ...form.email, host: e.target.value } })}
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="sm-port">Port</Label>
              <Input
                id="sm-port"
                type="number"
                value={form.email.port}
                onChange={(e) => setForm({ ...form, email: { ...form.email, port: parseInt(e.target.value, 10) || 587 } })}
                className="mt-1.5 font-mono"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.email.secure}
                onCheckedChange={(v) => setForm({ ...form, email: { ...form.email, secure: v } })}
                aria-label="TLS-on-connect"
              />
              <Label className="text-xs">TLS on connect (port 465)</Label>
            </div>
            <div>
              <Label htmlFor="sm-user">Username</Label>
              <Input
                id="sm-user"
                value={form.email.user}
                placeholder="user@domain.com"
                onChange={(e) => setForm({ ...form, email: { ...form.email, user: e.target.value } })}
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="sm-pass">Password / app password</Label>
              <Input
                id="sm-pass"
                type="password"
                autoComplete="off"
                value={form.email.password}
                placeholder={config.email.has_password ? '•••••• (set — type to replace)' : ''}
                onChange={(e) => setForm({ ...form, email: { ...form.email, password: e.target.value } })}
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="sm-from">From address</Label>
              <Input
                id="sm-from"
                value={form.email.from}
                placeholder="frutero@mydomain.com"
                onChange={(e) => setForm({ ...form, email: { ...form.email, from: e.target.value } })}
                className="mt-1.5 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="sm-to">To address</Label>
              <Input
                id="sm-to"
                value={form.email.to}
                placeholder="grower@mydomain.com"
                onChange={(e) => setForm({ ...form, email: { ...form.email, to: e.target.value } })}
                className="mt-1.5 font-mono"
              />
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const patch = {
                host: form.email.host,
                port: form.email.port,
                secure: form.email.secure,
                user: form.email.user,
                from: form.email.from,
                to: form.email.to,
              };
              if (form.email.password) patch.password = form.email.password;
              savePatch({ email: patch });
            }}
            disabled={busy}
          >
            Save email
          </Button>
        </ChannelSection>

        <ChannelSection
          icon={Webhook}
          label="Webhook"
          enabled={form.webhook.enabled}
          hasCredential={config.webhook.has_url}
          credentialLabel="URL"
          onToggle={(v) => {
            setForm({ ...form, webhook: { ...form.webhook, enabled: v } });
            savePatch({ webhook: { enabled: v } });
          }}
          onTest={() => runTest('webhook')}
          testing={testing === 'webhook'}
          busy={busy}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="wh-style">Style</Label>
              <SelectNative
                id="wh-style"
                value={form.webhook.style}
                onChange={(e) => setForm({ ...form, webhook: { ...form.webhook, style: e.target.value } })}
                className="mt-1.5"
              >
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
                <option value="pagerduty">PagerDuty v2</option>
                <option value="generic">Generic JSON</option>
              </SelectNative>
            </div>
            <div>
              <Label htmlFor="wh-url">Incoming webhook URL</Label>
              <Input
                id="wh-url"
                type="password"
                autoComplete="off"
                value={form.webhook.url}
                placeholder={config.webhook.has_url ? '•••••• (set — type to replace)' : 'https://hooks.slack.com/services/…'}
                onChange={(e) => setForm({ ...form, webhook: { ...form.webhook, url: e.target.value } })}
                className="mt-1.5 font-mono"
              />
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const patch = { style: form.webhook.style };
              if (form.webhook.url) patch.url = form.webhook.url;
              savePatch({ webhook: patch });
            }}
            disabled={busy}
          >
            Save webhook
          </Button>
        </ChannelSection>

        <ChannelSection
          icon={Bell}
          label="Web Push"
          enabled={form.push.enabled}
          hasCredential={(config.push?.subscriptions ?? 0) > 0}
          credentialLabel="Devices"
          onToggle={(v) => {
            setForm({ ...form, push: { enabled: v } });
            savePatch({ push: { enabled: v } });
          }}
          onTest={() => runTest('push')}
          testing={testing === 'push'}
          busy={busy}
        >
          <p className="text-[11px] text-muted-foreground">
            Global toggle for the push channel. Each user enrolls their own devices from the
            Account page; push respects the same min-severity filter as email/Telegram.
            Self-signed HTTPS works after the client accepts the cert — Safari does not.
          </p>
        </ChannelSection>

        <ChannelSection
          icon={Cloud}
          label="Cloud (frutero-fleet)"
          enabled={form.cloud.enabled}
          hasCredential={!!config.cloud?.enrolled}
          credentialLabel="Enrolled"
          onToggle={(v) => {
            setForm({ ...form, cloud: { enabled: v } });
            savePatch({ cloud: { enabled: v } });
          }}
          onTest={() => runTest('cloud')}
          testing={testing === 'cloud'}
          busy={busy}
        >
          <p className="text-[11px] text-muted-foreground">
            Forwards alerts to the cloud control plane so you can see urgent
            events across every chamber from one inbox. Requires the Pi to be
            enrolled (configure on the Fleet card above). Re-fires of the same
            condition UPSERT in place rather than spamming the inbox.
          </p>
          {config.cloud?.enrolled && config.cloud.url && (
            <p className="text-[11px] text-muted-foreground">
              Posting to <span className="font-mono">{config.cloud.url}</span> as chamber #{config.cloud.chamber_id}.
            </p>
          )}
          {!config.cloud?.enrolled && (
            <p className="text-[11px] text-warning">
              Not enrolled. Use the Fleet card on this page to connect a cloud
              instance before enabling this channel.
            </p>
          )}
        </ChannelSection>
      </CardContent>
    </Card>
  );
}

function ChannelSection({ icon: Icon, label, enabled, hasCredential, credentialLabel, onToggle, onTest, testing, busy, children }) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{label}</span>
          {hasCredential ? (
            <Badge variant="success" className="text-[10px] uppercase"><CheckCircle2 className="size-3" />{credentialLabel} set</Badge>
          ) : (
            <Badge variant="muted" className="text-[10px] uppercase"><CircleSlash className="size-3" />no {credentialLabel.toLowerCase()}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onTest}
            disabled={busy || testing || !enabled || !hasCredential}
            title={!enabled ? 'Enable first' : !hasCredential ? `Set ${credentialLabel.toLowerCase()} first` : 'Send a test'}
          >
            {testing ? <Loader2 className="animate-spin" /> : <Send />}
            Test
          </Button>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            aria-label={`Toggle ${label}`}
          />
        </div>
      </div>
      {children}
    </div>
  );
}
