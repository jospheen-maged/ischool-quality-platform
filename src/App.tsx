import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { AppShell } from './components/AppShell';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NewEvaluationPage } from './pages/NewEvaluationPage';
import { ObjectionsPage } from './pages/ObjectionsPage';
import { ReviewsPage } from './pages/ReviewsPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="reviews" element={<ReviewsPage />} />
            <Route path="objections" element={<ObjectionsPage />} />
            <Route
              path="evaluations/new"
              element={
                <ProtectedRoute allowedRoles={['super_admin', 'admin', 'qtl', 'qc']}>
                  <NewEvaluationPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="analytics"
              element={
                <ProtectedRoute allowedRoles={['super_admin', 'admin', 'qtl']}>
                  <AnalyticsPage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
