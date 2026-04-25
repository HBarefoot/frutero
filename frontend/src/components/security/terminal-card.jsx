import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { fetchAccessLogState, fetchTerminalStatus, setAccessLogState } from '@/lib/api';

// Browser terminal section. Embedded inside FleetCard (under the
// snapshot-forwarding row) so all "remote access to this Pi" controls
// — cloud's "Open Pi" link, snapshot forwarding, terminal — sit in one
// card. Visual style copies LocalUrlRow / ForwardingRow so the section
// looks consistent with its neighbors.
export function TerminalSection() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [accessLog, setAccessLog] = useState(null);
  const [accessLogBusy, setAccessLogBusy] = useState(false);

  async function load() {
    try {
      const [t, a] = await Promise.all([
        fetchTerminalStatus(),
        fetchAccessLogState().catch(() => ({ enabled: false })),
      ]);
      setStatus(t);
      setAccessLog(a);
    } catch (err) {
      toast.error(err);
    }
  }

  async function toggleAccessLog() {
    setAccessLogBusy(true);
    try {
      const next = !(accessLog?.enabled);
      const out = await setAccessLogState(next);
      setAccessLog(out);
      toast.success(next ? 'Access log on (check journalctl)' : 'Access log off');
    } catch (err) {
      toast.error(err);
    } finally {
      setAccessLogBusy(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  function copyPassword() {
    if (!status?.password) return;
    navigator.clipboard.writeText(status.password)
      .then(() => toast.success('Password copied to clipboard'))
      .catch((err) => toast.error(err));
  }

  if (!status) {
    return (
      <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Loading browser terminal status…
      </div>
    );
  }

  const ok = status.reachable && status.has_password;
  const url = `${status.url_path}`; // relative to current host

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-xs">
          <Terminal className={`size-3.5 ${ok ? 'text-success' : 'text-warning'}`} />
          Browser terminal
        </Label>
        <Badge variant={ok ? 'success' : 'warning'} className="uppercase">
          {ok ? 'ready' : status.has_password ? 'unreachable' : 'not installed'}
        </Badge>
      </div>

      {!ok && (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-2 text-[11px] text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
            <AlertTriangle className="size-3" />
            {status.has_password ? 'ttyd not reachable' : 'ttyd not installed'}
          </div>
          <p>
            Run <code className="font-mono text-foreground">./install.sh</code> on the Pi to
            install ttyd, generate the password, and start the
            <code className="ml-1 font-mono text-foreground">frutero-terminal</code> systemd unit.
          </p>
        </div>
      )}

      {status.has_password && (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Username</span>
            <code className="font-mono text-foreground">{status.username}</code>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Password</span>
            <div className="flex items-center gap-1">
              <code className="font-mono text-foreground">
                {showPassword ? status.password : '•'.repeat(Math.min(20, status.password?.length || 0))}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={copyPassword} aria-label="Copy password">
                <Copy className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {ok && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <ExternalLink className="size-3.5" />
          Open terminal in new tab
        </a>
      )}

      <p className="text-[11px] text-muted-foreground">
        ttyd binds to loopback only. The Express HTTPS proxy at
        <code className="ml-1 font-mono text-foreground">/terminal/</code>
        is the single auth + TLS surface — your Pi session cookie + the
        ttyd basic-auth credential above gate access.
      </p>

      {ok && (
        <p className="flex items-center gap-1 text-[11px] text-success">
          <CheckCircle2 className="size-3.5" />
          ttyd is up. Click the button to open a shell as <code className="font-mono">admin</code>.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs">
        <div>
          <div className="font-medium">Diagnostic access log</div>
          <div className="text-[11px] text-muted-foreground">
            Logs every non-poll request to journalctl. Use to investigate
            connection drops; turn off when done so the journal doesn't fill.
          </div>
        </div>
        <Button
          onClick={toggleAccessLog}
          disabled={accessLogBusy}
          size="sm"
          variant={accessLog?.enabled ? 'default' : 'outline'}
        >
          {accessLog?.enabled ? 'On' : 'Off'}
        </Button>
      </div>
    </div>
  );
}
