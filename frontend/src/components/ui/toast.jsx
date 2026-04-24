import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

// Lightweight global toast system. Replaces the mixed inline-error
// pattern across pages with a consistent top-right stack. Four levels
// — success / info / warning / error — each with the right accent and
// icon. No external dep.
//
// Usage:
//   const toast = useToast();
//   toast.success('Saved');
//   toast.error('Failed to save');
//   toast.warn('Cooldown in 12s', { duration: 3000 });
//   toast.info('Reconnected');
//   toast(error); // accepts Error / axios-style shape directly

const ToastContext = createContext(null);

const LEVEL_META = {
  success: { icon: CheckCircle2, ring: 'border-success/40 bg-success/10 text-success' },
  info:    { icon: Info,         ring: 'border-info/40 bg-info/10 text-info' },
  warn:    { icon: AlertTriangle, ring: 'border-warning/40 bg-warning/10 text-warning' },
  error:   { icon: XCircle,      ring: 'border-danger/40 bg-danger/10 text-danger' },
};

let nextId = 1;

function messageFrom(input) {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  // axios-style: err.response.data.detail || err.response.data.error
  const data = input?.response?.data;
  if (data?.detail) return data.detail;
  if (data?.error) return data.error;
  if (input instanceof Error) return input.message;
  return String(input);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback((level, message, opts = {}) => {
    const id = nextId++;
    const duration = opts.duration ?? (level === 'error' ? 6000 : 4000);
    setToasts((prev) => [...prev, { id, level, message, title: opts.title }]);
    if (duration > 0) {
      const t = setTimeout(() => remove(id), duration);
      timers.current.set(id, t);
    }
    return id;
  }, [remove]);

  const api = useCallback(
    Object.assign(
      (input, opts) => push('error', messageFrom(input), opts),
      {
        success: (msg, opts) => push('success', messageFrom(msg), opts),
        info: (msg, opts) => push('info', messageFrom(msg), opts),
        warn: (msg, opts) => push('warn', messageFrom(msg), opts),
        error: (msg, opts) => push('error', messageFrom(msg), opts),
        dismiss: remove,
      }
    ),
    [push, remove]
  );

  // Cleanup any lingering timers on unmount.
  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const meta = LEVEL_META[t.level] || LEVEL_META.info;
        const Icon = meta.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm shadow-lg backdrop-blur-sm',
              meta.ring
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              {t.title && <div className="font-semibold">{t.title}</div>}
              <div className="break-words">{t.message}</div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="shrink-0 rounded-md p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
