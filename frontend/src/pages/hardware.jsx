import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Cable,
  Camera,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Thermometer,
  Trash2,
  Usb,
  Zap,
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
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { PageHeader } from '@/components/layout/page-header';
import {
  createActuator,
  deleteActuator,
  fetchActuators,
  fetchHardwareScan,
  fetchHostStats,
  pulseActuator,
  updateActuator,
} from '@/lib/api';
import { useStatus } from '@/lib/status-context';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

const KIND_OPTIONS = ['fan', 'light', 'mister', 'pump', 'heater', 'humidifier', 'other'];

export default function HardwarePage() {
  const { can } = useAuth();
  const { refresh: refreshStatus } = useStatus();
  const [scan, setScan] = useState(null);
  const [actuators, setActuators] = useState([]);
  const [host, setHost] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | actuator key
  const isOwner = can('admin');

  async function reload() {
    try {
      const list = await fetchActuators();
      setActuators(list);
    } catch (err) {
      console.error('hardware actuators reload failed', err);
    }
    try {
      const s = await fetchHardwareScan();
      setScan(s);
    } catch (err) {
      // Keep the previous scan on transient failure so the GPIO map doesn't
      // blank out between CRUD operations.
      console.error('hardware scan reload failed', err);
    }
  }

  async function rescan() {
    setScanBusy(true);
    try {
      setScan(await fetchHardwareScan());
    } finally {
      setScanBusy(false);
    }
  }

  useEffect(() => { reload(); }, []);

  // Poll the Pi host stats every 5s so thermal/load/disk numbers feel
  // live without being too chatty (each poll shells out to
  // vcgencmd/df/etc. — keep interval comfortable).
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchHostStats()
        .then((h) => { if (alive) setHost(h); })
        .catch(() => { /* non-fatal — card hides when host is null */ });
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!isOwner) {
    return (
      <>
        <PageHeader title="Hardware" description="Owner-only" />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Only the chamber owner can view hardware configuration.
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Hardware"
        description="Detect connected sensors, manage GPIO actuators, and test wiring"
        actions={
          <div className="flex items-center gap-2">
            {scan?.platform && <PlatformPill platform={scan.platform} />}
            <Button variant="outline" size="sm" onClick={rescan} disabled={scanBusy}>
              <RefreshCw className={cn(scanBusy && 'animate-spin')} />
              Rescan
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <ActuatorsCard
            actuators={actuators}
            gpioAvailable={scan?.gpio?.available !== false}
            onEdit={setEditing}
            onDelete={async (key) => {
              if (!confirm(`Delete actuator '${key}'? Schedules referencing it must be removed first.`)) return;
              try {
                await deleteActuator(key);
                await reload();
                refreshStatus();
              } catch (err) {
                alert(errMsg(err));
              }
            }}
            onTest={async (key) => {
              try {
                await pulseActuator(key, 1000);
              } catch (err) {
                alert(errMsg(err));
              }
            }}
            onAdd={() => setEditing('new')}
          />

          <GpioMapCard scan={scan} />
        </div>

        <div className="space-y-6">
          <HostHealthCard host={host} />
          <I2CCard scan={scan} />
          <SensorsCard scan={scan} />
          <VideoCard scan={scan} />
          <UsbCard scan={scan} />
          <SerialCard scan={scan} />
        </div>
      </div>

      {editing && (
        <ActuatorDialog
          mode={editing === 'new' ? 'create' : 'edit'}
          existing={editing === 'new' ? null : actuators.find((a) => a.key === editing)}
          gpioPins={scan?.gpio?.pins || []}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
            refreshStatus();
          }}
        />
      )}
    </>
  );
}

function errMsg(err) {
  return err?.response?.data?.error || err?.message || 'Request failed';
}

// --- Actuators table -------------------------------------------------

function ActuatorsCard({ actuators, gpioAvailable = true, onEdit, onDelete, onTest, onAdd }) {
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-muted-foreground" />
            <CardTitle>Actuators</CardTitle>
          </div>
          <CardDescription>Relay channels mapped to GPIO pins · {actuators.length} configured</CardDescription>
        </CardTitleGroup>
        <Button
          size="sm"
          onClick={onAdd}
          disabled={!gpioAvailable}
          title={gpioAvailable ? undefined : 'GPIO not available on this host'}
        >
          <Plus />
          Add actuator
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {actuators.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No actuators yet. Add one to map a GPIO pin to a relay channel.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {actuators.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{a.name}</span>
                    <Badge variant="muted" className="font-mono uppercase">
                      {a.key}
                    </Badge>
                    <Badge variant="outline">{a.kind}</Badge>
                    {!a.enabled && <Badge variant="warning">disabled</Badge>}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    GPIO {a.gpio_pin}
                    {a.inverted && ' · NC wiring'}
                    {a.auto_off_seconds != null && ` · auto-off ${a.auto_off_seconds}s`}
                    {' · '}
                    <Badge variant={a.state ? 'success' : 'muted'} className="ml-1">
                      <Power className="size-3" />
                      {a.state ? 'ON' : 'OFF'}
                    </Badge>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => onTest(a.key)}>
                    Pulse 1s
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => onEdit(a.key)} aria-label="Edit">
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDelete(a.key)}
                    aria-label="Delete"
                    className="text-muted-foreground hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// --- Add/edit dialog -------------------------------------------------

function ActuatorDialog({ mode, existing, gpioPins, onClose, onSaved }) {
  const [form, setForm] = useState(() =>
    existing
      ? {
          key: existing.key,
          name: existing.name,
          kind: existing.kind,
          gpio_pin: String(existing.gpio_pin),
          inverted: !!existing.inverted,
          enabled: !!existing.enabled,
          auto_off_seconds: existing.auto_off_seconds == null ? '' : String(existing.auto_off_seconds),
        }
      : {
          key: '',
          name: '',
          kind: 'mister',
          gpio_pin: '',
          inverted: false,
          enabled: true,
          auto_off_seconds: '',
        }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Pin choices: only free pins, plus the one currently held by this actuator (in edit mode).
  const pinOptions = useMemo(() => {
    const free = gpioPins.filter((p) => p.status === 'free').map((p) => p.pin);
    const all = existing && !free.includes(Number(existing.gpio_pin))
      ? [...free, Number(existing.gpio_pin)]
      : free;
    return [...all].sort((a, b) => a - b);
  }, [gpioPins, existing]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        kind: form.kind,
        gpio_pin: parseInt(form.gpio_pin, 10),
        inverted: form.inverted,
        enabled: form.enabled,
        auto_off_seconds: form.auto_off_seconds === '' ? null : parseInt(form.auto_off_seconds, 10),
      };
      if (mode === 'create') {
        payload.key = form.key.trim();
        await createActuator(payload);
      } else {
        await updateActuator(existing.key, payload);
      }
      await onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitleGroup>
            <CardTitle>{mode === 'create' ? 'Add actuator' : `Edit '${existing.key}'`}</CardTitle>
            <CardDescription>
              Maps a GPIO pin to a named relay channel that schedules and automations can control.
            </CardDescription>
          </CardTitleGroup>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="act-key">Key</Label>
                <Input
                  id="act-key"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })}
                  placeholder="mister"
                  pattern="[a-z][a-z0-9_]{1,31}"
                  required
                  disabled={mode === 'edit'}
                  className="mt-1.5 font-mono"
                />
              </div>
              <div>
                <Label htmlFor="act-name">Name</Label>
                <Input
                  id="act-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Mister"
                  required
                  className="mt-1.5"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="act-kind">Kind</Label>
                <SelectNative
                  id="act-kind"
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  className="mt-1.5"
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </SelectNative>
              </div>
              <div>
                <Label htmlFor="act-pin">GPIO pin (BCM)</Label>
                <SelectNative
                  id="act-pin"
                  value={form.gpio_pin}
                  onChange={(e) => setForm({ ...form, gpio_pin: e.target.value })}
                  required
                  className="mt-1.5"
                >
                  <option value="">— select —</option>
                  {pinOptions.map((p) => (
                    <option key={p} value={p}>GPIO {p}</option>
                  ))}
                </SelectNative>
              </div>
            </div>

            <div>
              <Label htmlFor="act-auto-off">Auto-off after (sec)</Label>
              <Input
                id="act-auto-off"
                type="number"
                min="1"
                placeholder="blank = latching"
                value={form.auto_off_seconds}
                onChange={(e) => setForm({ ...form, auto_off_seconds: e.target.value })}
                className="mt-1.5"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                For pulse-style devices like fans and misters. Leave blank for latching (lights, heaters).
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
              <div>
                <div className="text-sm">NC wiring (inverted)</div>
                <p className="text-[11px] text-muted-foreground">
                  Enable if AC line is wired through the relay's normally-closed contact.
                </p>
              </div>
              <Switch checked={form.inverted} onCheckedChange={(v) => setForm({ ...form, inverted: v })} />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
              <div>
                <div className="text-sm">Enabled</div>
                <p className="text-[11px] text-muted-foreground">Disabled actuators are hidden from the dashboard.</p>
              </div>
              <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            </div>

            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : mode === 'create' ? 'Add actuator' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// --- GPIO map --------------------------------------------------------

function GpioMapCard({ scan }) {
  const gpio = scan?.gpio;
  const pins = gpio?.pins || [];
  const unavailable = gpio?.available === false;
  const reasonOnly = gpio?.available === true && pins.length === 0 && (gpio.reason || gpio.chips?.length);
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Cpu className="size-4 text-muted-foreground" />
            <CardTitle>GPIO map</CardTitle>
          </div>
          <CardDescription>
            BCM pin allocation
            {gpio?.mock && <span className="ml-2 text-warning">(mock mode)</span>}
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {unavailable ? (
          <Empty text={gpio?.reason || 'GPIO not available on this host.'} />
        ) : reasonOnly ? (
          <div className="space-y-2 text-xs text-muted-foreground">
            {gpio.reason && <p>{gpio.reason}</p>}
            {gpio.chips?.length > 0 && (
              <ul className="space-y-1">
                {gpio.chips.map((c) => (
                  <li
                    key={c.path}
                    className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2 font-mono"
                  >
                    <span>{c.path}</span>
                    <span className="text-muted-foreground">
                      {c.label || 'gpiochip'}{c.lines != null ? ` · ${c.lines} lines` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : pins.length === 0 ? (
          <Loading />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {pins.map((p) => (
              <div
                key={p.pin}
                className={cn(
                  'rounded-md border px-3 py-2 text-xs',
                  p.status === 'in-use' && 'border-success/40 bg-success/10',
                  p.status === 'reserved' && 'border-warning/40 bg-warning/10',
                  p.status === 'free' && 'border-border bg-background/40'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold">GPIO {p.pin}</span>
                  <Badge
                    variant={
                      p.status === 'in-use' ? 'success' : p.status === 'reserved' ? 'warning' : 'muted'
                    }
                    className="uppercase"
                  >
                    {p.status}
                  </Badge>
                </div>
                {(p.name || p.note) && (
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {p.name || p.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- I²C -------------------------------------------------------------

function I2CCard({ scan }) {
  const i2c = scan?.i2c;
  const buses = i2c?.buses || [];
  const totalDevices = buses.reduce((n, b) => n + (b.devices?.length || 0), 0);
  // Hide the card entirely when there's nothing to show — the bus being
  // enabled-but-empty is inferrable from GPIO 2/3 showing "reserved" in the
  // GPIO map. Only render when I²C isn't enabled (actionable hint) or when
  // at least one device is detected.
  if (i2c && buses.length > 0 && totalDevices === 0) return null;
  const caption = !i2c
    ? 'Scanning…'
    : buses.length === 0
      ? 'user bus not enabled'
      : `${totalDevices} sensor${totalDevices === 1 ? '' : 's'} on ${buses.length} bus${buses.length === 1 ? '' : 'es'}`;
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Cable className="size-4 text-muted-foreground" />
            <CardTitle>I²C sensors</CardTitle>
          </div>
          <CardDescription>{caption}</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      {i2c && buses.length > 0 && totalDevices > 0 && (
        <CardContent className="pt-0">
          <div className="space-y-2">
            {buses.filter((b) => (b.devices?.length || 0) > 0).map((b) => (
              <div key={b.path} className="rounded-md border border-border bg-background/40 p-2">
                <div className="mb-1 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                  {b.path}
                </div>
                <ul className="space-y-1 text-xs">
                  {b.devices.map((d) => (
                    <li key={d.addr} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{d.hex}</span>
                      <span className="truncate text-muted-foreground">{d.candidates.join(' / ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      )}
      {i2c && buses.length === 0 && i2c.hint && (
        <CardContent className="pt-0">
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">How to enable</summary>
            <p className="mt-2 leading-relaxed">{i2c.hint}</p>
          </details>
        </CardContent>
      )}
    </Card>
  );
}

// --- Sensors (DHT22 + 1-Wire) ----------------------------------------

function SensorsCard({ scan }) {
  const s = scan?.sensors;
  const dht22 = s?.dht22;
  const oneWire = s?.oneWire;
  const oneWireCount = oneWire?.devices?.length ?? 0;
  const totalCount = (dht22 ? 1 : 0) + oneWireCount;
  const caption = !s
    ? 'Scanning…'
    : `${totalCount} sensor${totalCount === 1 ? '' : 's'}`;

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Thermometer className="size-4 text-muted-foreground" />
            <CardTitle>Sensors</CardTitle>
          </div>
          <CardDescription>{caption}</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      {s && (
        <CardContent className="pt-0">
          <ul className="space-y-1 text-xs">
            {dht22 && <DhtRow dht={dht22} />}
            {oneWireCount > 0 &&
              oneWire.devices.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2"
                >
                  <span className="font-mono">{d.id}</span>
                  <span className="text-muted-foreground">{d.kind} · 1-Wire</span>
                </li>
              ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function DhtRow({ dht }) {
  const r = dht.reading;
  return (
    <li className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">DHT22</span>
          <Badge variant="outline" className="font-mono">GPIO {dht.pin}</Badge>
          {dht.simulated && <Badge variant="warning">simulated</Badge>}
        </div>
        <span className="text-muted-foreground">temperature · humidity</span>
      </div>
      {r ? (
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          {r.temperature}°F · {r.humidity}% RH
        </div>
      ) : (
        <div className="mt-1 text-[11px] text-muted-foreground">
          waiting for first reading…
        </div>
      )}
    </li>
  );
}

// --- Video -----------------------------------------------------------

function VideoCard({ scan }) {
  const v = scan?.video;
  const all = v?.devices || [];
  const usable = all.filter((d) => d.usable);
  const hiddenCount = all.length - usable.length;
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Camera className="size-4 text-muted-foreground" />
            <CardTitle>Cameras</CardTitle>
          </div>
          <CardDescription>
            {!v
              ? 'Scanning…'
              : usable.length === 0
                ? 'no USB camera plugged in'
                : `${usable.length} usable${hiddenCount ? ` · ${hiddenCount} platform node${hiddenCount === 1 ? '' : 's'} hidden` : ''}`}
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      {v && usable.length > 0 && (
        <CardContent className="pt-0">
          <ul className="space-y-1 text-xs">
            {usable.map((d) => (
              <li
                key={d.path}
                className="flex items-center justify-between rounded-md border border-success/30 bg-background/40 px-3 py-2"
              >
                <span className="font-mono">{d.path}</span>
                <span className="truncate text-muted-foreground">
                  {d.card || d.driver || 'unknown'}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

// --- Host health -----------------------------------------------------

function HostHealthCard({ host }) {
  if (!host) {
    return (
      <Card>
        <CardHeader>
          <CardTitleGroup>
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-muted-foreground" />
              <CardTitle>Pi health</CardTitle>
            </div>
            <CardDescription>Loading…</CardDescription>
          </CardTitleGroup>
        </CardHeader>
      </Card>
    );
  }

  const tempC = host.cpu?.temp_c;
  const tempHot = tempC != null && tempC >= 75; // Pi starts throttling at 80C
  const loadPct = host.cpu?.load_pct_1m ?? 0;
  const memPct = host.memory?.used_pct ?? 0;
  const disk = host.disk_root;
  const diskPct = disk ? disk.used_bytes / disk.total_bytes : 0;
  const flags = host.cpu?.throttled;
  const flaggingNow = flags && (flags.undervoltage || flags.freq_capped || flags.throttled_now || flags.temp_limit_now);
  const flaggingPast = flags && (flags.undervoltage_past || flags.freq_capped_past || flags.throttled_past || flags.temp_limit_past);

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-muted-foreground" />
            <CardTitle>Pi health</CardTitle>
          </div>
          <CardDescription>{host.pi_model || 'host'} · kernel {host.kernel}</CardDescription>
        </CardTitleGroup>
        {flaggingNow && (
          <Badge variant="danger" className="uppercase">
            <AlertTriangle className="size-3" /> throttling now
          </Badge>
        )}
        {!flaggingNow && flaggingPast && (
          <Badge variant="warning" className="uppercase">
            past events
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <MeterRow
          icon={Thermometer}
          label="SoC temperature"
          value={tempC != null ? `${tempC.toFixed(1)} °C` : '—'}
          pct={tempC != null ? Math.min(1, Math.max(0, (tempC - 30) / 60)) : 0}
          accent={tempHot ? 'warning' : 'default'}
          hint={tempHot ? 'hot — throttling starts at 80°C' : null}
        />
        <MeterRow
          icon={Cpu}
          label={`CPU load · ${host.cpu?.count}× cores`}
          value={host.cpu?.load_1m != null ? host.cpu.load_1m.toFixed(2) : '—'}
          pct={loadPct}
          accent={loadPct > 0.8 ? 'warning' : 'default'}
          hint={`${(host.cpu?.load_1m ?? 0).toFixed(2)} / ${(host.cpu?.load_5m ?? 0).toFixed(2)} / ${(host.cpu?.load_15m ?? 0).toFixed(2)} (1m / 5m / 15m)`}
        />
        <MeterRow
          icon={MemoryStick}
          label="Memory"
          value={`${fmtBytes(host.memory?.used_bytes)} / ${fmtBytes(host.memory?.total_bytes)}`}
          pct={memPct}
          accent={memPct > 0.9 ? 'warning' : 'default'}
        />
        {disk && (
          <MeterRow
            icon={HardDrive}
            label="Disk (root)"
            value={`${fmtBytes(disk.used_bytes)} / ${fmtBytes(disk.total_bytes)}`}
            pct={diskPct}
            accent={diskPct > 0.85 ? 'warning' : 'default'}
            hint={`${fmtBytes(disk.avail_bytes)} free`}
          />
        )}
        <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground">
          <span>Uptime {fmtUptime(host.uptime_seconds)}</span>
          {flags?.raw && (
            <span className="font-mono" title="vcgencmd get_throttled">
              throttled={flags.raw}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MeterRow({ icon: Icon, label, value, pct, accent, hint }) {
  const p = Math.max(0, Math.min(1, pct || 0));
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </span>
        <span className="font-mono tabular-nums text-foreground">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full transition-all',
            accent === 'warning' ? 'bg-warning' : 'bg-primary'
          )}
          style={{ width: `${p * 100}%` }}
        />
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function fmtBytes(n) {
  if (n == null) return '—';
  if (n > 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n > 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtUptime(sec) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// --- USB peripherals -------------------------------------------------

function UsbCard({ scan }) {
  const u = scan?.usb;
  const devices = u?.devices || [];
  const caption = !u
    ? 'Scanning…'
    : u.available === false
      ? 'not available on this host'
      : devices.length === 0
        ? 'no USB devices detected'
        : `${devices.length} device${devices.length === 1 ? '' : 's'}`;
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Usb className="size-4 text-muted-foreground" />
            <CardTitle>USB peripherals</CardTitle>
          </div>
          <CardDescription>{caption}</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      {u && devices.length > 0 && (
        <CardContent className="pt-0">
          <ul className="space-y-1 text-xs">
            {devices.map((d) => (
              <li
                key={`${d.bus_path}-${d.vid_hex}-${d.pid_hex}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {d.product_name || d.vendor_name || 'Unknown device'}
                    </span>
                    {d.class_label && <Badge variant="outline">{d.class_label}</Badge>}
                  </div>
                  {d.vendor_name && d.product_name && (
                    <div className="truncate text-[11px] text-muted-foreground">{d.vendor_name}</div>
                  )}
                </div>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {d.vid_hex}:{d.pid_hex}
                </span>
              </li>
            ))}
          </ul>
          {u.hint && (
            <p className="mt-2 text-[11px] text-muted-foreground">{u.hint}</p>
          )}
        </CardContent>
      )}
      {u?.available === false && u.reason && (
        <CardContent className="pt-0">
          <Empty text={u.reason} />
        </CardContent>
      )}
    </Card>
  );
}

// --- Serial ports ----------------------------------------------------

function SerialCard({ scan }) {
  const s = scan?.serial;
  const ports = s?.ports || [];
  if (s?.available === true && ports.length === 0) return null; // hide noise on quiet hosts
  const caption = !s
    ? 'Scanning…'
    : s.available === false
      ? 'not available on this host'
      : `${ports.length} serial port${ports.length === 1 ? '' : 's'}`;
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Cable className="size-4 text-muted-foreground" />
            <CardTitle>Serial ports</CardTitle>
          </div>
          <CardDescription>{caption}</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      {s && ports.length > 0 && (
        <CardContent className="pt-0">
          <ul className="space-y-1 text-xs">
            {ports.map((p) => (
              <li
                key={p.path}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2"
              >
                <span className="font-mono">{p.path}</span>
                <span className="truncate text-muted-foreground">
                  {p.product_name || p.vendor_name || p.driver || '—'}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
      {s?.available === false && s.reason && (
        <CardContent className="pt-0">
          <Empty text={s.reason} />
        </CardContent>
      )}
    </Card>
  );
}

// --- Platform pill ---------------------------------------------------

function PlatformPill({ platform }) {
  const label = platform.is_raspberry_pi ? 'Raspberry Pi' : platform.kind;
  return (
    <Badge variant="muted" className="font-mono text-[11px]" title={platform.model_string || ''}>
      {label} · {platform.arch}
    </Badge>
  );
}

// --- Helpers ---------------------------------------------------------

function Loading() {
  return <div className="py-6 text-center text-xs text-muted-foreground">Scanning…</div>;
}
function Empty({ text }) {
  return <div className="rounded-md border border-dashed border-border bg-background/30 px-3 py-4 text-xs text-muted-foreground">{text}</div>;
}
