import { useEffect, useMemo, useState } from 'react';
import {
  Cable,
  Camera,
  Cpu,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Thermometer,
  Trash2,
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
          <Button variant="outline" size="sm" onClick={rescan} disabled={scanBusy}>
            <RefreshCw className={cn(scanBusy && 'animate-spin')} />
            Rescan
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <ActuatorsCard
            actuators={actuators}
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
          <I2CCard scan={scan} />
          <OneWireCard scan={scan} />
          <VideoCard scan={scan} />
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

function ActuatorsCard({ actuators, onEdit, onDelete, onTest, onAdd }) {
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
        <Button size="sm" onClick={onAdd}>
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
  const pins = scan?.gpio?.pins || [];
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
            {scan?.gpio?.mock && <span className="ml-2 text-warning">(mock mode)</span>}
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {pins.length === 0 ? (
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
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Cable className="size-4 text-muted-foreground" />
            <CardTitle>I²C devices</CardTitle>
          </div>
          <CardDescription>Auto-detected sensors on each I²C bus</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {!i2c ? (
          <Loading />
        ) : i2c.buses.length === 0 ? (
          <Empty text="No I²C buses found. Enable I²C via raspi-config or add `dtparam=i2c_arm=on` to /boot/firmware/config.txt." />
        ) : (
          <div className="space-y-3">
            {i2c.buses.map((b) => (
              <div key={b.path} className="rounded-md border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{b.path}</span>
                  <Badge variant="muted">bus {b.bus}</Badge>
                </div>
                {b.error ? (
                  <div className="mt-2 text-xs text-warning">{b.error}</div>
                ) : b.devices.length === 0 ? (
                  <div className="mt-2 text-xs text-muted-foreground">no devices detected</div>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs">
                    {b.devices.map((d) => (
                      <li key={d.addr} className="flex items-center justify-between gap-2">
                        <span className="font-mono">{d.hex}</span>
                        <span className="truncate text-muted-foreground">{d.candidates.join(' / ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- 1-Wire ----------------------------------------------------------

function OneWireCard({ scan }) {
  const w = scan?.oneWire;
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Thermometer className="size-4 text-muted-foreground" />
            <CardTitle>1-Wire</CardTitle>
          </div>
          <CardDescription>DS18B20 / temperature probes</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {!w ? (
          <Loading />
        ) : !w.enabled ? (
          <Empty text={w.hint || '1-Wire bus not enabled.'} />
        ) : w.devices.length === 0 ? (
          <Empty text="1-Wire enabled but no devices detected." />
        ) : (
          <ul className="space-y-1 text-xs">
            {w.devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
                <span className="font-mono">{d.id}</span>
                <span className="text-muted-foreground">{d.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// --- Video -----------------------------------------------------------

function VideoCard({ scan }) {
  const v = scan?.video;
  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Camera className="size-4 text-muted-foreground" />
            <CardTitle>Video devices</CardTitle>
          </div>
          <CardDescription>USB cameras and CSI/ISP nodes</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {!v ? (
          <Loading />
        ) : v.devices.length === 0 ? (
          <Empty text="No /dev/video* nodes found. Plug in a USB camera." />
        ) : (
          <ul className="space-y-1 text-xs">
            {v.devices.map((d) => (
              <li
                key={d.path}
                className={cn(
                  'flex items-center justify-between rounded-md border bg-background/40 px-3 py-2',
                  d.usable ? 'border-success/30' : 'border-border'
                )}
              >
                <span className="font-mono">{d.path}</span>
                <span className="truncate text-muted-foreground">
                  {d.card || d.driver || d.error || 'unknown'}
                </span>
                {d.usable && <Badge variant="success" className="ml-2">usable</Badge>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// --- Helpers ---------------------------------------------------------

function Loading() {
  return <div className="py-6 text-center text-xs text-muted-foreground">Scanning…</div>;
}
function Empty({ text }) {
  return <div className="rounded-md border border-dashed border-border bg-background/30 px-3 py-4 text-xs text-muted-foreground">{text}</div>;
}
