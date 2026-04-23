import { useEffect, useState } from 'react';
import { AlertTriangle, Menu, Wifi, WifiOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserMenu } from '@/components/layout/user-menu';
import { useStatus } from '@/lib/status-context';
import { formatUptime } from '@/lib/format';
import { cn } from '@/lib/cn';

export function Topbar({ onOpenNav }) {
  const { wsStatus, status, recentAlert, dismissRecentAlert } = useStatus();
  const [tickUptime, setTickUptime] = useState(status?.uptime);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setTickUptime(status?.uptime);
  }, [status?.uptime]);

  useEffect(() => {
    const i = setInterval(() => {
      setNow(new Date());
      setTickUptime((u) => (u != null ? u + 1 : u));
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const connected = wsStatus === 'connected';

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={onOpenNav}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-foreground">
              Chamber&nbsp;1
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {status?.sensor?.simulated ? 'Simulated sensor · ' : ''}
              Uptime {formatUptime(tickUptime)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionPill connected={connected} />
          <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <UserMenu />
        </div>
      </div>

      {recentAlert && (
        <AlertBanner message={recentAlert.message} onDismiss={dismissRecentAlert} />
      )}
    </div>
  );
}

function ConnectionPill({ connected }) {
  const Icon = connected ? Wifi : WifiOff;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        connected
          ? 'border-transparent bg-success/10 text-success'
          : 'border-transparent bg-danger/10 text-danger animate-pulse-dot'
      )}
    >
      <Icon className="size-3.5" />
      <span className="hidden sm:inline">{connected ? 'Live' : 'Reconnecting'}</span>
    </span>
  );
}

function AlertBanner({ message, onDismiss }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger sm:px-6">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4" />
        <span>{message}</span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onDismiss}
        aria-label="Dismiss alert"
        className="text-danger hover:bg-danger/20 hover:text-danger"
      >
        <X />
      </Button>
    </div>
  );
}
