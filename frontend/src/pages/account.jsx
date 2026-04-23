import { useEffect, useState } from 'react';
import { KeyRound, Laptop, LogOut, Save, UserCircle } from 'lucide-react';
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
import { useAuth } from '@/lib/auth-context';
import {
  changeMyPassword,
  fetchMySessions,
  revokeMyOtherSessions,
  updateMyName,
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
            <p className="mt-1 text-[11px] text-muted-foreground">Minimum 10 characters.</p>
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

function errMsg(err) {
  return err?.response?.data?.error || err?.message || 'Request failed';
}
