import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { StatusProvider } from '@/lib/status-context';
import DashboardPage from '@/pages/dashboard';
import DevicesPage from '@/pages/devices';
import SchedulesPage from '@/pages/schedules';
import AlertsPage from '@/pages/alerts';
import ActivityPage from '@/pages/activity';
import SpeciesPage from '@/pages/species';

export default function App() {
  return (
    <StatusProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/schedules" element={<SchedulesPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/species" element={<SpeciesPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StatusProvider>
  );
}
