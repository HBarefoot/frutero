import { NavLink } from 'react-router-dom';
import {
  Activity,
  Bell,
  CalendarClock,
  Camera,
  Cpu,
  FileSearch,
  Gauge,
  HardDrive,
  Leaf,
  Shield,
  Sprout,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

const PRIMARY_NAV = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/camera', label: 'Live Camera', icon: Camera },
  { to: '/schedules', label: 'Schedules', icon: CalendarClock },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/species', label: 'Species', icon: Leaf },
];

export function Sidebar({ open, onClose }) {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  return (
    <>
      {/* Mobile backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-30 bg-background/80 backdrop-blur-sm transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform',
          'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-5">
          <Brand />
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X />
          </Button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          <NavSection label="Chamber">
            {PRIMARY_NAV.map((item) => (
              <NavItem key={item.to} {...item} onNavigate={onClose} />
            ))}
          </NavSection>

          {isOwner && (
            <NavSection label="Admin">
              <NavItem to="/hardware" label="Hardware" icon={HardDrive} onNavigate={onClose} />
              <NavItem to="/team" label="Team" icon={Users} onNavigate={onClose} />
              <NavItem to="/security" label="Security" icon={Shield} onNavigate={onClose} />
              <NavItem to="/audit" label="Audit log" icon={FileSearch} onNavigate={onClose} />
            </NavSection>
          )}

        </nav>

        <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>frutero</span>
            <span className="font-mono">v0.2</span>
          </div>
        </div>
      </aside>
    </>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid size-8 place-items-center rounded-md bg-primary/15 text-primary">
        <Sprout className="size-5" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">frutero</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          grow controller
        </div>
      </div>
    </div>
  );
}

function NavSection({ label, children }) {
  return (
    <div>
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function NavItem({ to, label, icon: Icon, end, onNavigate }) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
            isActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )
        }
      >
        <Icon className="size-4" />
        <span className="flex-1 truncate">{label}</span>
      </NavLink>
    </li>
  );
}

