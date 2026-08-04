import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { AppLink } from '../lib/router';
import { supabase } from '../lib/supabase';

type DashboardStats = {
  reviews: number;
  published: number;
  openFlags: number;
  openObjections: number;
};

const emptyStats: DashboardStats = { reviews: 0, published: 0, openFlags: 0, openObjections: 0 };

const statIcons = {
  reviews: <svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg>,
  published: <svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-6" /></svg>,
  flags: <svg viewBox="0 0 24 24"><path d="M5 21V4m0 1h11l-2 4 2 4H5" /></svg>,
  objections: <svg viewBox="0 0 24 24"><path d="M4 5h16v12H9l-5 4zM9 9h6M9 13h4" /></svg>,
};

export function DashboardPage() {
  const { profile } = useAuth();
  const [stats, setStats] = useState(emptyStats);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadStats() {
      setLoading(true);
      setError('');

      const [reviewsResult, publishedResult, flagsResult, objectionsResult] = await Promise.all([
        supabase.from('reviews').select('*', { count: 'exact', head: true }),
        supabase.from('reviews').select('*', { count: 'exact', head: true }).eq('status', 'published'),
        supabase.from('review_flags').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('objections').select('*', { count: 'exact', head: true }).in('status', ['submitted', 'under_review', 'awaiting_qtl']),
      ]);

      const firstError = reviewsResult.error || publishedResult.error || flagsResult.error || objectionsResult.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setStats({
          reviews: reviewsResult.count ?? 0,
          published: publishedResult.count ?? 0,
          openFlags: flagsResult.count ?? 0,
          openObjections: objectionsResult.count ?? 0,
        });
      }
      setLoading(false);
    }

    void loadStats();
  }, []);

  const isTutor = profile?.role === 'tutor';
  const canEvaluate = profile?.role === 'qc' || profile?.role === 'qtl' || profile?.role === 'admin' || profile?.role === 'super_admin';

  return (
    <div className="page-stack">
      <section className="dashboard-hero">
        <div className="hero-content">
          <p className="eyebrow light">B2B Offline Quality</p>
          <h1>{isTutor ? `Welcome, ${profile?.full_name}` : 'One observation. Four clear outputs.'}</h1>
          <p>{isTutor
            ? 'Track your published reviews, development priorities, compliance status, and objection decisions.'
            : 'Capture context fairly, measure student learning, classify compliance separately, and turn evidence into one focused development action.'}</p>
          <div className="hero-actions">
            {canEvaluate && <AppLink className="button button-white" to="/evaluations/new">Start new evaluation</AppLink>}
            <AppLink className="button button-outline-light" to="/reviews">Open reviews</AppLink>
          </div>
        </div>

        <div className="hero-model-card">
          <div className="model-card-head"><span>Observation output</span><strong>4 signals</strong></div>
          <div className="model-grid">
            <div><span className="model-blue">01</span><strong>Context</strong><small>Unscored fairness</small></div>
            <div><span className="model-orange">02</span><strong>Teaching</strong><small>Weighted score</small></div>
            <div><span className="model-green">03</span><strong>Compliance</strong><small>Separate status</small></div>
            <div><span className="model-purple">04</span><strong>Action</strong><small>One priority</small></div>
          </div>
        </div>
      </section>

      {error && <div className="alert alert-error">Unable to load dashboard: {error}</div>}

      <section className="stat-grid dashboard-stats" aria-busy={loading}>
        <article className="stat-card stat-blue">
          <div className="stat-card-top"><div className="stat-icon">{statIcons.reviews}</div><span>Visible reviews</span></div>
          <strong>{loading ? '—' : stats.reviews}</strong>
          <small>All records available to your role</small>
        </article>
        <article className="stat-card stat-green">
          <div className="stat-card-top"><div className="stat-icon">{statIcons.published}</div><span>Published reviews</span></div>
          <strong>{loading ? '—' : stats.published}</strong>
          <small>Ready for tutor visibility</small>
        </article>
        <article className="stat-card stat-orange">
          <div className="stat-card-top"><div className="stat-icon">{statIcons.flags}</div><span>Active flags</span></div>
          <strong>{loading ? '—' : stats.openFlags}</strong>
          <small>Yellow and red compliance items</small>
        </article>
        <article className="stat-card stat-purple">
          <div className="stat-card-top"><div className="stat-icon">{statIcons.objections}</div><span>Open objections</span></div>
          <strong>{loading ? '—' : stats.openObjections}</strong>
          <small>Awaiting review or approval</small>
        </article>
      </section>

      <section className="content-grid dashboard-content">
        <article className="panel workflow-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Observation journey</p><h2>From evidence to action</h2><p>A consistent process protects fairness and makes the final result easy to explain.</p></div>
            <span className="section-badge">5 steps</span>
          </div>
          <div className="workflow-grid">
            <div><span>1</span><strong>Prepare</strong><p>Confirm lesson, level, school, and scope.</p></div>
            <div><span>2</span><strong>Observe</strong><p>Capture student behavior, tutor practice, and evidence.</p></div>
            <div><span>3</span><strong>Close</strong><p>Check the learning outcome and final student work.</p></div>
            <div><span>4</span><strong>Submit</strong><p>Rate six dimensions and classify compliance separately.</p></div>
            <div><span>5</span><strong>Follow up</strong><p>Share one priority action and schedule the next check.</p></div>
          </div>
        </article>

        <article className="panel principle-panel">
          <div className="principle-icon"><svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7zM8 12l2.5 2.5L16 9" /></svg></div>
          <p className="eyebrow">Core rule</p>
          <h2>Score only what was directly observed.</h2>
          <p>When part of a session is not observed, record the scope and exclude those criteria instead of guessing.</p>
          <div className="principle-note"><span /> Evidence is captured during the visit—not reconstructed afterward.</div>
        </article>
      </section>
    </div>
  );
}
