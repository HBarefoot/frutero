import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertCircle, KeyRound, LogIn, Timer } from 'lucide-react';
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
  // Live countdown driven by the 429 retry_after_seconds payload. When
  // this ticks above 0, the form is disabled so the user isn't confused
  // about why their submit is being ignored.
  const [cooldownSec, setCooldownSec] = useState(0);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const t = setInterval(() => {
      setCooldownSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownSec]);

  if (needsSetup) return <Navigate to="/setup" replace />;
  if (isAuthed) {
    // Honor ?next= for cross-origin redirects (cloud "Open Terminal"
    // sends the operator through /login?next=/terminal/). location.state
    // is only set by in-app navigation, so it doesn't help when arriving
    // from a fresh tab.
    const params = new URLSearchParams(location.search);
    const next_ = params.get('next');
    const safeNext = next_ && next_.startsWith('/') && !next_.startsWith('//')
      ? next_
      : null;
    // /terminal is a backend-proxy route, not a SPA route — React
    // Router can't reach it. Force a full-page navigation so Express
    // gets the request and forwards to ttyd. Falls back to in-app
    // Navigate for SPA destinations.
    if (safeNext && safeNext.startsWith('/terminal')) {
      if (typeof window !== 'undefined') window.location.href = safeNext;
      return null;
    }
    const to = safeNext || location.state?.from?.pathname || '/';
    return <Navigate to={to} replace />;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (cooldownSec > 0) return;
    setBusy(true);
    setError(null);
    try {
      await login({ email: email.trim(), password });
    } catch (err) {
      const data = err?.response?.data;
      const code = data?.error;
      if (code === 'too_many_attempts' && data?.retry_after_seconds) {
        setCooldownSec(data.retry_after_seconds);
        setError(null);
      } else {
        setError('Invalid email or password.');
      }
      setBusy(false);
    }
  }

  const mm = Math.floor(cooldownSec / 60);
  const ss = String(cooldownSec % 60).padStart(2, '0');

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
            disabled={cooldownSec > 0}
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
            disabled={cooldownSec > 0}
          />
        </div>
        {cooldownSec > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <Timer className="size-3.5 shrink-0 mt-0.5" />
            <div>
              Too many failed attempts. Try again in{' '}
              <span className="font-mono tabular-nums">{mm}:{ss}</span>.
            </div>
          </div>
        )}
        {error && cooldownSec === 0 && (
          <p className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || cooldownSec > 0} className="w-full">
          <LogIn />
          {cooldownSec > 0
            ? `Locked · ${mm}:${ss}`
            : busy
              ? 'Signing in…'
              : 'Sign in'}
        </Button>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <KeyRound className="size-3" />
          Ask an owner for an invite link if you don't have an account.
        </p>
      </form>
    </AuthLayout>
  );
}
