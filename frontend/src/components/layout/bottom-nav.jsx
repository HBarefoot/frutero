import { NavLink } from 'react-router-dom';
import { Brain, Camera, FlaskConical, Gauge, Menu } from 'lucide-react';
import { cn } from '@/lib/cn';

// Mobile-only bottom navigation. Four primary destinations + a "More"
// trigger that opens the existing sidebar drawer so every route stays
// reachable. Hidden at md+ (tablets/desktops) where the sidebar is
// either drawer-on-hamburger or always-visible.
const ITEMS = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/batches', label: 'Batches', icon: FlaskConical },
  { to: '/camera', label: 'Camera', icon: Camera },
  { to: '/ai', label: 'AI', icon: Brain },
];

export function BottomNav({ onOpenNav }) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)] md:hidden'
      )}
    >
      <ul className="flex items-stretch justify-around">
        {ITEMS.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] transition-colors',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              <item.icon className="size-5" />
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <button
            type="button"
            onClick={onOpenNav}
            aria-label="Open navigation menu"
            className="flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Menu className="size-5" />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
