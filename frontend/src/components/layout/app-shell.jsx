import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { PwaUpdateBanner } from '@/components/pwa-update-banner';

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="relative flex min-h-screen bg-background">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenNav={() => setNavOpen(true)} />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">
              <Outlet />
            </div>
          </main>
        </div>
        <PwaUpdateBanner />
      </div>
    </TooltipProvider>
  );
}
