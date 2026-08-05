import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { AppLink } from '../lib/router';
import { supabase } from '../lib/supabase';

type DashboardStats = {
  reviews: number;
  published: number;
  openFlags: number;
  openObjections: number;
  activeTutors: number;
};

const emptyStats: DashboardStats = {
  reviews: 0,
  published: 0,
  openFlags: 0,
  openObjections: 0,
  activeTutors: 0,
};

const icons = {
  reviews: <svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg>,
  published: <svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-6" /></svg>,
  objections: <svg viewBox="0 0 24 24"><path d="M4 5h16v12H9l-5 4zM9 9h6M9 13h4" /></svg>,
  tutors: <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  evaluation: <svg viewBox="0 0 24 24"><path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4h6M9 11h6M9 15h4" /></svg>,
  people: <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1h6m-3-3v6" /></svg>,
};

function firstName(name: string | undefined) {
  return name?.trim().split(/\s+/)[0] || 'there';
}

export function DashboardPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadStats() {
      setLoading(true);
      setError('');

      const [reviewsResult, publishedResult, flagsResult, objectionsResult, tutorsResult] = await Promise.all([
        supabase.from('reviews').select('*', { count: 'exact', head: true }),
        supabase.from('reviews').select('*', { count: 'exact', head: true }).eq('status', 'published'),
        supabase.from('review_flags').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('objections').select('*', { count: 'exact', head: true }).in('status', ['submitted', 'under_review', 'awaiting_qtl']),
        supabase.from('tutors').select('*', { count: 'exact', head: true }).eq('is_active', true),
      ]);

      const firstError = reviewsResult.error || publishedResult.error || flagsResult.error || objectionsResult.error || tutorsResult.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setStats({
          reviews: reviewsResult.count ?? 0,
          published: publishedResult.count ?? 0,
          openFlags: flagsResult.count ?? 0,
          openObjections: objectionsResult.count ?? 0,
          activeTutors: tutorsResult.count ?? 0,
        });
      }
      setLoading(false);
    }

    void loadStats();
  }, []);

  const canEvaluate = profile?.role === 'qc' || profile?.role === 'qtl' || profile?.role === 'admin' || profile?.role === 'super_admin';
  const canManage = profile?.role === 'qtl' || profile?.role === 'admin' || profile?.role === 'super_admin';
  const isSuperAdmin = profile?.role === 'super_admin';

  return (
    <div className="page-stack elegant-dashboard">
      <header className="elegant-dashboard-header">
        <div>
          <span className="elegant-page-kicker">B2B Offline Quality</span>
          <h1>Welcome, {firstName(profile?.full_name)}</h1>
          <p>Review the operation, continue evaluations, and keep follow-up actions clear.</p>
        </div>
        <div className="elegant-header-actions">
          {canEvaluate && <AppLink className="button button-primary" to="/evaluations/new">New evaluation</AppLink>}
          <AppLink className="button elegant-secondary-button" to="/reviews">View reviews</AppLink>
        </div>
      </header>

      {error && <div className="alert alert-error">Unable to load dashboard: {error}</div>}

      <section className="elegant-stat-grid" aria-busy={loading}>
        <article className="elegant-stat-card">
          <span className="elegant-stat-icon elegant-stat-blue">{icons.reviews}</span>
          <div><small>Visible reviews</small><strong>{loading ? '—' : stats.reviews}</strong></div>
        </article>
        <article className="elegant-stat-card">
          <span className="elegant-stat-icon elegant-stat-green">{icons.published}</span>
          <div><small>Published</small><strong>{loading ? '—' : stats.published}</strong></div>
        </article>
        <article className="elegant-stat-card">
          <span className="elegant-stat-icon elegant-stat-orange">{icons.objections}</span>
          <div><small>Open objections</small><strong>{loading ? '—' : stats.openObjections}</strong></div>
        </article>
        <article className="elegant-stat-card">
          <span className="elegant-stat-icon elegant-stat-indigo">{icons.tutors}</span>
          <div><small>Active tutors</small><strong>{loading ? '—' : stats.activeTutors}</strong></div>
        </article>
      </section>

      <section className="elegant-dashboard-grid">
        <article className="panel elegant-quick-panel">
          <div className="elegant-panel-heading">
            <div>
              <span className="elegant-page-kicker">Quick actions</span>
              <h2>Continue your work</h2>
            </div>
          </div>
          <div className="elegant-action-list">
            {canEvaluate && (
              <AppLink to="/evaluations/new" className="elegant-action-card">
                <span className="elegant-action-icon">{icons.evaluation}</span>
                <div><strong>Start a new evaluation</strong><small>Choose a tutor and capture the review.</small></div>
                <span className="elegant-action-arrow">›</span>
              </AppLink>
            )}
            <AppLink to="/objections" className="elegant-action-card">
              <span className="elegant-action-icon">{icons.objections}</span>
              <div><strong>Review objections</strong><small>{stats.openObjections} currently open.</small></div>
              <span className="elegant-action-arrow">›</span>
            </AppLink>
            {canManage && (
              <AppLink to="/tutors" className="elegant-action-card">
                <span className="elegant-action-icon">{icons.tutors}</span>
                <div><strong>Manage tutors</strong><small>Add tutors, teams, and school branches.</small></div>
                <span className="elegant-action-arrow">›</span>
              </AppLink>
            )}
            {isSuperAdmin && (
              <AppLink to="/access" className="elegant-action-card">
                <span className="elegant-action-icon">{icons.people}</span>
                <div><strong>Add people and access</strong><small>Create Management and QC accounts.</small></div>
                <span className="elegant-action-arrow">›</span>
              </AppLink>
            )}
          </div>
        </article>

        <article className="panel elegant-summary-panel">
          <div className="elegant-panel-heading">
            <div>
              <span className="elegant-page-kicker">Quality snapshot</span>
              <h2>Current operation</h2>
            </div>
          </div>
          <div className="elegant-summary-list">
            <div><span>Published rate</span><strong>{stats.reviews ? `${Math.round((stats.published / stats.reviews) * 100)}%` : '0%'}</strong></div>
            <div><span>Active compliance flags</span><strong>{loading ? '—' : stats.openFlags}</strong></div>
            <div><span>Open objections</span><strong>{loading ? '—' : stats.openObjections}</strong></div>
            <div><span>Active tutor directory</span><strong>{loading ? '—' : stats.activeTutors}</strong></div>
          </div>
          <p className="elegant-summary-note">Only directly observed evidence should affect the teaching score.</p>
        </article>
      </section>
    </div>
  );
}
