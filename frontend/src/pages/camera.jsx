import { useEffect, useRef, useState } from 'react';
import { Camera, Download, Save, Settings2, RefreshCw, Moon, Sun } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { PageHeader } from '@/components/layout/page-header';
import {
  cameraSnapshotUrl,
  cameraStreamUrl,
  fetchCameraStatus,
  saveCameraConfig,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { SnapshotTimeline, CVConfigCard } from '@/components/camera/snapshot-timeline';
import { TimelapseCard } from '@/components/camera/timelapse-card';

const RES_OPTIONS = ['320x240', '640x480', '800x600', '1280x720', '1920x1080'];

export default function CameraPage() {
  const { can } = useAuth();
  const isOwner = can('admin');
  const [status, setStatus] = useState(null);
  const [streamMode, setStreamMode] = useState(false);
  const [snapTick, setSnapTick] = useState(Date.now());
  const [error, setError] = useState(null);
  const [lowlightBusy, setLowlightBusy] = useState(false);
  const imgRef = useRef(null);

  async function reload() {
    try { setStatus(await fetchCameraStatus()); }
    catch (err) { setError(errMsg(err)); }
  }

  useEffect(() => { reload(); }, []);

  function refreshSnap() { setSnapTick(Date.now()); }

  async function toggleLowlight() {
    if (!isOwner || !status || lowlightBusy) return;
    const next = status.lowlight_mode === 'on' ? 'off' : 'on';
    setLowlightBusy(true);
    setError(null);
    try {
      await saveCameraConfig({ lowlight_mode: next });
      await reload();
      // Force the live <img> to reload so the new exposure takes effect
      // immediately rather than after the user manually clicks refresh.
      setSnapTick(Date.now());
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLowlightBusy(false);
    }
  }

  function downloadSnap() {
    const a = document.createElement('a');
    a.href = cameraSnapshotUrl(true);
    a.download = `chamber-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <>
      <PageHeader
        title="Live Camera"
        description="Real-time view of the fruiting chamber"
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={status?.available ? 'success' : 'muted'}>
              {status?.available ? 'live' : status?.stub ? 'stub' : 'offline'}
            </Badge>
            {isOwner && (
              <Button
                variant={status?.lowlight_mode === 'on' ? 'soft' : 'outline'}
                size="sm"
                onClick={toggleLowlight}
                disabled={lowlightBusy || !status?.available}
                title={
                  status?.lowlight_mode === 'on'
                    ? 'Low-light mode on — gain + brightness boost. Standard webcams have no IR; useful in dim light, not pitch black.'
                    : 'Engage low-light mode (gain + brightness boost). Note: this is NOT IR night vision.'
                }
              >
                {status?.lowlight_mode === 'on' ? <Moon /> : <Sun />}
                {status?.lowlight_mode === 'on' ? 'Low-light: on' : 'Low-light: off'}
              </Button>
            )}
            <Button
              variant={streamMode ? 'soft' : 'outline'}
              size="sm"
              onClick={() => setStreamMode((v) => !v)}
            >
              {streamMode ? 'Pause stream' : 'Start stream'}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitleGroup>
              <div className="flex items-center gap-2">
                <Camera className="size-4 text-muted-foreground" />
                <CardTitle>Feed</CardTitle>
              </div>
              <CardDescription>
                {streamMode
                  ? `MJPEG stream · ${status?.resolution || '?'} @ ${status?.fps || '?'}fps`
                  : 'Snapshot mode · refresh to grab a new frame'}
              </CardDescription>
            </CardTitleGroup>
            <div className="flex items-center gap-2">
              {!streamMode && (
                <Button variant="outline" size="sm" onClick={refreshSnap}>
                  <RefreshCw />
                  Snap
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={downloadSnap}>
                <Download />
                Save
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-border bg-black">
              {streamMode ? (
                <img
                  ref={imgRef}
                  src={cameraStreamUrl()}
                  alt="Live chamber feed"
                  className="block w-full h-auto"
                  onError={() => setError('Stream failed — check device + ffmpeg')}
                />
              ) : (
                <img
                  ref={imgRef}
                  src={`${cameraSnapshotUrl()}?t=${snapTick}`}
                  alt="Latest chamber snapshot"
                  className="block w-full h-auto"
                  onError={() => setError('Snapshot failed')}
                />
              )}
            </div>
            {error && (
              <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            )}
            {status?.stub && (
              <p className="mt-3 text-xs text-muted-foreground">
                Running in stub mode — no real camera attached. Plug in a USB camera and
                the feed will switch automatically.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <CameraConfigCard isOwner={isOwner} status={status} onSaved={reload} />
          {isOwner && <CVConfigCard />}
        </div>
      </div>

      <div className="mt-6 space-y-6">
        <SnapshotTimeline />
        <TimelapseCard />
      </div>
    </>
  );
}

function CameraConfigCard({ isOwner, status, onSaved }) {
  const [form, setForm] = useState({
    device: '/dev/video0',
    resolution: '640x480',
    fps: '10',
    quality: '7',
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (status) {
      setForm({
        device: status.device,
        resolution: status.resolution,
        fps: String(status.fps),
        quality: String(status.quality),
      });
    }
  }, [status]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveCameraConfig({
        device: form.device,
        resolution: form.resolution,
        fps: parseInt(form.fps, 10),
        quality: parseInt(form.quality, 10),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-muted-foreground" />
            <CardTitle>Camera config</CardTitle>
          </div>
          <CardDescription>Owner-only</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="cam-dev">Device</Label>
          <Input
            id="cam-dev"
            value={form.device}
            onChange={(e) => setForm({ ...form, device: e.target.value })}
            disabled={!isOwner}
            className="mt-1.5 font-mono"
          />
        </div>
        <div>
          <Label htmlFor="cam-res">Resolution</Label>
          <SelectNative
            id="cam-res"
            value={form.resolution}
            onChange={(e) => setForm({ ...form, resolution: e.target.value })}
            disabled={!isOwner}
            className="mt-1.5"
          >
            {RES_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </SelectNative>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cam-fps">FPS</Label>
            <Input
              id="cam-fps"
              type="number"
              min="1"
              max="60"
              value={form.fps}
              onChange={(e) => setForm({ ...form, fps: e.target.value })}
              disabled={!isOwner}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="cam-q">JPEG quality</Label>
            <Input
              id="cam-q"
              type="number"
              min="1"
              max="31"
              value={form.quality}
              onChange={(e) => setForm({ ...form, quality: e.target.value })}
              disabled={!isOwner}
              className="mt-1.5"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">lower = better</p>
          </div>
        </div>
        <Button onClick={save} disabled={busy || !isOwner} className="w-full">
          <Save />
          {saved ? 'Saved' : 'Save config'}
        </Button>
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        {!isOwner && (
          <p className="text-[11px] text-muted-foreground">
            Only the owner can change camera configuration.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function errMsg(err) {
  return err?.response?.data?.error || err?.message || 'Request failed';
}
