import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Overview = {
  total_reviews: number;
  published_reviews: number;
  average_teaching_score: number | null;
  outcomes_fully_achieved_percentage: number | null;
  follow_ups_required: number;
  active_yellow_flags: number;
  active_red_flags: number;
  external_causes_recorded: number;
  open_objections: number;
};

type DimensionMetric = {
  criterion_code: string;
  dimension_title: string;
  weight_percentage: number;
  average_rating: number | null;
  average_percentage: number | null;
  response_count: number;
};

type ComplianceMetric = {
  compliance_result: string;
  result_count: number;
};

export function AnalyticsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dimensions, setDimensions] = useState<DimensionMetric[]>([]);
  const [complianceMix, setComplianceMix] = useState<ComplianceMetric[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadAnalytics() {
      const [overviewResult, dimensionsResult, complianceResult] = await Promise.all([
        supabase.from('analytics_overview').select('*').single(),
        supabase.from('analytics_dimensions').select('*').order('average_percentage', { ascending: true }),
        supabase.from('analytics_compliance_mix').select('*').order('result_count', { ascending: false }),
      ]);

      const firstError = overviewResult.error || dimensionsResult.error || complianceResult.error;
      if (firstError) setError(firstError.message);
      else {
        setOverview(overviewResult.data as Overview);
        setDimensions((dimensionsResult.data ?? []) as DimensionMetric[]);
        setComplianceMix((complianceResult.data ?? []) as ComplianceMetric[]);
      }
    }

    void loadAnalytics();
  }, []);

  const activeFlags = (overview?.active_yellow_flags ?? 0) + (overview?.active_red_flags ?? 0);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Leadership analytics</p>
          <h1>Offline Quality Dashboard</h1>
          <p>Teaching quality, learning outcomes, compliance severity, and follow-up trends from the same observation data.</p>
        </div>
      </header>
      {error && <div className="alert alert-error">{error}</div>}

      <section className="stat-grid">
        <article className="stat-card"><span>Total reviews</span><strong>{overview?.total_reviews ?? '—'}</strong></article>
        <article className="stat-card"><span>Average teaching score</span><strong>{overview?.average_teaching_score === null || overview?.average_teaching_score === undefined ? '—' : `${overview.average_teaching_score}%`}</strong></article>
        <article className="stat-card"><span>Outcomes fully achieved</span><strong>{overview?.outcomes_fully_achieved_percentage === null || overview?.outcomes_fully_achieved_percentage === undefined ? '—' : `${overview.outcomes_fully_achieved_percentage}%`}</strong></article>
        <article className="stat-card"><span>Follow-ups required</span><strong>{overview?.follow_ups_required ?? '—'}</strong></article>
        <article className="stat-card"><span>Active flags</span><strong>{overview ? activeFlags : '—'}</strong></article>
        <article className="stat-card"><span>Open objections</span><strong>{overview?.open_objections ?? '—'}</strong></article>
      </section>

      <section className="content-grid">
        <article className="panel table-panel">
          <div className="panel-heading"><div><p className="eyebrow">Teaching quality</p><h2>Dimension averages</h2></div></div>
          {dimensions.length === 0 ? <div className="empty-state">No scored dimensions yet.</div> : (
            <div className="metric-list">
              {dimensions.map((dimension) => {
                const percentage = Math.round(dimension.average_percentage ?? 0);
                return (
                  <div className="metric-row" key={dimension.criterion_code}>
                    <div><strong>{dimension.dimension_title}</strong><span>{dimension.weight_percentage}% weight · {dimension.response_count} observation(s)</span></div>
                    <div className="metric-bar"><span style={{ width: `${percentage}%` }} /></div>
                    <strong>{dimension.average_rating?.toFixed(2) ?? '—'} / 5</strong>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Separate result</p><h2>Compliance mix</h2></div></div>
          {complianceMix.length === 0 ? <div className="empty-state">No compliance outcomes yet.</div> : (
            <div className="metric-list">
              {complianceMix.map((item) => (
                <div className="metric-row" key={item.compliance_result}>
                  <div><strong>{item.compliance_result.replaceAll('_', ' ')}</strong><span>Recorded outcomes</span></div>
                  <strong>{item.result_count}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="content-grid">
            <div><strong>Yellow flags</strong><p>{overview?.active_yellow_flags ?? '—'}</p></div>
            <div><strong>Red flags</strong><p>{overview?.active_red_flags ?? '—'}</p></div>
            <div><strong>External causes</strong><p>{overview?.external_causes_recorded ?? '—'}</p></div>
          </div>
        </article>
      </section>
    </div>
  );
}
