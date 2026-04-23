import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertCircle, KeyRound, LogIn } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { isAuthed, needsSetup, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (needsSetup) return <Navigate to="/setup" replace />;
  if (isAuthed) {
    const to = location.state?.from?.pathname || '/';
    return <Navigate to={to} replace />;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
    } catch (err) {
      const code = err?.response?.data?.error;
      setError(
        code === 'too_many_attempts'
          ? 'Too many failed attempts. Try again in 15 minutes.'
          : 'Invalid email or password.'
      );
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Enter your credentials to access the chamber."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          <LogIn />
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <KeyRound className="size-3" />
          Ask an owner for an invite link if you don't have an account.
        </p>
      </form>
    </AuthLayout>
  );
}
