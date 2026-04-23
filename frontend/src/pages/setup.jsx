import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertCircle, Sprout } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';

export default function SetupPage() {
  const { needsSetup, isAuthed, setupOwner } = useAuth();
  const [form, setForm] = useState({ email: '', name: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!needsSetup) return <Navigate to={isAuthed ? '/' : '/login'} replace />;

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
      await setupOwner({
        email: form.email.trim(),
        name: form.name.trim(),
        password: form.password,
      });
    } catch (err) {
      const code = err?.response?.data?.error;
      setError(
        code === 'already_initialized'
          ? 'An owner already exists. Redirecting…'
          : code === 'invalid_email'
          ? 'Please enter a valid email.'
          : typeof code === 'string'
          ? code
          : 'Setup failed. Please try again.'
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome to frutero"
      description="Create the owner account for this controller. You'll be able to invite teammates afterwards."
      footer={
        <span className="inline-flex items-center gap-1.5">
          <Sprout className="size-3 text-primary" />
          First-run setup · only visible until the first user is created
        </span>
      }
    >
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
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
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
          <p className="mt-1 text-[11px] text-muted-foreground">
            Minimum 10 characters. Long passphrases are better than cryptic short ones.
          </p>
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
          {busy ? 'Creating account…' : 'Create owner account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
