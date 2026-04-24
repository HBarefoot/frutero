import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Surfaces an "update available" prompt when a new service worker
// finishes installing in the background. The SW uses skipWaiting()
// in its install handler, so we can trigger an immediate takeover
// and reload to pick up the fresh build.
export function PwaUpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let cancelled = false;

    navigator.serviceWorker.ready.then((reg) => {
      if (cancelled) return;
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // A new SW moved to 'installed' while a controller already
          // exists — that's the "update ready" signal.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setReady(true);
          }
        });
      });
    }).catch(() => { /* no SW → no banner */ });

    // When the controller changes (new SW took over), the page is
    // safe to reload for a clean state.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    return () => { cancelled = true; };
  }, []);

  if (!ready) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm shadow-lg backdrop-blur">
      <div className="flex items-center gap-3">
        <span>Update available</span>
        <Button size="sm" variant="default" onClick={() => window.location.reload()}>
          <RefreshCw />
          Reload
        </Button>
      </div>
    </div>
  );
}
