import type { PropsWithChildren } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { AppLink } from '../lib/router';

export function AppShell({ children }: PropsWithChildren) {
  const { profile, signOut } = useAuth();
  const canEvaluate = profile?.role === 'qc' || profile?.role === 'qtl' || profile?.role === 'admin' || profile?.role === 'super_admin';
  const canManage = profile?.role === 'qtl' || profile?.role === 'admin' || profile?.role === 'super_admin';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">iS</div>
          <div>
            <strong>Quality Platform</strong>
            <span>Student-centered reviews</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary navigation">
          <AppLink to="/" exact>Dashboard</AppLink>
          {canEvaluate && <AppLink to="/evaluations/new">New Evaluation</AppLink>}
          <AppLink to="/reviews">Reviews</AppLink>
          <AppLink to="/objections">Objections</AppLink>
          {canManage && <AppLink to="/analytics">Analytics</AppLink>}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <span>{profile?.full_name || 'User'}</span>
            <small>{profile?.role.replace('_', ' ')}</small>
          </div>
          <button className="button button-ghost" onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
