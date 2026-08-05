import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { AuthProvider } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RouterProvider, useRouter } from './lib/router';

const AccessControlPage = lazy(() => import('./pages/AccessControlPage').then((module) => ({ default: module.AccessControlPage })));
const AccessPage = lazy(() => import('./pages/AccessPage').then((module) => ({ default: module.AccessPage })));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const ModelSettingsPage = lazy(() => import('./pages/ModelSettingsPage').then((module) => ({ default: module.ModelSettingsPage })));
const NewEvaluationPage = lazy(() => import('./pages/NewEvaluationPage').then((module) => ({ default: module.NewEvaluationPage })));
const ObjectionsPage = lazy(() => import('./pages/ObjectionsPage').then((module) => ({ default: module.ObjectionsPage })));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage').then((module) => ({ default: module.ReviewsPage })));
const SetPasswordPage = lazy(() => import('./pages/SetPasswordPage').then((module) => ({ default: module.SetPasswordPage })));
const TutorsPage = lazy(() => import('./pages/TutorsPage').then((module) => ({ default: module.TutorsPage })));

const knownPaths = new Set(['/', '/login', '/set-password', '/reviews', '/objections', '/evaluations/new', '/analytics', '/tutors', '/access', '/access-control', '/model-settings']);

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
  if (pathname === '/set-password') return <SetPasswordPage />;

  let page: ReactNode = (
    <ProtectedRoute requiredPermission="view_dashboard">
      <DashboardPage />
    </ProtectedRoute>
  );
  if (pathname === '/reviews') {
    page = (
      <ProtectedRoute requiredPermission="view_reviews">
        <ReviewsPage />
      </ProtectedRoute>
    );
  }
  if (pathname === '/objections') {
    page = (
      <ProtectedRoute requiredPermission="view_objections">
        <ObjectionsPage />
      </ProtectedRoute>
    );
  }
  if (pathname === '/evaluations/new') {
    page = (
      <ProtectedRoute allowedRoles={['super_admin', 'admin', 'qtl', 'qc']} requiredPermission="create_evaluation">
        <NewEvaluationPage />
      </ProtectedRoute>
    );
  }
  if (pathname === '/analytics') {
    page = (
      <ProtectedRoute requiredPermission="view_analytics">
        <AnalyticsPage />
      </ProtectedRoute>
    );
  }
  if (pathname === '/tutors') {
    page = (
      <ProtectedRoute requiredPermission="manage_tutors">
        <TutorsPage />
      </ProtectedRoute>
    );
  }
  if (pathname === '/model-settings') {
    page = (
      <ProtectedRoute requiredPermission="manage_model_settings">
        <ModelSettingsPage />
      </ProtectedRoute>
    );
  }
  if (pathname === '/access') {
    page = (
      <ProtectedRoute requiredPermission="manage_people">
        <AccessPage />
      </ProtectedRoute>
    );
  }
  if (pathname === '/access-control') {
    page = (
      <ProtectedRoute allowedRoles={['super_admin']} requiredPermission="manage_access">
        <AccessControlPage />
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
