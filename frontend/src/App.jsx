import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { AuthGate } from '@/components/auth/auth-gate';
import { ErrorBoundary } from '@/components/error-boundary';
import { AuthProvider } from '@/lib/auth-context';
import { StatusProvider } from '@/lib/status-context';
import DashboardPage from '@/pages/dashboard';
import DevicesPage from '@/pages/devices';
import SchedulesPage from '@/pages/schedules';
import AlertsPage from '@/pages/alerts';
import ActivityPage from '@/pages/activity';
import SpeciesPage from '@/pages/species';
import TeamPage from '@/pages/team';
import HardwarePage from '@/pages/hardware';
import AuditPage from '@/pages/audit';
import AccountPage from '@/pages/account';
import CameraPage from '@/pages/camera';
import SecurityPage from '@/pages/security';
import LoginPage from '@/pages/login';
import SetupPage from '@/pages/setup';
import AcceptInvitePage from '@/pages/accept-invite';
import ResetPasswordPage from '@/pages/reset-password';

// Wrap each routed page in a per-page boundary so a crash on (say)
// Devices can't take down the sidebar, and the user can keep navigating.
const page = (el) => <ErrorBoundary scope="page">{el}</ErrorBoundary>;

export default function App() {
  return (
    <ErrorBoundary scope="app">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Unauthenticated flows */}
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
