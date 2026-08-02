import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export function AppShell() {
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
          <NavLink to="/" end>Dashboard</NavLink>
          {canEvaluate && <NavLink to="/evaluations/new">New Evaluation</NavLink>}
          <NavLink to="/reviews">Reviews</NavLink>
          <NavLink to="/objections">Objections</NavLink>
          {canManage && <NavLink to="/analytics">Analytics</NavLink>}
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
        <Outlet />
      </main>
    </div>
  );
}
