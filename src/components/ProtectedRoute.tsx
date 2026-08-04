import { useEffect, type PropsWithChildren } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useRouter } from '../lib/router';
import type { UserRole } from '../types';

type ProtectedRouteProps = PropsWithChildren<{
  allowedRoles?: UserRole[];
}>;

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();
  const { pathname, navigate } = useRouter();
  const isRoleAllowed = !allowedRoles || Boolean(profile && allowedRoles.includes(profile.role));

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/login', { replace: true, state: { from: pathname } });
      return;
    }
    if (!isRoleAllowed) navigate('/', { replace: true });
  }, [isRoleAllowed, loading, navigate, pathname, user]);

  if (loading || !user || !isRoleAllowed) {
    return <div className="screen-center">Loading your workspace…</div>;
  }

  if (!profile?.is_active) {
    return <div className="screen-center">Your account is inactive. Please contact an administrator.</div>;
  }

  return children;
}
