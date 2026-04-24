import { useEffect, useState } from 'react';
import { Bell, BellOff, KeyRound, Laptop, LogOut, Save, Send, UserCircle } from 'lucide-react';
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
import { PageHeader } from '@/components/layout/page-header';
import { PasswordStrength } from '@/components/auth/password-strength';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/toast';
import {
  changeMyPassword,
  fetchMySessions,
  revokeMyOtherSessions,
  updateMyName,
  fetchPushVapidKey,
  subscribePush,
  unsubscribePush,
  listMyPushSubscriptions,
  testPush,
} from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';

const ROLE_VARIANT = { owner: 'warning', operator: 'info', viewer: 'muted' };

export default function AccountPage() {
  const { user, refresh } = useAuth();

  return (
    <>
      <PageHeader
        title="My account"
        description="Your profile, password, and active sessions"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProfileCard user={user} onSaved={refresh} />
        <PasswordCard />
        <PushNotificationsCard className="lg:col-span-2" />
        <SessionsCard className="lg:col-span-2" />
      </div>
    </>
  );
}

function ProfileCard({ user, onSaved }) {
  const [name, setName] = useState(user?.name || '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { setName(user?.name || ''); }, [user?.name]);

  async function save() {
    if (!name.trim() || name === user?.name) return;
    setBusy(true);
    setError(null);
    try {
      await updateMyName(name.trim());
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <UserCircle className="size-4 text-muted-foreground" />
            <CardTitle>Profile</CardTitle>
          </div>
          <CardDescription>Your display name and role</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="acct-email">Email</Label>
          <Input id="acct-email" value={user?.email || ''} disabled className="mt-1.5 font-mono" />
          <p className="mt-1 text-[11px] text-muted-foreground">Email changes require a new invite.</p>
        </div>
        <div>
          <Label htmlFor="acct-name">Name</Label>
          <Input
            id="acct-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5"
            maxLength={120}
          />
        </div>
        <div>
          <Label>Role</Label>
          <div className="mt-1.5">
            <Badge variant={ROLE_VARIANT[user?.role] || 'muted'} className="uppercase">{user?.role}</Badge>
          </div>
        </div>
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}
        <Button onClick={save} disabled={busy || !name.trim() || name === user?.name} className="w-full">
          <Save />
          {saved ? 'Saved' : 'Save name'}
        </Button>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (form.next !== form.confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (form.next.length < 10) {
      setError('New password must be at least 10 characters.');
      return;
    }
    setBusy(true);
    try {
      await changeMyPassword({ current_password: form.current, new_password: form.next });
      setForm({ current: '', next: '', confirm: '' });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <CardTitle>Password</CardTitle>
          </div>
          <CardDescription>Changing your password logs out every other device.</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3">
          <div>
            <Label htmlFor="acct-current">Current password</Label>
            <Input
              id="acct-current"
              type="password"
              value={form.current}
              onChange={(e) => setForm({ ...form, current: e.target.value })}
              autoComplete="current-password"
              required
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="acct-new">New password</Label>
            <Input
              id="acct-new"
              type="password"
              value={form.next}
              onChange={(e) => setForm({ ...form, next: e.target.value })}
              autoComplete="new-password"
              required
              minLength={10}
              className="mt-1.5"
            />
            <PasswordStrength password={form.next} className="mt-2" />
          </div>
          <div>
            <Label htmlFor="acct-confirm">Confirm new password</Label>
            <Input
              id="acct-confirm"
              type="password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              autoComplete="new-password"
              required
              className="mt-1.5"
            />
          </div>
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
          )}
          <Button type="submit" disabled={busy || !form.current || !form.next} className="w-full">
            <KeyRound />
            {saved ? 'Password changed' : 'Change password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard({ className }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function reload() {
    setLoading(true);
    try { setSessions((await fetchMySessions()).sessions || []); }
    catch (err) { setError(errMsg(err)); }
    finally { setLoading(false); }
  }

  useEffect(() => { reload(); }, []);

  async function revokeOthers() {
    if (!confirm('Log out every other device? Your current browser will stay signed in.')) return;
    setBusy(true);
    try {
      await revokeMyOtherSessions();
      await reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const others = sessions.filter((s) => !s.is_current).length;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Laptop className="size-4 text-muted-foreground" />
            <CardTitle>Active sessions</CardTitle>
          </div>
          <CardDescription>
            {loading ? 'Loading…' : `${sessions.length} total · ${others} other device${others === 1 ? '' : 's'}`}
          </CardDescription>
        </CardTitleGroup>
        <Button
          variant="outline"
          size="sm"
          onClick={revokeOthers}
          disabled={busy || others === 0}
        >
          <LogOut />
          Log out other devices
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {error && (
          <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}
        {sessions.length === 0 && !loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((s) => (
              <li key={s.token_preview} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {s.is_current && <Badge variant="success">current</Badge>}
                    <span className="font-mono text-xs text-muted-foreground">{s.token_preview}…</span>
                    {s.ip && <span className="font-mono text-xs text-muted-foreground">· {s.ip}</span>}
                  </div>
                  {s.user_agent && (
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">{s.user_agent}</div>
                  )}
                </div>
                <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                  <div>last seen <span className="font-mono">{formatRelative(s.last_seen_at)}</span></div>
                  <div>expires <span className="font-mono">{formatDateTime(s.expires_at)}</span></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Per-user push notification enrollment. The SW handles delivery (see
// frontend/public/sw.js); this card is just the subscribe/unsubscribe
// UI and a device list so the operator can see what's enrolled and
// prune stale entries.
function PushNotificationsCard({ className }) {
  const toast = useToast();
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [subs, setSubs] = useState(null);
  const [hasLocal, setHasLocal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setSupported(false);
      return;
    }
    refresh();
  }, []);

  async function refresh() {
    try {
      const r = await listMyPushSubscriptions();
      setSubs(r.subscriptions || []);
      const reg = await navigator.serviceWorker.ready;
      const cur = await reg.pushManager.getSubscription();
      setHasLocal(!!cur);
    } catch (err) {
      toast.error(err);
    }
  }

  async function subscribe() {
    setBusy(true);
    try {
      if (Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        setPermission(p);
        if (p !== 'granted') {
          toast.warn('Permission denied · no notifications until you allow them');
          return;
        }
      }
      const { public_key } = await fetchPushVapidKey();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(public_key),
      });
      const payload = sub.toJSON();
      await subscribePush({
        endpoint: payload.endpoint,
        keys: payload.keys,
        user_agent: navigator.userAgent,
      });
      toast.success('Subscribed · a test push will arrive shortly');
      await refresh();
      await testPush();
    } catch (err) {
      const msg = errMsg(err) || '';
      if (msg.toLowerCase().includes('denied')) {
        toast.warn('Your browser refused the subscription — usually a self-signed-cert issue. Accept the cert in a fresh tab and try again.');
      } else {
        toast.error(err);
      }
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const ep = sub.endpoint;
        await sub.unsubscribe();
        await unsubscribePush(ep).catch(() => {});
      }
      toast.success('Unsubscribed');
      await refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function removeOther(endpointPreview) {
    // Server only stores endpoint, not a stable ID exposed to the UI
    // that matches what the browser has. For safety, we only allow
    // removing *this* device; cross-device pruning happens via the
    // server's 410 cleanup when a push attempt fails.
    toast.info('Open the other device and click Unsubscribe there. Dead devices are auto-pruned when a push fails.');
  }

  if (!supported) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitleGroup>
            <div className="flex items-center gap-2">
              <BellOff className="size-4 text-muted-foreground" />
              <CardTitle>Push notifications</CardTitle>
            </div>
            <CardDescription>Not supported in this browser</CardDescription>
          </CardTitleGroup>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Your browser doesn&rsquo;t support the Push API, or you&rsquo;re running over an
            insecure origin. Safari over a self-signed LAN cert often lands here — use
            email or Telegram notifications instead.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-muted-foreground" />
            <CardTitle>Push notifications</CardTitle>
          </div>
          <CardDescription>
            {hasLocal
              ? 'This device is subscribed. Warn-severity alerts arrive as native notifications.'
              : 'Subscribe this device to get alerts as native notifications on your phone/desktop.'}
          </CardDescription>
        </CardTitleGroup>
        <div className="flex items-center gap-2">
          {permission === 'denied' && <Badge variant="danger" className="uppercase">blocked</Badge>}
          {hasLocal && <Badge variant="success" className="uppercase">active</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {!hasLocal ? (
            <Button size="sm" onClick={subscribe} disabled={busy || permission === 'denied'}>
              <Bell />
              {busy ? 'Working…' : 'Enable on this device'}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => testPush().then(() => toast.info('Test sent'))} disabled={busy}>
                <Send />
                Send test
              </Button>
              <Button size="sm" variant="ghost" onClick={unsubscribe} disabled={busy}>
                <BellOff />
                Disable on this device
              </Button>
            </>
          )}
        </div>

        {permission === 'denied' && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            Notifications were blocked for this site. Open your browser&rsquo;s site settings
            to re-enable, then click Enable again.
          </p>
        )}

        {subs && subs.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Your enrolled devices ({subs.length})
            </div>
            <ul className="divide-y divide-border rounded-md border border-border bg-background/40 text-xs">
              {subs.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{s.user_agent || 'Unknown device'}</div>
                    <div className="text-[10px] text-muted-foreground">
                      added {formatRelative(s.created_at)}
                      {s.last_seen_at && ` · last seen ${formatRelative(s.last_seen_at)}`}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeOther(s.endpoint_preview)}>
                    remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Self-signed HTTPS works after you accept the cert in this browser. Safari on iOS
          does not support push over self-signed origins — use another channel for iPhones
          until you put a real cert in front.
        </p>
      </CardContent>
    </Card>
  );
}

// VAPID keys are URL-safe base64; the Push API wants a Uint8Array.
function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

function errMsg(err) {
  return err?.response?.data?.error || err?.message || 'Request failed';
}
