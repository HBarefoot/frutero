import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { AuthGate } from '@/components/auth/auth-gate';
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
import LoginPage from '@/pages/login';
import SetupPage from '@/pages/setup';
import AcceptInvitePage from '@/pages/accept-invite';
import ResetPasswordPage from '@/pages/reset-password';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Unauthenticated flows */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/invite/:token" element={<AcceptInvitePage />} />
          <Route path="/reset/:token" element={<ResetPasswordPage />} />

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
            <Route index element={<DashboardPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/species" element={<SpeciesPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/hardware" element={<HardwarePage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/camera" element={<CameraPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
