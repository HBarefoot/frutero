import { useCallback, useEffect, useState } from 'react';
import { useSocket } from './lib/useSocket.js';
import { fetchStatus, fetchAlerts, fetchSettings } from './lib/api.js';
import StatusBar from './components/StatusBar.jsx';
import Dashboard from './components/Dashboard.jsx';

export default function App() {
  const [status, setStatus] = useState(null);
  const [alerts, setAlerts] = useState({ config: {}, history: [] });
  const [settings, setSettings] = useState({ settings: {}, species_presets: {} });
  const [recentAlert, setRecentAlert] = useState(null);

  const refreshAll = useCallback(async () => {
    try {
      const [s, a, st] = await Promise.all([fetchStatus(), fetchAlerts(), fetchSettings()]);
      setStatus(s);
      setAlerts(a);
      setSettings(st);
    } catch (err) {
      console.error('refresh failed', err);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleSocketMessage = useCallback((msg) => {
    if (msg.type === 'device_change') {
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              [msg.data.device]: msg.data.state,
              manualOverride: {
                ...prev.manualOverride,
                [msg.data.device]:
                  msg.data.trigger === 'api' || msg.data.trigger === 'manual'
                    ? true
                    : msg.data.trigger === 'schedule'
                    ? false
                    : prev.manualOverride?.[msg.data.device],
              },
            }
          : prev
      );
    } else if (msg.type === 'sensor_reading') {
      setStatus((prev) => (prev ? { ...prev, sensor: msg.data } : prev));
    } else if (msg.type === 'alert') {
      setRecentAlert(msg.data);
      setAlerts((prev) => ({
        ...prev,
        history: [{ ...msg.data }, ...(prev.history || [])].slice(0, 20),
      }));
    }
  }, []);

  const { status: wsStatus } = useSocket(handleSocketMessage);

  return (
    <div className="min-h-screen bg-shroom-bg text-slate-100">
      <StatusBar
        wsStatus={wsStatus}
        uptime={status?.uptime}
        alertCount={alerts.history?.length || 0}
        recentAlert={recentAlert}
        onDismissAlert={() => setRecentAlert(null)}
      />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-4 sm:px-6">
        <Dashboard
          status={status}
          alerts={alerts}
          settings={settings}
          onRefresh={refreshAll}
        />
      </main>
    </div>
  );
}
