import { useEffect, type PropsWithChildren } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { hasPermission, type PermissionKey } from '../lib/permissions';
import { useRouter } from '../lib/router';
import type { UserRole } from '../types';

type ProtectedRouteProps = PropsWithChildren<{
  allowedRoles?: UserRole[];
  requiredPermission?: PermissionKey;
}>;

export function ProtectedRoute({ children, allowedRoles, requiredPermission }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();
  const { pathname, navigate } = useRouter();
  const isRoleAllowed = !allowedRoles || Boolean(profile && allowedRoles.includes(profile.role));
  const isPermissionAllowed = !requiredPermission || hasPermission(profile, requiredPermission);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate('/login', { replace: true, state: { from: pathname } });
  }, [loading, navigate, pathname, user]);

  if (loading || !user) {
    return <div className="screen-center">Loading your workspace…</div>;
  }

  if (!profile?.is_active) {
    return <div className="screen-center">Your account is inactive. Please contact an administrator.</div>;
  }

  if (!isRoleAllowed || !isPermissionAllowed) {
    return (
      <div className="screen-center">
        <div className="access-denied-card">
          <strong>Access is not enabled</strong>
          <p>This page is hidden by your workspace permissions. Contact the Super Admin when access is required.</p>
        </div>
      </div>
    );
  }

  return children;
}
