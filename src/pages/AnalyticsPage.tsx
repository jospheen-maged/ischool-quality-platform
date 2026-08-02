import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Overview = {
  total_reviews: number;
  published_reviews: number;
  average_score_percentage: number | null;
  active_flags: number;
  open_objections: number;
};

type CriterionMetric = {
  criterion_code: string;
  criterion_title: string;
  average_score: number | null;
  response_count: number;
};

export function AnalyticsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [criteria, setCriteria] = useState<CriterionMetric[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadAnalytics() {
      const [overviewResult, criteriaResult] = await Promise.all([
        supabase.from('analytics_overview').select('*').single(),
        supabase.from('analytics_criteria').select('*').order('average_score', { ascending: true }),
      ]);

      const firstError = overviewResult.error || criteriaResult.error;
      if (firstError) setError(firstError.message);
      else {
        setOverview(overviewResult.data as Overview);
        setCriteria((criteriaResult.data ?? []) as CriterionMetric[]);
      }
    }

    void loadAnalytics();
  }, []);

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Quality intelligence</p><h1>Analytics</h1><p>Live indicators calculated from the review, flag, and objection database.</p></div></header>
      {error && <div className="alert alert-error">{error}</div>}

      <section className="stat-grid">
        <article className="stat-card"><span>Total reviews</span><strong>{overview?.total_reviews ?? '—'}</strong></article>
        <article className="stat-card"><span>Published</span><strong>{overview?.published_reviews ?? '—'}</strong></article>
        <article className="stat-card"><span>Average score</span><strong>{overview?.average_score_percentage === null || overview?.average_score_percentage === undefined ? '—' : `${overview.average_score_percentage}%`}</strong></article>
        <article className="stat-card"><span>Active flags</span><strong>{overview?.active_flags ?? '—'}</strong></article>
        <article className="stat-card"><span>Open objections</span><strong>{overview?.open_objections ?? '—'}</strong></article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading"><div><p className="eyebrow">Learning environment</p><h2>Average score by criterion</h2></div></div>
        {criteria.length === 0 ? <div className="empty-state">No scored criteria yet.</div> : (
          <div className="metric-list">
            {criteria.map((criterion) => {
              const percentage = criterion.average_score ? Math.round((criterion.average_score / 5) * 100) : 0;
              return <div className="metric-row" key={criterion.criterion_code}><div><strong>{criterion.criterion_title}</strong><span>{criterion.response_count} response(s)</span></div><div className="metric-bar"><span style={{ width: `${percentage}%` }} /></div><strong>{criterion.average_score?.toFixed(2) ?? '—'} / 5</strong></div>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
