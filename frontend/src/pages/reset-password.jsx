import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, KeyRound, Mail } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';
import { inspectReset, submitReset } from '@/lib/api';

export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isAuthed, refresh } = useAuth();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    inspectReset(token)
      .then(setInfo)
      .catch((err) => setLoadError(err?.response?.data?.error || 'invalid_or_expired'));
  }, [token]);

  if (isAuthed && !busy) return <Navigate to="/" replace />;

  if (loadError) {
    return (
      <AuthLayout title="Reset link unavailable">
        <p className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          This password-reset link is invalid or has expired. Ask an owner to issue a new one.
        </p>
      </AuthLayout>
    );
  }

  if (!info) {
    return <AuthLayout title="Loading reset link…">&nbsp;</AuthLayout>;
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
      await submitReset(token, form.password);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      const code = err?.response?.data?.error;
      setError(
        code === 'invalid_or_expired'
          ? 'Reset expired while you were filling out the form.'
          : typeof code === 'string'
          ? code
          : 'Could not reset the password. Try again.'
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Set a new password"
      description="Someone with owner access issued you a password reset link."
    >
      <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        <Mail className="size-3.5" />
        {info.email}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="rp-password">New password</Label>
          <Input
            id="rp-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="mt-1.5"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Minimum 10 characters.</p>
        </div>
        <div>
          <Label htmlFor="rp-confirm">Confirm password</Label>
          <Input
            id="rp-confirm"
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
          <KeyRound />
          {busy ? 'Setting password…' : 'Set password and sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
