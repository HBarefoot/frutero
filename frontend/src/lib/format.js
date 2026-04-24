export function formatUptime(seconds) {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

// SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" in UTC with no TZ
// suffix; browsers would parse that as local time and skew by the local
// offset. Coerce to UTC when no TZ info is present.
function parseTs(iso) {
  if (!iso) return NaN;
  const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso);
  const normalized = hasTz ? iso : iso.replace(' ', 'T') + 'Z';
  return new Date(normalized).getTime();
}

export function formatRelative(iso) {
  if (!iso) return '—';
  const then = parseTs(iso);
  const diff = Math.floor((Date.now() - then) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(parseTs(iso));
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(parseTs(iso)).toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function metricStatus(value, min, max, margin = 0.05) {
  if (value == null || min == null || max == null) return 'unknown';
  if (value < min || value > max) return 'alert';
  const span = max - min;
  const buffer = span * margin;
  if (value < min + buffer || value > max - buffer) return 'warning';
  return 'optimal';
}
