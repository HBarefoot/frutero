import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';

// Simple 0–4 strength scorer. Deliberately no dependency on zxcvbn —
// the lib is 700KB and we only need a visual hint, not cryptographic
// analysis. Counts length + character class diversity, penalizes common
// patterns and known-bad strings.
const COMMON_WEAK = new Set([
  'password', 'password1', 'passw0rd', 'qwerty', 'qwerty123',
  '123456', '123456789', '1234567890', 'letmein', 'welcome',
  'admin', 'admin123', 'frutero', 'mushroom', 'chamber',
]);

function scorePassword(pw) {
  if (!pw) return { score: 0, label: '—', hints: [] };
  const lower = pw.toLowerCase();
  if (COMMON_WEAK.has(lower)) {
    return { score: 0, label: 'Too common', hints: ['This password is on known-weak lists.'] };
  }

  let score = 0;
  const hints = [];

  // Length is the dominant factor.
  if (pw.length >= 10) score += 1;
  if (pw.length >= 14) score += 1;
  if (pw.length >= 18) score += 1;
  if (pw.length < 10) hints.push('At least 10 characters.');

  // Class diversity — small bonuses.
  const classes = [
    /[a-z]/.test(pw),
    /[A-Z]/.test(pw),
    /[0-9]/.test(pw),
    /[^a-zA-Z0-9]/.test(pw),
  ].filter(Boolean).length;
  if (classes >= 3) score += 1;
  if (classes < 3) hints.push('Mix upper, lower, digits, and symbols.');

  // Penalize repetition like aaaa or 1111.
  if (/(.)\1{3,}/.test(pw)) {
    score = Math.max(0, score - 1);
    hints.push('Avoid long runs of the same character.');
  }

  // Cap + map to label.
  const clamped = Math.max(0, Math.min(4, score));
  const label = ['Weak', 'Fair', 'Good', 'Strong', 'Excellent'][clamped];
  return { score: clamped, label, hints };
}

const BAR_COLORS = [
  'bg-danger/70',
  'bg-warning/70',
  'bg-warning',
  'bg-success/70',
  'bg-success',
];

export function PasswordStrength({ password, className }) {
  const { score, label, hints } = useMemo(() => scorePassword(password || ''), [password]);
  const filled = password ? score + 1 : 0;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i < filled ? BAR_COLORS[score] : 'bg-muted'
              )}
            />
          ))}
        </div>
        <span
          className={cn(
            'flex items-center gap-1 text-[11px] font-medium tabular-nums',
            password && score >= 3 ? 'text-success' : 'text-muted-foreground'
          )}
        >
          {password && score >= 3 && <ShieldCheck className="size-3" />}
          {password ? label : '—'}
        </span>
      </div>
      {password && hints.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {hints.slice(0, 2).map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
