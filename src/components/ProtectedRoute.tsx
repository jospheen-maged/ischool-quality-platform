import type { PropsWithChildren } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import type { UserRole } from '../types';

type ProtectedRouteProps = PropsWithChildren<{
  allowedRoles?: UserRole[];
}>;

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="screen-center">Loading your workspace…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!profile?.is_active) {
    return <div className="screen-center">Your account is inactive. Please contact an administrator.</div>;
  }

  if (allowedRoles && (!profile || !allowedRoles.includes(profile.role))) {
    return <Navigate to="/" replace />;
  }

  return children;
}
