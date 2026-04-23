import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchAlerts, fetchSettings, fetchStatus } from './api.js';
import { useSocket } from './useSocket.js';

const StatusContext = createContext(null);

export function StatusProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [alerts, setAlerts] = useState({ config: {}, history: [] });
  const [settings, setSettings] = useState({ settings: {}, species_presets: {} });
  const [recentAlert, setRecentAlert] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [s, a, st] = await Promise.all([fetchStatus(), fetchAlerts(), fetchSettings()]);
      setStatus(s);
      setAlerts(a);
      setSettings(st);
    } catch (err) {
      console.error('status refresh failed', err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleMessage = useCallback((msg) => {
    if (msg.type === 'device_change') {
      const { device, state, trigger } = msg.data;
      setStatus((prev) => {
        if (!prev?.actuators?.[device]) return prev;
        const overrideNext =
          trigger === 'api' || trigger === 'manual'
            ? true
            : trigger === 'schedule' || trigger === 'clear-override'
            ? false
            : prev.actuators[device].manualOverride;
        return {
          ...prev,
          actuators: {
            ...prev.actuators,
            [device]: { ...prev.actuators[device], state, manualOverride: overrideNext },
          },
        };
      });
    } else if (msg.type === 'sensor_reading') {
      setStatus((prev) => (prev ? { ...prev, sensor: msg.data } : prev));
    } else if (msg.type === 'alert') {
      setRecentAlert(msg.data);
      setAlerts((prev) => ({
        ...prev,
        history: [{ ...msg.data }, ...(prev.history || [])].slice(0, 50),
      }));
    }
  }, []);

  const { status: wsStatus } = useSocket(handleMessage);

  const value = useMemo(
    () => ({
      status,
      actuators: status?.actuators || {},
      alerts,
      settings,
      recentAlert,
      wsStatus,
      refresh,
      dismissRecentAlert: () => setRecentAlert(null),
    }),
    [status, alerts, settings, recentAlert, wsStatus, refresh]
  );

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

export function useStatus() {
  const ctx = useContext(StatusContext);
  if (!ctx) throw new Error('useStatus must be used inside <StatusProvider>');
  return ctx;
}
