import { useEffect, useRef, useState } from 'react';

const RECONNECT_MS = 5000;

export function useSocket(onMessage) {
  const [status, setStatus] = useState('connecting');
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const handlerRef = useRef(onMessage);

  // Keep latest handler without re-opening the socket on every re-render.
  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${window.location.host}/ws`;
      setStatus('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        try {
          ws.send(JSON.stringify({ type: 'subscribe' }));
        } catch {
          // ignore
        }
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (handlerRef.current) handlerRef.current(msg);
        } catch {
          // ignore malformed
        }
      };
      ws.onclose = () => {
        setStatus('disconnected');
        if (!cancelled) {
          reconnectRef.current = setTimeout(connect, RECONNECT_MS);
        }
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return { status };
}
