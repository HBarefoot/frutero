import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  KeyRound,
  MailPlus,
  MoreHorizontal,
  ShieldAlert,
  Trash2,
  UserPlus,
  UserX,
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
import { SelectNative } from '@/components/ui/select-native';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth-context';
import {
  createInvite,
  deleteUserRequest,
  fetchInvites,
  fetchUsers,
  issuePasswordReset,
  revokeInvite,
  revokeUserSessions,
  setUserDisabled,
  updateUserRole,
} from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

const ROLE_VARIANT = { owner: 'warning', operator: 'info', viewer: 'muted' };

export default function TeamPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resetLink, setResetLink] = useState(null);

  const load = useCallback(async () => {
    try {
      const [u, i] = await Promise.all([fetchUsers(), fetchInvites()]);
      setUsers(u.users || []);
      setInvites(i.invites || []);
    } catch {
      setError('Unable to load team data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (user?.role !== 'owner') {
    return (
      <>
        <PageHeader
          title="Team"
          description="Manage users, roles, and invites"
        />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <ShieldAlert className="mx-auto mb-2 size-6 text-muted-foreground/40" />
            Only owners can manage the team.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage users, roles, and pending invites"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <UsersCard
            users={users}
            currentUserId={user.id}
            loading={loading}
            onReload={load}
            onIssueReset={setResetLink}
          />
          <InvitesCard invites={invites} onReload={load} />
        </div>
        <InviteForm onCreated={load} />
      </div>
      {error && (
        <p className="mt-4 text-xs text-danger">{error}</p>
      )}
      {resetLink && (
        <ResetLinkModal link={resetLink} onClose={() => setResetLink(null)} />
      )}
    </>
  );
}

function UsersCard({ users, currentUserId, loading, onReload, onIssueReset }) {
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <CardTitle>Users</CardTitle>
          <CardDescription>{users.length} total</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <p className="py-6 text-sm text-muted-foreground">Loading users…</p>
        ) : (
          <ul className="divide-y divide-border">
            {users.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                self={u.id === currentUserId}
                onReload={onReload}
                onIssueReset={onIssueReset}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UserRow({ u, self, onReload, onIssueReset }) {
  async function changeRole(role) {
    try {
      await updateUserRole(u.id, role);
      onReload();
    } catch (err) {
      if (err?.response?.data?.error === 'last_owner') {
        alert('Cannot demote the last owner.');
      }
    }
  }

  async function toggleDisabled() {
    try {
      await setUserDisabled(u.id, !u.disabled);
      onReload();
    } catch (err) {
      const code = err?.response?.data?.error;
      if (code === 'last_owner') alert('Cannot disable the last owner.');
      else if (code === 'cannot_disable_self') alert('Cannot disable your own account.');
    }
  }

  async function revokeAllSessions() {
    await revokeUserSessions(u.id);
    alert('All sessions revoked for ' + u.email);
  }

  async function remove() {
    if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    try {
      await deleteUserRequest(u.id);
      onReload();
    } catch (err) {
      const code = err?.response?.data?.error;
      if (code === 'last_owner') alert('Cannot delete the last owner.');
      else if (code === 'cannot_delete_self') alert('Cannot delete your own account.');
    }
  }

  async function issueReset() {
    try {
      const { token, expires_at } = await issuePasswordReset(u.id);
      onIssueReset({
        email: u.email,
        url: `${window.location.origin}/reset/${token}`,
        expires_at,
      });
    } catch (err) {
      const code = err?.response?.data?.error;
      alert(code === 'user_disabled'
        ? 'Re-enable this user before issuing a reset.'
        : 'Could not issue a reset link.');
    }
  }

  return (
    <li className={cn('flex items-center justify-between gap-3 py-3', u.disabled && 'opacity-60')}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={u.name} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="truncate font-medium">{u.name}</span>
            {self && <Badge variant="muted" className="text-[10px]">you</Badge>}
            {u.disabled && <Badge variant="danger" className="text-[10px]">disabled</Badge>}
          </div>
          <div className="truncate text-xs text-muted-foreground">{u.email}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={ROLE_VARIANT[u.role]} className="uppercase">
          {u.role}
        </Badge>
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          {u.last_login_at ? `seen ${formatRelative(u.last_login_at)}` : 'never signed in'}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="User actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Change role</DropdownMenuLabel>
            {['owner', 'operator', 'viewer'].map((r) => (
              <DropdownMenuItem
                key={r}
                disabled={r === u.role}
                onSelect={() => changeRole(r)}
              >
                {r === u.role ? <Check /> : <span className="size-4" />}
                <span className="capitalize">{r}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={issueReset} disabled={u.disabled}>
              <KeyRound />
              Issue password reset
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={revokeAllSessions}>
              <UserX />
              Revoke sessions
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleDisabled}>
              <UserX />
              {u.disabled ? 'Re-enable' : 'Disable'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={remove}
              className="text-danger focus:bg-danger/10 focus:text-danger [&_svg]:text-danger"
            >
              <Trash2 />
              Delete user
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function InvitesCard({ invites, onReload }) {
  async function revoke(token) {
    if (!confirm('Revoke this invite?')) return;
    await revokeInvite(token);
    onReload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <CardTitle>Pending invites</CardTitle>
          <CardDescription>{invites.length} outstanding</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {invites.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No pending invites.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {invites.map((inv) => (
                <li key={inv.token} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="truncate">{inv.email}</span>
                      <Badge variant={ROLE_VARIANT[inv.role]} className="uppercase">
                        {inv.role}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Expires {formatDateTime(inv.expires_at)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => revoke(inv.token)}
                      className="text-muted-foreground hover:bg-danger/10 hover:text-danger"
                      aria-label="Revoke invite"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Invite links are only shown at creation time and are not stored in
              plaintext. If you missed the copy window, revoke and reissue.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function InviteForm({ onCreated }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('operator');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const inv = await createInvite({ email: email.trim(), role });
      const url = `${window.location.origin}/invite/${inv.token}`;
      setSuccess(url);
      setEmail('');
      onCreated?.();
    } catch (err) {
      const code = err?.response?.data?.error;
      setError(
        code === 'email_exists'
          ? 'A user with that email already exists.'
          : code === 'invalid_email'
          ? 'That does not look like a valid email.'
          : 'Could not create invite.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <MailPlus className="size-4 text-muted-foreground" />
            <CardTitle>Invite a teammate</CardTitle>
          </div>
          <CardDescription>
            Generates a one-time URL. Copy and send it directly for now; email delivery is coming.
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="inv-email">Email</Label>
            <Input
              id="inv-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="inv-role">Role</Label>
            <SelectNative
              id="inv-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1.5"
            >
              <option value="viewer">Viewer · read-only</option>
              <option value="operator">Operator · control devices</option>
              <option value="owner">Owner · full admin</option>
            </SelectNative>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            <UserPlus />
            {busy ? 'Creating…' : 'Create invite'}
          </Button>
        </form>
        {success && (
          <div className="mt-4 rounded-md border border-success/30 bg-success/10 p-3 text-xs">
            <div className="mb-1 font-medium text-success">Invite created — copy now</div>
            <code className="block break-all font-mono text-[11px] text-foreground">
              {success}
            </code>
            <p className="mt-2 text-muted-foreground">
              Expires in 72 hours. This link is stored hashed — it will not be
              shown again. If you lose it, revoke and reissue.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResetLinkModal({ link, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* user can select manually */ }
  }
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitleGroup>
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <CardTitle>Password reset link</CardTitle>
            </div>
            <CardDescription>
              Send this link to <span className="font-mono">{link.email}</span> out-of-band.
              It is shown only once. Expires in 72 hours.
            </CardDescription>
          </CardTitleGroup>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-border bg-background/40 p-3">
            <code className="block break-all font-mono text-[11px] text-foreground">{link.url}</code>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button onClick={copy}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Avatar({ name }) {
  const initials = (name || '')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '·';
  return (
    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
      {initials}
    </div>
  );
}
