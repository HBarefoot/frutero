import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bug,
  CheckCircle2,
  Download,
  FileText,
  HardDrive,
  KeyRound,
  Lock,
  LockOpen,
  RefreshCw,
  Shield,
  ShieldCheck,
  Timer,
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
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import { NotificationsCard } from '@/components/security/notifications-card';
import { FleetCard } from '@/components/security/fleet-card';
import { TerminalCard } from '@/components/security/terminal-card';
import { fetchSecurityPosture, fetchRecentClientErrors } from '@/lib/api';
import { formatRelative, formatDateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

export default function SecurityPage() {
  const { can } = useAuth();
  const isOwner = can('admin');
  const [data, setData] = useState(null);
  const [errors, setErrors] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const [posture, ce] = await Promise.all([
        fetchSecurityPosture(),
        fetchRecentClientErrors(20).catch(() => ({ entries: [], count_24h: 0 })),
      ]);
      setData(posture);
      setErrors(ce);
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  if (!isOwner) {
    return (
      <>
        <PageHeader title="Security" description="Owner-only" />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Only the chamber owner can view the security posture.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Security"
        description="Live posture: TLS, headers, hash-at-rest, rate limits, active sessions"
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || busy}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {!data ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading posture…
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TlsCard tls={data.tls} />
          <HeadersCard headers={data.headers} tlsActive={data.tls.active} />
          <TokensCard tokens={data.tokens_at_rest} />
          <BackupCard backup={data.backup} />
          <LogsCard logs={data.logs} />
          <ThrottlesCard throttles={data.throttles} />
          <NotificationsCard />
          <FleetCard />
          <TerminalCard />
          <SessionsCard sessions={data.sessions} className="xl:col-span-2" />
          <ClientErrorsCard errors={errors} className="xl:col-span-2" />
        </div>
      )}
    </>
  );
}

// ---------- TLS ----------

function TlsCard({ tls }) {
  const active = !!tls.active;
  const Icon = active ? Lock : LockOpen;
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Icon className={cn('size-4', active ? 'text-success' : 'text-warning')} />
            <CardTitle>Transport</CardTitle>
          </div>
          <CardDescription>
            {active ? `HTTPS on :${tls.https_port}` : `HTTP on :${tls.http_port}`}
          </CardDescription>
        </CardTitleGroup>
        <Badge variant={active ? 'success' : 'warning'} className="uppercase">
          {active ? 'TLS live' : 'HTTP only'}
        </Badge>
      </CardHeader>
      <CardContent>
        {active ? (
          <dl className="space-y-2 text-xs">
            <Row label="Cert path" value={<code className="font-mono">{tls.cert_path}</code>} />
            <Row label="Key path" value={<code className="font-mono">{tls.key_path}</code>} />
            <Row label="HTTP redirect" value={<>:{tls.http_port} → :{tls.https_port}</>} />
          </dl>
        ) : (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
              <AlertTriangle className="size-3.5" /> HTTPS not configured
            </div>
            <p className="text-muted-foreground">
              Run <code className="font-mono text-foreground">./install.sh</code> on the
              Pi to generate a self-signed cert and enable HTTPS on port {tls.https_port}.
              The HTTP port will then 301-redirect.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Headers ----------

function HeadersCard({ headers, tlsActive }) {
  const items = [
    ['Content-Security-Policy', headers.content_security_policy],
    ['X-Frame-Options', headers.x_frame_options],
    ['X-Content-Type-Options', headers.x_content_type_options],
    ['Referrer-Policy', headers.referrer_policy],
    ['Strict-Transport-Security', headers.hsts],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-muted-foreground" />
            <CardTitle>Security headers</CardTitle>
          </div>
          <CardDescription>
            {items.filter(([, on]) => on).length} / {items.length} enabled
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-1.5 text-xs">
          {items.map(([name, on]) => (
            <li key={name} className="flex items-center justify-between">
              <span className="font-mono">{name}</span>
              {on ? (
                <Badge variant="success"><CheckCircle2 className="size-3" />on</Badge>
              ) : (
                <Badge variant="muted" title={name === 'Strict-Transport-Security' ? 'Only emits when TLS is live' : ''}>
                  off
                </Badge>
              )}
            </li>
          ))}
        </ul>
        {!tlsActive && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            HSTS intentionally disabled until TLS is active. Enabling it over plain HTTP
            would trap clients if the cert is ever removed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Tokens ----------

function TokensCard({ tokens }) {
  const ok = tokens.fully_hashed;
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            <CardTitle>Tokens at rest</CardTitle>
          </div>
          <CardDescription>Invites + password resets</CardDescription>
        </CardTitleGroup>
        <Badge variant={ok ? 'success' : 'warning'} className="uppercase">
          {ok ? 'hashed' : 'legacy'}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0">
        <dl className="space-y-2 text-xs">
          <Row label="Legacy plaintext invites" value={tokens.invites_plaintext} />
          <Row label="Legacy plaintext resets" value={tokens.password_resets_plaintext} />
        </dl>
        {ok ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-success">
            <ShieldCheck className="size-3.5" />
            All pending tokens stored as HMAC-SHA256. Plaintext is returned to the
            owner exactly once on creation and never hits the DB.
          </p>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Migration runs on every backend boot. Legacy rows will be hashed on next restart.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Throttles ----------

function ThrottlesCard({ throttles }) {
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Timer className="size-4 text-muted-foreground" />
            <CardTitle>Rate limits</CardTitle>
          </div>
          <CardDescription>Per-IP sliding throttles · reset on restart</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y divide-border">
          {Object.entries(throttles).map(([name, t]) => {
            const active = t.offenders.filter((o) => o.throttled).length;
            return (
              <li key={name} className="py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{name.replace('_', ' ')}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {t.threshold} fails / {Math.round(t.window_seconds / 60)}m window
                  </span>
                </div>
                {t.offenders.length > 0 && (
                  <ul className="mt-1 space-y-0.5 rounded-md bg-background/40 px-2 py-1">
                    {t.offenders.map((o) => (
                      <li key={o.key} className="flex items-center justify-between text-[11px]">
                        <span className="font-mono text-muted-foreground">{o.key}</span>
                        <span>
                          {o.count} fails{' '}
                          {o.throttled && (
                            <Badge variant="warning" className="ml-1">
                              locked {Math.ceil(o.retry_after_seconds / 60)}m
                            </Badge>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {t.offenders.length === 0 && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">No recent failures.</div>
                )}
                {active > 0 && (
                  <div className="mt-1 text-[11px] text-warning">
                    {active} IP{active === 1 ? '' : 's'} currently locked out.
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------- Sessions ----------

function SessionsCard({ sessions, className }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" />
            <CardTitle>Active sessions</CardTitle>
          </div>
          <CardDescription>{sessions.length} across all users</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {sessions.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No active sessions.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((s) => (
              <li
                key={s.token_preview + s.user_id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.user_name || s.user_email}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {s.user_role}
                    </Badge>
                    <span className="font-mono text-muted-foreground">
                      {s.user_agent?.summary || 'unknown'}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {s.ip || '—'} · token {s.token_preview}… · seen{' '}
                    {formatRelative(s.last_seen_at)}
                  </div>
                </div>
                <div className="shrink-0 text-[11px] text-muted-foreground">
                  expires {formatDateTime(s.expires_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Backup ----------

function BackupCard({ backup }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const last = backup?.last_backup_at;
  const bytes = backup?.last_backup_bytes || 0;

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/security/backup', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const match = /filename="([^"]+)"/.exec(cd);
      const name = match ? match[1] : `frutero-backup-${Date.now()}.db`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Backup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            <CardTitle>Backup</CardTitle>
          </div>
          <CardDescription>SQLite snapshot — safe while running</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent>
        <Button onClick={download} disabled={busy} variant="default" size="sm" className="w-full">
          <Download />
          {busy ? 'Preparing…' : 'Download backup'}
        </Button>
        <dl className="mt-3 space-y-1 text-[11px]">
          <Row
            label="Last download"
            value={last ? formatRelative(last) : <span className="text-muted-foreground">never</span>}
          />
          {bytes > 0 && (
            <Row label="Size" value={formatBytes(bytes)} />
          )}
        </dl>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Restore from a backup using the setup wizard on a fresh install.
          Keep copies off-Pi — SD card death is the #1 appliance failure mode.
        </p>
        {error && (
          <div className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(n) {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// ---------- Logs ----------

// Convert a journald SystemMaxUse value like "500M" into bytes. The
// backend gives us the raw string so we can render it verbatim when
// parsing isn't confident.
function parseJournalSize(raw) {
  if (!raw) return null;
  const m = /^(\d+(?:\.\d+)?)([KMGT]?)$/i.exec(raw);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[unit] || 1;
  return Math.round(n * mult);
}

function LogsCard({ logs }) {
  const used = logs?.disk_usage_bytes;
  const maxRaw = logs?.max_size_raw;
  const retRaw = logs?.retention_raw;
  const maxBytes = parseJournalSize(maxRaw);
  const percent = used != null && maxBytes ? Math.min(100, (used / maxBytes) * 100) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <CardTitle>Logs</CardTitle>
          </div>
          <CardDescription>
            {used == null ? 'journald disk usage unavailable' : `${formatBytes(used)} on disk`}
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent>
        {used != null && maxBytes && (
          <div className="mb-3 space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full transition-all',
                  percent > 80 ? 'bg-warning' : 'bg-primary'
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>{formatBytes(used)}</span>
              <span>{maxRaw} cap</span>
            </div>
          </div>
        )}
        <dl className="space-y-1 text-[11px]">
          <Row label="Max size" value={<code className="font-mono">{maxRaw || 'system default'}</code>} />
          <Row label="Retention" value={<code className="font-mono">{retRaw || 'system default'}</code>} />
        </dl>
        {!maxRaw && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            No frutero drop-in detected at{' '}
            <code className="font-mono text-foreground">/etc/systemd/journald.conf.d/frutero.conf</code>.
            Run <code className="font-mono text-foreground">./install.sh</code> to apply 500M / 30d limits.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Client errors ----------

function ClientErrorsCard({ errors, className }) {
  const entries = errors?.entries || [];
  const count24 = errors?.count_24h ?? 0;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Bug className="size-4 text-muted-foreground" />
            <CardTitle>Client render errors</CardTitle>
          </div>
          <CardDescription>
            {count24} in last 24h · {entries.length} shown
          </CardDescription>
        </CardTitleGroup>
        {count24 === 0 && (
          <Badge variant="success" className="uppercase">
            <CheckCircle2 className="size-3" />
            clean
          </Badge>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {entries.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No frontend render errors reported.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((e) => (
              <li key={e.id} className="py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {e.scope || 'page'}
                  </Badge>
                  <span className="font-mono text-muted-foreground">{e.path || '—'}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatRelative(e.timestamp)}
                  </span>
                  {(e.user_name || e.user_email) && (
                    <span className="text-[11px] text-muted-foreground">
                      · {e.user_name || e.user_email}
                    </span>
                  )}
                </div>
                <div className="mt-1 break-words font-mono text-danger">{e.message}</div>
                {e.stack && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                      Stack trace
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/40 p-2 font-mono text-[10px] text-muted-foreground">
                      {e.stack}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- helpers ----------

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}
