import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  AlertCircle,
  Camera,
  Check,
  Cpu,
  HardDrive,
  RefreshCw,
  Sprout,
  Thermometer,
} from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PasswordStrength } from '@/components/auth/password-strength';
import { useAuth } from '@/lib/auth-context';
import { fetchSetupHardwareScan } from '@/lib/api';

export default function SetupPage() {
  const { needsSetup, isAuthed, setupOwner } = useAuth();
  const [step, setStep] = useState('scan'); // 'scan' | 'account'
  const [scan, setScan] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState(null);

  async function runScan() {
    setScanBusy(true);
    setScanError(null);
    try { setScan(await fetchSetupHardwareScan()); }
    catch (err) { setScanError(err?.response?.data?.error || err.message); }
    finally { setScanBusy(false); }
  }

  useEffect(() => { if (needsSetup && step === 'scan' && !scan) runScan(); }, [needsSetup, step]);

  if (!needsSetup) return <Navigate to={isAuthed ? '/' : '/login'} replace />;

  if (step === 'account') {
    return (
      <AccountStep
        onBack={() => setStep('scan')}
        setupOwner={setupOwner}
      />
    );
  }

  return (
    <AuthLayout
      title="Welcome to frutero"
      description="We scanned the hardware connected to this Pi. Review it, then create the owner account."
      footer={
        <span className="inline-flex items-center gap-1.5">
          <Sprout className="size-3 text-primary" />
          First-run setup · only visible until the first user is created
        </span>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Detected hardware</h3>
          <Button variant="outline" size="sm" onClick={runScan} disabled={scanBusy}>
            <RefreshCw className={scanBusy ? 'animate-spin' : ''} />
            Rescan
          </Button>
        </div>

        {scanError && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {scanError}
          </div>
        )}

        {scan?.stub && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Running in stub mode — real hardware scan is disabled. Nothing below is authoritative.
          </div>
        )}

        <ScanSummary scan={scan} busy={scanBusy} />

        <Button className="w-full" onClick={() => setStep('account')}>
          Continue — create owner account
        </Button>
      </div>
    </AuthLayout>
  );
}

function ScanSummary({ scan, busy }) {
  if (busy && !scan) {
    return (
      <div className="rounded-md border border-border bg-background/40 px-3 py-8 text-center text-sm text-muted-foreground">
        Scanning hardware…
      </div>
    );
  }
  if (!scan) return null;

  const gpioInUse = (scan.gpio?.pins || []).filter((p) => p.status === 'in-use');
  const i2cDevices = (scan.i2c?.buses || []).flatMap((b) => b.devices || []);
  const cameras = (scan.video?.devices || []).filter((d) => d.usable);
  const oneWire = scan.oneWire?.devices || [];

  return (
    <ul className="space-y-2">
      <SummaryRow
        icon={Cpu}
        label="GPIO actuators configured"
        detail={gpioInUse.length === 0 ? 'none yet' : gpioInUse.map((p) => `GPIO ${p.pin} · ${p.name}`).join(', ')}
        count={gpioInUse.length}
      />
      <SummaryRow
        icon={HardDrive}
        label="I²C devices detected"
        detail={
          i2cDevices.length === 0
            ? (scan.i2c?.buses?.some((b) => b.error) ? 'i2cdetect error — see Hardware page after setup' : 'none')
            : i2cDevices.map((d) => `${d.hex} (${d.candidates[0]})`).join(', ')
        }
        count={i2cDevices.length}
      />
      <SummaryRow
        icon={Camera}
        label="Usable cameras"
        detail={cameras.length === 0 ? 'plug in a USB camera to enable live feed' : cameras.map((c) => c.card || c.path).join(', ')}
        count={cameras.length}
      />
      <SummaryRow
        icon={Thermometer}
        label="1-Wire probes"
        detail={scan.oneWire?.enabled ? (oneWire.length === 0 ? 'enabled, no probes found' : oneWire.map((d) => d.id).join(', ')) : '1-Wire bus not enabled'}
        count={oneWire.length}
      />
    </ul>
  );
}

function SummaryRow({ icon: Icon, label, detail, count }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-sm text-foreground">{label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{detail}</div>
        </div>
      </div>
      <Badge variant={count > 0 ? 'success' : 'muted'} className="shrink-0">
        {count}
      </Badge>
    </li>
  );
}

function AccountStep({ onBack, setupOwner }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
      title="Create your owner account"
      description="You'll be able to invite teammates afterwards from the Team page."
      footer={
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          ← Back to hardware scan
        </button>
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
          <Check />
          {busy ? 'Creating account…' : 'Create owner account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
