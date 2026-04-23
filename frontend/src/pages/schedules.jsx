import { useEffect, useState } from 'react';
import { CalendarClock, Plus, Sparkles, Trash2 } from 'lucide-react';
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
  createSchedule,
  deleteSchedule,
  fetchSchedules,
  updateSchedule,
} from '@/lib/api';
import { useStatus } from '@/lib/status-context';
import { cn } from '@/lib/cn';

const PRESETS = [
  {
    label: 'Standard 12/12 light',
    items: [
      { device: 'light', action: 'on', cron_expression: '0 6 * * *',  label: 'Lights ON 6 AM'  },
      { device: 'light', action: 'off', cron_expression: '0 18 * * *', label: 'Lights OFF 6 PM' },
    ],
  },
  {
    label: 'FAE every 30 min',
    items: [
      { device: 'fan', action: 'on', cron_expression: '*/30 * * * *', label: 'Fan cycle every 30min' },
    ],
  },
  {
    label: 'High humidity (fans every 15 min)',
    items: [
      { device: 'fan', action: 'on', cron_expression: '*/15 * * * *', label: 'Fan cycle every 15min' },
    ],
  },
];

export default function SchedulesPage() {
  const { refresh } = useStatus();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    device: 'fan',
    action: 'on',
    cron_expression: '*/30 * * * *',
    label: '',
  });
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setRows(await fetchSchedules());
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function onAdd(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createSchedule({ ...form, enabled: true });
      setForm({ ...form, label: '' });
      await reload();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(row) {
    await updateSchedule(row.id, { enabled: !row.enabled });
    await reload();
    refresh();
  }

  async function onDelete(row) {
    if (!confirm(`Delete schedule "${row.label || row.cron_expression}"?`)) return;
    await deleteSchedule(row.id);
    await reload();
    refresh();
  }

  async function applyPreset(preset) {
    setBusy(true);
    try {
      for (const item of preset.items) {
        await createSchedule({ ...item, enabled: true });
      }
      await reload();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Schedules"
        description="Cron-based automation for every connected device"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitleGroup>
              <div className="flex items-center gap-2">
                <CalendarClock className="size-4 text-muted-foreground" />
                <CardTitle>Active schedules</CardTitle>
              </div>
              <CardDescription>{rows.length} total</CardDescription>
            </CardTitleGroup>
          </CardHeader>
          <CardContent className="pt-0">
            {rows.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((row) => (
                  <ScheduleRow
                    key={row.id}
                    row={row}
                    onToggle={() => onToggle(row)}
                    onDelete={() => onDelete(row)}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitleGroup>
                <CardTitle>Add schedule</CardTitle>
                <CardDescription>Custom cron expression</CardDescription>
              </CardTitleGroup>
            </CardHeader>
            <CardContent>
              <form onSubmit={onAdd} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="sched-device">Device</Label>
                    <SelectNative
                      id="sched-device"
                      value={form.device}
                      onChange={(e) => setForm({ ...form, device: e.target.value })}
                      className="mt-1.5"
                    >
                      <option value="fan">Fan</option>
                      <option value="light">Light</option>
                    </SelectNative>
                  </div>
                  <div>
                    <Label htmlFor="sched-action">Action</Label>
                    <SelectNative
                      id="sched-action"
                      value={form.action}
                      onChange={(e) => setForm({ ...form, action: e.target.value })}
                      className="mt-1.5"
                    >
                      <option value="on">ON</option>
                      <option value="off">OFF</option>
                    </SelectNative>
                  </div>
                </div>
                <div>
                  <Label htmlFor="sched-cron">Cron expression</Label>
                  <Input
                    id="sched-cron"
                    placeholder="0 6 * * *"
                    value={form.cron_expression}
                    onChange={(e) => setForm({ ...form, cron_expression: e.target.value })}
                    className="mt-1.5 font-mono"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="sched-label">Label</Label>
                  <Input
                    id="sched-label"
                    placeholder="optional"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <Button type="submit" disabled={busy} className="w-full">
                  <Plus />
                  Add schedule
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitleGroup>
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-muted-foreground" />
                  <CardTitle>Quick presets</CardTitle>
                </div>
                <CardDescription>One-click schedule bundles</CardDescription>
              </CardTitleGroup>
            </CardHeader>
            <CardContent className="space-y-2">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => applyPreset(p)}
                  disabled={busy}
                >
                  <Plus />
                  {p.label}
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function ScheduleRow({ row, onToggle, onDelete }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge
            variant={row.device === 'fan' ? 'info' : 'warning'}
            className="uppercase"
          >
            {row.device} {row.action}
          </Badge>
          <span className={cn('truncate', row.enabled ? 'text-foreground' : 'text-muted-foreground line-through')}>
            {row.label || row.cron_expression}
          </span>
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          {row.cron_expression}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={!!row.enabled}
          onCheckedChange={onToggle}
          aria-label="Toggle schedule"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label="Delete schedule"
          className="text-muted-foreground hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <CalendarClock className="size-8 text-muted-foreground/40" />
      <p className="text-sm text-muted-foreground">No schedules yet.</p>
      <p className="text-xs text-muted-foreground">
        Add a custom cron or apply a preset to get started.
      </p>
    </div>
  );
}
