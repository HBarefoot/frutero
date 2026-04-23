import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';

/**
 * Wraps the authenticated area of the app. Decides based on the current
 * auth state whether to show the routed content, redirect to login,
 * or redirect to the first-run setup wizard.
 */
export function AuthGate({ children }) {
  const { loading, isAuthed, needsSetup } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoader label="Loading session…" />;

  if (needsSetup) {
    return <Navigate to="/setup" replace state={{ from: location }} />;
  }
  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

function FullScreenLoader({ label }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
      {label}
    </div>
  );
}
