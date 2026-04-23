import { Sprout } from 'lucide-react';

/**
 * Centered 420px card layout used by login, setup, and invite-accept.
 */
export function AuthLayout({ title, description, footer, children }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-8 flex items-center gap-2">
        <div className="grid size-10 place-items-center rounded-md bg-primary/15 text-primary">
          <Sprout className="size-6" />
        </div>
        <div className="leading-tight">
          <div className="text-base font-semibold tracking-tight">frutero</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            grow controller
          </div>
        </div>
      </div>
      <div className="w-full max-w-[420px] rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        )}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-6 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}
