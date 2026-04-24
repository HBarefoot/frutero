import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { AuthGate } from '@/components/auth/auth-gate';
import { ErrorBoundary } from '@/components/error-boundary';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider } from '@/lib/auth-context';
import { StatusProvider } from '@/lib/status-context';

// Keep the auth/bootstrap flow in the main bundle so the login/setup
// pages are zero-waterfall after first paint. Everything behind the
// AuthGate is lazy — those pages only load once the user is signed in,
// so first-load for a grower hitting /login stays fast even over LTE.
import LoginPage from '@/pages/login';
import SetupPage from '@/pages/setup';
import AcceptInvitePage from '@/pages/accept-invite';
import ResetPasswordPage from '@/pages/reset-password';

const DashboardPage = lazy(() => import('@/pages/dashboard'));
const DevicesPage = lazy(() => import('@/pages/devices'));
const SchedulesPage = lazy(() => import('@/pages/schedules'));
const AlertsPage = lazy(() => import('@/pages/alerts'));
const ActivityPage = lazy(() => import('@/pages/activity'));
const SpeciesPage = lazy(() => import('@/pages/species'));
const TeamPage = lazy(() => import('@/pages/team'));
const HardwarePage = lazy(() => import('@/pages/hardware'));
const AuditPage = lazy(() => import('@/pages/audit'));
const AccountPage = lazy(() => import('@/pages/account'));
const CameraPage = lazy(() => import('@/pages/camera'));
const SecurityPage = lazy(() => import('@/pages/security'));
const AIPage = lazy(() => import('@/pages/ai'));
const BatchesPage = lazy(() => import('@/pages/batches'));

// Lightweight skeleton shown while the lazy chunk loads. Kept minimal
// on purpose — even a slow LTE chunk resolves in ~200ms, so anything
// more elaborate flickers.
function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}

// Wrap each routed page in a per-page boundary so a crash on (say)
// Devices can't take down the sidebar, and the user can keep navigating.
// Suspense boundary pairs with lazy() so the skeleton shows during
// chunk fetch without blanking the sidebar.
const page = (el) => (
  <ErrorBoundary scope="page">
    <Suspense fallback={<PageFallback />}>{el}</Suspense>
  </ErrorBoundary>
);

export default function App() {
  return (
    <ErrorBoundary scope="app">
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
          <Routes>
            {/* Unauthenticated flows — eager-loaded. */}
            <Route path="/login" element={page(<LoginPage />)} />
            <Route path="/setup" element={page(<SetupPage />)} />
            <Route path="/invite/:token" element={page(<AcceptInvitePage />)} />
            <Route path="/reset/:token" element={page(<ResetPasswordPage />)} />

            {/* Everything else is gated; StatusProvider only mounts
                after auth, so it can open the WebSocket with a valid cookie. */}
            <Route
              element={
                <AuthGate>
                  <StatusProvider>
                    <AppShell />
                  </StatusProvider>
                </AuthGate>
              }
            >
              <Route index element={page(<DashboardPage />)} />
              <Route path="/devices" element={page(<DevicesPage />)} />
              <Route path="/schedules" element={page(<SchedulesPage />)} />
              <Route path="/alerts" element={page(<AlertsPage />)} />
              <Route path="/activity" element={page(<ActivityPage />)} />
              <Route path="/species" element={page(<SpeciesPage />)} />
              <Route path="/team" element={page(<TeamPage />)} />
              <Route path="/hardware" element={page(<HardwarePage />)} />
              <Route path="/audit" element={page(<AuditPage />)} />
              <Route path="/account" element={page(<AccountPage />)} />
              <Route path="/camera" element={page(<CameraPage />)} />
              <Route path="/security" element={page(<SecurityPage />)} />
              <Route path="/ai" element={page(<AIPage />)} />
              <Route path="/batches" element={page(<BatchesPage />)} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
