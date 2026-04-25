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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardTitleGroup,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { fetchTerminalStatus } from '@/lib/api';

// Shows the browser-terminal status (ttyd reachable? password seeded?)
// and offers a one-click "Open" button + copy-to-clipboard for the
// password. Re-runs install.sh to rotate.
export function TerminalCard() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  async function load() {
    try {
      setStatus(await fetchTerminalStatus());
    } catch (err) {
      toast.error(err);
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
      <Card>
        <CardHeader>
          <CardTitleGroup>
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-muted-foreground" />
              <CardTitle>Browser terminal</CardTitle>
            </div>
            <CardDescription>Loading…</CardDescription>
          </CardTitleGroup>
        </CardHeader>
      </Card>
    );
  }

  const ok = status.reachable && status.has_password;
  const url = `${status.url_path}`; // relative to current host

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Terminal className={`size-4 ${ok ? 'text-success' : 'text-warning'}`} />
            <CardTitle>Browser terminal</CardTitle>
          </div>
          <CardDescription>
            ttyd on 127.0.0.1:{status.port} · proxied via /terminal/
          </CardDescription>
        </CardTitleGroup>
        <Badge variant={ok ? 'success' : 'warning'} className="uppercase">
          {ok ? 'ready' : status.has_password ? 'unreachable' : 'not installed'}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {!ok && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-warning">
              <AlertTriangle className="size-3.5" /> {status.has_password ? 'ttyd not reachable' : 'ttyd not installed'}
            </div>
            <p>
              Run <code className="font-mono text-foreground">./install.sh</code> on
              the Pi to download the ttyd binary, generate the password, and start
              the <code className="font-mono text-foreground">frutero-terminal</code> systemd unit.
            </p>
          </div>
        )}

        {status.has_password && (
          <div className="space-y-2 text-xs">
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
          is the single auth + TLS surface. Two layers gate access:
          your Pi session cookie + the ttyd basic-auth credential above.
        </p>

        {ok && (
          <p className="flex items-center gap-1 text-[11px] text-success">
            <CheckCircle2 className="size-3.5" />
            ttyd is up. Click the button above to open a shell as the{' '}
            <code className="font-mono">admin</code> user.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
