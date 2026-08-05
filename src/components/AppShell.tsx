import type { PropsWithChildren, ReactNode } from 'react';
import ischoolLogo from '../assets/ischool-logo-official.svg';
import { useAuth } from '../auth/AuthProvider';
import { hasPermission } from '../lib/permissions';
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
  tutors: <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  settings: <svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" /></svg>,
  access: <svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7zM9 12l2 2 4-5" /></svg>,
  control: <svg viewBox="0 0 24 24"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h7M15 18h5M13 3v6M8 9v6M12 15v6" /></svg>,
  logout: <svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5M15 12H3m11-8h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /></svg>,
};

function formatRole(role: string | undefined) {
  if (!role) return 'User';
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'admin') return 'Management';
  if (role === 'qtl') return 'Quality Team Lead';
  if (role === 'qc') return 'Quality Control';
  return 'Tutor';
}

export function AppShell({ children }: PropsWithChildren) {
  const { profile, signOut } = useAuth();
  const showDashboard = hasPermission(profile, 'view_dashboard');
  const showEvaluation = hasPermission(profile, 'create_evaluation');
  const showReviews = hasPermission(profile, 'view_reviews');
  const showObjections = hasPermission(profile, 'view_objections');
  const showAnalytics = hasPermission(profile, 'view_analytics');
  const showTutors = hasPermission(profile, 'manage_tutors');
  const showModelSettings = hasPermission(profile, 'manage_model_settings');
  const showPeople = hasPermission(profile, 'manage_people');
  const showAccessControl = hasPermission(profile, 'manage_access');
  const showManagement = showTutors || showModelSettings || showPeople || showAccessControl;
  const initials = (profile?.full_name || 'User')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="app-shell elegant-shell">
      <aside className="sidebar elegant-sidebar">
        <div className="elegant-brand-block">
          <img src={ischoolLogo} alt="iSchool" className="elegant-brand-logo" />
          <div>
            <strong>B2B Offline</strong>
            <span>Quality Workspace</span>
          </div>
        </div>

        <div className="sidebar-label elegant-sidebar-label">Workspace</div>
        <nav className="nav-list elegant-nav" aria-label="Primary navigation">
          {showDashboard && <NavItem to="/" exact label="Dashboard" icon={icons.dashboard} />}
          {showEvaluation && <NavItem to="/evaluations/new" label="New Evaluation" icon={icons.evaluation} />}
          {showReviews && <NavItem to="/reviews" label="Reviews" icon={icons.reviews} />}
          {showObjections && <NavItem to="/objections" label="Evaluation Re-consideration" icon={icons.objections} />}
          {showAnalytics && <NavItem to="/analytics" label="Analytics" icon={icons.analytics} />}
        </nav>

        {showManagement && <div className="sidebar-label elegant-sidebar-label elegant-sidebar-label-secondary">Management</div>}
        {showManagement && (
          <nav className="nav-list elegant-nav" aria-label="Management navigation">
            {showTutors && <NavItem to="/tutors" label="Tutors" icon={icons.tutors} />}
            {showModelSettings && <NavItem to="/model-settings" label="Model Settings" icon={icons.settings} />}
            {showPeople && <NavItem to="/access" label="People & Access" icon={icons.access} />}
            {showAccessControl && <NavItem to="/access-control" label="Access Control" icon={icons.control} />}
          </nav>
        )}

        <div className="elegant-sidebar-footer">
          <div className="elegant-user-card">
            <div className="user-avatar elegant-user-avatar">{initials || 'U'}</div>
            <div>
              <strong>{profile?.full_name || 'User'}</strong>
              <span>{formatRole(profile?.role)}</span>
            </div>
          </div>
          <button className="elegant-signout" onClick={() => void signOut()}>
            <span className="nav-icon" aria-hidden="true">{icons.logout}</span>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-content elegant-main-content">
        <div className="topbar elegant-topbar">
          <div>
            <span className="topbar-kicker">iSchool Quality Operations</span>
            <strong>B2B Offline Evaluation Workspace</strong>
          </div>
          <span className="elegant-role-chip">{formatRole(profile?.role)}</span>
        </div>
        {children}
      </main>
    </div>
  );
}
