import { useEffect, type ReactNode } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RouterProvider, useRouter } from './lib/router';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NewEvaluationPage } from './pages/NewEvaluationPage';
import { ObjectionsPage } from './pages/ObjectionsPage';
import { ReviewsPage } from './pages/ReviewsPage';

const knownPaths = new Set(['/', '/login', '/reviews', '/objections', '/evaluations/new', '/analytics']);

function ApplicationRoutes() {
  const { pathname, navigate } = useRouter();

  useEffect(() => {
    if (!knownPaths.has(pathname)) navigate('/', { replace: true });
  }, [navigate, pathname]);

  if (pathname === '/login') return <LoginPage />;

  let page: ReactNode = <DashboardPage />;

  if (pathname === '/reviews') page = <ReviewsPage />;
  if (pathname === '/objections') page = <ObjectionsPage />;
  if (pathname === '/evaluations/new') {
    page = (
      <ProtectedRoute allowedRoles={['super_admin', 'admin', 'qtl', 'qc']}>
        <NewEvaluationPage />
      </ProtectedRoute>
    );
  }
  if (pathname === '/analytics') {
    page = (
      <ProtectedRoute allowedRoles={['super_admin', 'admin', 'qtl']}>
        <AnalyticsPage />
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <AppShell>{page}</AppShell>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <ApplicationRoutes />
      </AuthProvider>
    </RouterProvider>
  );
}
