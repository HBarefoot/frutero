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
  const [step, setStep] = useState('scan'); // 'scan' | 'account' | 'restore'
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

  if (step === 'restore') {
    return <RestoreStep onBack={() => setStep('scan')} />;
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

        <div className="space-y-2">
          <Button className="w-full" onClick={() => setStep('account')}>
            Continue — create owner account
          </Button>
          <Button variant="outline" className="w-full" onClick={() => setStep('restore')}>
            Restore from backup instead
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}

function RestoreStep({ onBack }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('backup', file);
      const res = await fetch('/api/setup/restore', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setDone(true);
      // Backend crashes intentionally to reload the restored DB; give
      // systemd ~4s to bring us back before we reload.
      setTimeout(() => window.location.assign('/'), 4000);
    } catch (err) {
      setError(err.message || 'Restore failed');
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthLayout title="Restoring…" description="Backend is restarting into the restored database.">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="size-5 animate-spin text-primary" />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Reloading in a few seconds…
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Restore from backup"
      description="Upload a .db file exported from another frutero installation."
      footer={
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          ← Back
        </button>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="backup-file">Backup file (.db)</Label>
          <Input
            id="backup-file"
            type="file"
            accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/x-sqlite3"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="mt-1.5"
            required
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Downloaded from another frutero's Security page. Users, schedules,
            actuators, settings, readings, and audit log will all be restored.
          </p>
        </div>
        {error && (
          <p className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !file} className="w-full">
          <HardDrive />
          {busy ? 'Validating + restoring…' : 'Restore this backup'}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          The current empty database will be kept as{' '}
          <code className="font-mono">mushroom.db.pre-restore-*.bak</code> on disk.
          Restore is only available during first-run setup — to roll back later,
          stop the service and swap the file manually.
        </p>
      </form>
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
