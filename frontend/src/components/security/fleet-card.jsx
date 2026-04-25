import { useEffect, useState } from 'react';
import {
  Cloud,
  CloudOff,
  Loader2,
  Plug,
  RefreshCw,
  Send,
  Unplug,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  fetchFleetStatus,
  enrollFleet,
  fleetHeartbeatNow,
  disconnectFleet,
  resyncFleetBatches,
  setFleetLocalUrl,
  setFleetSnapshotForwarding,
} from '@/lib/api';
import { TerminalSection } from '@/components/security/terminal-card';
import { formatRelative } from '@/lib/format';

export function FleetCard() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ url: '', code: '', name: '' });

  async function load() {
    try {
      const s = await fetchFleetStatus();
      setStatus(s);
      // Pre-fill the URL field from the last connection so re-enrolling is faster.
      setForm((f) => ({ ...f, url: f.url || s.url || '' }));
    } catch (err) {
      toast.error(err);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function enroll() {
    setBusy(true);
    try {
      const out = await enrollFleet({
        url: form.url.trim(),
        code: form.code.trim(),
        name: form.name.trim() || null,
      });
      toast.success(`Enrolled as chamber #${out.chamber_id}`);
      setForm({ url: form.url, code: '', name: '' });
      setStatus(out.status);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function ping() {
    setBusy(true);
    try {
      const out = await fleetHeartbeatNow();
      setStatus(out.status);
      if (out.ok) toast.success('Heartbeat delivered');
      else toast.error(`Heartbeat failed: ${out.status?.last_error || out.error || 'unknown'}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function resync() {
    setBusy(true);
    try {
      const out = await resyncFleetBatches();
      const detail = out.failed > 0
        ? `Resynced ${out.succeeded}/${out.count} batches (${out.failed} failed)`
        : `Resynced ${out.count} batches in ${out.duration_ms}ms`;
      toast.success(detail);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect from the cloud control plane? The cloud will mark this chamber stale; re-enroll with a new code to reconnect.')) return;
    setBusy(true);
    try {
      const out = await disconnectFleet();
      setStatus(out.status);
      toast.success('Disconnected');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitleGroup>
            <div className="flex items-center gap-2">
              <Cloud className="size-4 text-muted-foreground" />
              <CardTitle>Fleet</CardTitle>
            </div>
            <CardDescription>Loading…</CardDescription>
          </CardTitleGroup>
        </CardHeader>
      </Card>
    );
  }

  const connected = status.connected;
  const lastErr = status.last_error;

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            {connected ? (
              <Cloud className="size-4 text-primary" />
            ) : (
              <CloudOff className="size-4 text-muted-foreground" />
            )}
            <CardTitle>Fleet</CardTitle>
            {connected ? (
              <Badge variant="success">Connected</Badge>
            ) : (
              <Badge variant="muted">Not connected</Badge>
            )}
          </div>
          <CardDescription>
            Outbound-only heartbeat to the frutero-fleet cloud control plane.
            Posts a state snapshot every {status.interval_seconds}s.
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>

      <CardContent className="space-y-4">
        {connected ? (
          <>
            <div className="space-y-1 text-sm">
              <Row label="Cloud URL" value={status.url} />
              <Row label="Chamber" value={`#${status.chamber_id} · ${status.name || '—'}`} />
              <Row
                label="Last heartbeat"
                value={
                  status.last_heartbeat_at
                    ? `${formatRelative(status.last_heartbeat_at)} (HTTP ${status.last_status ?? '—'})`
                    : 'pending first beat'
                }
              />
              {lastErr && (
                <Row label="Last error" value={lastErr} valueClass="text-danger" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={ping} disabled={busy} size="sm" variant="outline">
                {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Send className="mr-1 size-3.5" />}
                Send heartbeat now
              </Button>
              <Button onClick={resync} disabled={busy} size="sm" variant="outline">
                <RefreshCw className="mr-1 size-3.5" /> Resync batches
              </Button>
              <Button onClick={disconnect} disabled={busy} size="sm" variant="outline">
                <Unplug className="mr-1 size-3.5" /> Disconnect
              </Button>
            </div>
            <LocalUrlRow
              status={status}
              onSaved={(s) => setStatus(s)}
              busy={busy}
              setBusy={setBusy}
            />
            <ForwardingRow
              status={status}
              onSaved={(s) => setStatus(s)}
              busy={busy}
              setBusy={setBusy}
            />
            <TerminalSection />
          </>
        ) : (
          <>
            {lastErr === 'revoked_by_cloud' && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                The cloud revoked this chamber's credentials (likely archived
                from the fleet dashboard). Generate a new enrollment code there
                and paste it below to re-connect.
              </p>
            )}
            <div className="space-y-3">
              <div>
                <Label htmlFor="fleet-url" className="text-xs">Cloud URL</Label>
                <Input
                  id="fleet-url"
                  type="url"
                  placeholder="https://fleet.example.com"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="fleet-code" className="text-xs">Enrollment code</Label>
                <Input
                  id="fleet-code"
                  placeholder="paste from fleet dashboard"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="mt-1 font-mono"
                />
              </div>
              <div>
                <Label htmlFor="fleet-name" className="text-xs">Chamber name (optional)</Label>
                <Input
                  id="fleet-name"
                  placeholder="kitchen pi"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1"
                />
              </div>
              <Button
                onClick={enroll}
                disabled={busy || !form.url.trim() || !form.code.trim()}
                size="sm"
              >
                {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Plug className="mr-1 size-3.5" />}
                Enroll this Pi
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, valueClass = '' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`truncate text-right font-mono text-xs ${valueClass}`}>{value}</span>
    </div>
  );
}

// Inline row: shows every detected candidate URL (Cloudflare / Tailscale
// / ngrok / LAN) as a clickable chip; one click sets that URL as the
// active override. Free-text override stays as a fallback for anything
// we couldn't auto-detect (dyndns, custom DNS, etc.). Reset clears the
// override so auto-pick chooses the highest-priority candidate.
function LocalUrlRow({ status, onSaved, busy, setBusy }) {
  const toast = useToast();
  const lu = status.local_url || {};
  const candidates = Array.isArray(lu.candidates) ? lu.candidates : [];
  const [draft, setDraft] = useState(lu.override || '');

  useEffect(() => {
    setDraft(lu.override || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lu.override]);

  async function save(rawValue) {
    setBusy(true);
    try {
      const val = (rawValue == null ? draft : rawValue).trim() || null;
      const out = await setFleetLocalUrl(val);
      onSaved(out.status);
      toast.success(
        val
          ? `Cloud will link to ${val}`
          : 'Override cleared — auto-pick re-enabled'
      );
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const dirty = (draft || '') !== (lu.override || '');

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Cloud's "Open Pi" link</Label>
        <span className="font-mono text-[11px] text-muted-foreground">
          {lu.effective || 'unavailable'}
        </span>
      </div>

      {candidates.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Detected
          </div>
          <div className="flex flex-wrap gap-1.5">
            {candidates.map((c) => {
              const active = c.url === lu.effective;
              return (
                <button
                  key={c.kind}
                  type="button"
                  onClick={() => save(c.url)}
                  disabled={busy}
                  title={c.url}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-60 ${
                    active
                      ? 'border-primary/60 bg-primary/15 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:border-foreground/40'
                  }`}
                >
                  <span className="font-medium">{c.label}</span>
                  <span className="font-mono text-[10px] opacity-80">{summarizeUrl(c.url)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="fleet-local-url" className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Custom override
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="fleet-local-url"
            type="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://chamber-1.example.com"
            className="flex-1 font-mono text-xs"
          />
          <Button onClick={() => save()} disabled={busy || !dirty} size="sm" variant="outline">
            Save
          </Button>
          {lu.override && (
            <Button onClick={() => save('')} disabled={busy} size="sm" variant="ghost">
              Reset
            </Button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Priority when no override: Cloudflare → Tailscale → ngrok → LAN.
        Cloudflare resolves publicly; Tailscale only for tailnet members;
        ngrok URLs change on restart; LAN is same-network only.
      </p>
    </div>
  );
}

function summarizeUrl(url) {
  try { return new URL(url).host; }
  catch { return url.replace(/^https?:\/\//, '').slice(0, 40); }
}

// Inline row: configures the "every Nth scheduled CV capture" forwarding
// cadence. 0 = off. Only visible when fleet is connected.
function ForwardingRow({ status, onSaved, busy, setBusy }) {
  const toast = useToast();
  const current = status.snapshot_forward_every_n ?? 0;
  const [draft, setDraft] = useState(String(current));

  // Sync local draft when the polled status advances (e.g. another tab
  // changed the setting). Don't clobber an in-progress edit.
  useEffect(() => {
    setDraft(String(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  async function save() {
    const n = parseInt(draft, 10);
    if (!Number.isInteger(n) || n < 0) {
      toast.error('Every-N must be a non-negative integer (0 disables).');
      return;
    }
    setBusy(true);
    try {
      const out = await setFleetSnapshotForwarding(n);
      onSaved(out.status);
      toast.success(n === 0 ? 'Snapshot forwarding disabled' : `Forwarding every ${n}th scheduled snapshot`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const dirty = String(current) !== String(parseInt(draft, 10) || 0);

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="fleet-forward-n" className="text-xs">
          Auto-forward every Nth scheduled snapshot
        </Label>
        <span className="text-[11px] text-muted-foreground">
          {current === 0 ? 'disabled' : `every ${current}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id="fleet-forward-n"
          type="number"
          min="0"
          step="1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-24 font-mono"
        />
        <Button onClick={save} disabled={busy || !dirty} size="sm" variant="outline">
          Save
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        0 disables. At the default CV cadence (10 min), N=6 forwards one image per hour.
        Cloud operators can still request an on-demand snapshot anytime.
      </p>
    </div>
  );
}
