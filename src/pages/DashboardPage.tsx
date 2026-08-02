import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

type DashboardStats = {
  reviews: number;
  published: number;
  openFlags: number;
  openObjections: number;
};

const emptyStats: DashboardStats = { reviews: 0, published: 0, openFlags: 0, openObjections: 0 };

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

  const roleMessage = profile?.role === 'tutor'
    ? 'Track your published feedback, active flags, and objection decisions.'
    : 'Monitor evaluation coverage, compliance, and review follow-up.';

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Quality overview</p>
          <h1>Welcome, {profile?.full_name}</h1>
          <p>{roleMessage}</p>
        </div>
      </header>

      {error && <div className="alert alert-error">Unable to load dashboard: {error}</div>}

      <section className="stat-grid" aria-busy={loading}>
        <article className="stat-card"><span>Visible reviews</span><strong>{loading ? '—' : stats.reviews}</strong></article>
        <article className="stat-card"><span>Published reviews</span><strong>{loading ? '—' : stats.published}</strong></article>
        <article className="stat-card"><span>Active flags</span><strong>{loading ? '—' : stats.openFlags}</strong></article>
        <article className="stat-card"><span>Open objections</span><strong>{loading ? '—' : stats.openObjections}</strong></article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Workflow</p><h2>Review lifecycle</h2></div>
          </div>
          <ol className="timeline">
            <li><strong>Evaluation drafted</strong><span>QC records scores, evidence, and timestamps.</span></li>
            <li><strong>Quality validation</strong><span>QTL or Admin validates the review before publishing.</span></li>
            <li><strong>Tutor review</strong><span>The tutor sees the published review and any flags.</span></li>
            <li><strong>Evidence-based objection</strong><span>A different QC reviews the objection; QTL approves flag removal.</span></li>
          </ol>
        </article>

        <article className="panel accent-panel">
          <p className="eyebrow">Data integrity</p>
          <h2>Every decision keeps its history</h2>
          <p>Scores, flags, objections, status changes, and approvals are designed to be stored as auditable records rather than overwritten.</p>
        </article>
      </section>
    </div>
  );
}
