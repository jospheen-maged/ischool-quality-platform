import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RouterProvider, useRouter } from './lib/router';

const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const NewEvaluationPage = lazy(() => import('./pages/NewEvaluationPage').then((module) => ({ default: module.NewEvaluationPage })));
const ObjectionsPage = lazy(() => import('./pages/ObjectionsPage').then((module) => ({ default: module.ObjectionsPage })));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage').then((module) => ({ default: module.ReviewsPage })));

const knownPaths = new Set(['/', '/login', '/reviews', '/objections', '/evaluations/new', '/analytics']);

function PageLoader() {
  return (
    <div className="screen-center">
      <div className="workspace-loader" aria-label="Loading workspace" />
      <strong>Loading B2B Offline workspace…</strong>
    </div>
  );
}

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
        <Suspense fallback={<PageLoader />}>
          <ApplicationRoutes />
        </Suspense>
      </AuthProvider>
    </RouterProvider>
  );
}
