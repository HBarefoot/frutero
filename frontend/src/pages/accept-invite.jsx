import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AlertCircle, Mail, UserPlus } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PasswordStrength } from '@/components/auth/password-strength';
import { useAuth } from '@/lib/auth-context';
import { inspectInvite } from '@/lib/api';

export default function AcceptInvitePage() {
  const { token } = useParams();
  const { isAuthed, acceptInvite } = useAuth();
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ name: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    inspectInvite(token)
      .then(setInvite)
      .catch((err) => {
        const code = err?.response?.data?.error;
        setLoadError(code || 'invalid_or_expired');
      });
  }, [token]);

  if (isAuthed) return <Navigate to="/" replace />;

  if (loadError) {
    return (
      <AuthLayout title="Invite unavailable">
        <p className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          This invite link is invalid or has expired. Ask an owner to send a new one.
        </p>
      </AuthLayout>
    );
  }

  if (!invite) {
    return <AuthLayout title="Loading invite…">&nbsp;</AuthLayout>;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    setBusy(true);
    try {
      await acceptInvite(token, { name: form.name.trim(), password: form.password });
    } catch (err) {
      const code = err?.response?.data?.error;
      setError(
        code === 'email_exists'
          ? 'An account already exists for this email.'
          : code === 'invalid_or_expired'
          ? 'Invite expired while you were filling out the form.'
          : 'Could not accept the invite. Try again.'
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Join the chamber"
      description="Finish creating your account to accept this invitation."
    >
      <div className="mb-4 flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Mail className="size-3.5" />
          {invite.email}
        </span>
        <Badge variant="muted" className="uppercase">
          {invite.role}
        </Badge>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input
            id="name"
            autoComplete="name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="mt-1.5"
          />
          <PasswordStrength password={form.password} className="mt-2" />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            className="mt-1.5"
          />
        </div>
        {error && (
          <p className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          <UserPlus />
          {busy ? 'Creating…' : 'Create my account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
