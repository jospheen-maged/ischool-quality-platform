import type { PropsWithChildren, ReactNode } from 'react';
import ischoolLogo from '../assets/ischool-logo.svg';
import { useAuth } from '../auth/AuthProvider';
import { AppLink } from '../lib/router';

type NavItemProps = {
  to: string;
  label: string;
  exact?: boolean;
  icon: ReactNode;
};

function NavItem({ to, label, exact, icon }: NavItemProps) {
  return (
    <AppLink to={to} exact={exact}>
      <span className="nav-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </AppLink>
  );
}

const icons = {
  dashboard: <svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v10h-6zM4 14h6v6H4zM14 18h6v2h-6z" /></svg>,
  evaluation: <svg viewBox="0 0 24 24"><path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4h6M9 11h6M9 15h4" /></svg>,
  reviews: <svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM8 9h8M8 13h5" /></svg>,
  objections: <svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5m0 3h.01" /></svg>,
  analytics: <svg viewBox="0 0 24 24"><path d="M5 20V10m7 10V4m7 16v-7" /></svg>,
};

export function AppShell({ children }: PropsWithChildren) {
  const { profile, signOut } = useAuth();
  const canEvaluate = profile?.role === 'qc' || profile?.role === 'qtl' || profile?.role === 'admin' || profile?.role === 'super_admin';
  const canManage = profile?.role === 'qtl' || profile?.role === 'admin' || profile?.role === 'super_admin';
  const initials = (profile?.full_name || 'User')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-logo-wrap">
            <img src={ischoolLogo} alt="iSchool" className="brand-logo" />
          </div>
          <div className="brand-product">
            <strong>B2B Offline</strong>
            <span>Quality Evaluation</span>
          </div>
        </div>

        <div className="sidebar-label">Workspace</div>
        <nav className="nav-list" aria-label="Primary navigation">
          <NavItem to="/" exact label="Dashboard" icon={icons.dashboard} />
          {canEvaluate && <NavItem to="/evaluations/new" label="New Evaluation" icon={icons.evaluation} />}
          <NavItem to="/reviews" label="Reviews" icon={icons.reviews} />
          <NavItem to="/objections" label="Objections" icon={icons.objections} />
          {canManage && <NavItem to="/analytics" label="Analytics" icon={icons.analytics} />}
        </nav>

        <div className="sidebar-insight">
          <span className="insight-dot" />
          <div>
            <strong>Evidence first</strong>
            <p>Context, teaching quality, compliance, then action.</p>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials || 'U'}</div>
            <div>
              <span>{profile?.full_name || 'User'}</span>
              <small>{profile?.role.replace('_', ' ')}</small>
            </div>
          </div>
          <button className="button button-ghost" onClick={() => void signOut()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3m11-8h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /></svg>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="topbar">
          <div>
            <span className="topbar-kicker">iSchool Quality Operations</span>
            <strong>B2B Offline Evaluation Workspace</strong>
          </div>
          <div className="topbar-status"><span /> Secure workspace</div>
        </div>
        {children}
      </main>
    </div>
  );
}
