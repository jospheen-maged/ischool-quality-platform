import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import '../analytics-dashboard.css';
import '../evaluation-model-v2.css';

type ReviewRecord = {
  id: string;
  tutor_id: string | null;
  evaluator_id: string | null;
  project_id: string | null;
  cycle_id: string | null;
  evaluation_mode: 'normal_session' | 'session_12';
  project_section_title: string | null;
  session_date: string | null;
  session_topic: string | null;
  school_branch: string | null;
  status: string;
  score_percentage: number | null;
  teaching_percentage: number | null;
  compliance_percentage: number | null;
  project_percentage: number | null;
  learning_outcome_status: string;
  follow_up_status: string;
  created_at: string;
  tutor: { full_name: string; employee_code: string } | null;
  evaluator: { full_name: string } | null;
  project: { id: string; name: string } | null;
  cycle: { id: string; name: string } | null;
};
type ScoreRecord = {
  review_id: string;
  numeric_score: number | null;
  compliance_result: string | null;
  is_observed: boolean;
  is_repeated: boolean;
  is_external: boolean;
  criterion: { code: string; title: string; criterion_type: 'rating' | 'compliance'; weight_percentage: number } | null;
};
type ProjectEvaluationRecord = {
  review_id: string;
  numeric_score: number | null;
  is_observed: boolean;
  weight_snapshot: number;
  metric: { code: string; title: string; scope: 'normal_session' | 'session_12'; weight_percentage: number } | null;
};
type FlagRecord = {
  id: string;
  review_id: string;
  tutor_id: string;
  level: 'yellow' | 'red';
  is_active: boolean;
  is_repeated: boolean;
  created_at: string;
  criterion: { title: string } | null;
};
type ReconsiderationRecord = {
  id: string;
  review_id: string;
  tutor_id: string;
  status: string;
  decision: string | null;
  created_at: string;
  decision_at: string | null;
};
type Cycle = { id: string; name: string; start_date: string; end_date: string; status: string; is_default: boolean };
type TrendPoint = { key: string; label: string; average: number; reviews: number };
type DimensionSummary = { code: string; title: string; average: number; count: number };
type TutorRisk = { id: string; name: string; code: string; reviews: number; average: number | null; yellow: number; red: number; openCases: number; risk: number };
type QcSummary = { id: string; name: string; reviews: number; published: number; average: number | null };

const openCaseStatuses = new Set(['submitted', 'under_review', 'evidence_required', 'awaiting_qtl']);

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}
function formatPercent(value: number | null, digits = 1) { return value === null ? '—' : `${value.toFixed(digits)}%`; }
function reviewDate(review: ReviewRecord) { return review.session_date || review.created_at.slice(0, 10); }
function shortDate(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

function TrendChart({ points }: { points: TrendPoint[] }) {
  const width = 640;
  const height = 220;
  const paddingX = 30;
  const paddingY = 24;
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? width / 2 : paddingX + (index / (points.length - 1)) * (width - paddingX * 2),
    y: paddingY + ((100 - point.average) / 100) * (height - paddingY * 2),
  }));
  const line = chartPoints.map((point) => `${point.x},${point.y}`).join(' ');
  return <div className="analytics-trend-chart"><svg viewBox={`0 0 ${width} ${height}`}>
    {[20, 40, 60, 80, 100].map((value) => { const y = paddingY + ((100 - value) / 100) * (height - paddingY * 2); return <g key={value}><line x1={paddingX} x2={width - paddingX} y1={y} y2={y} /><text x="2" y={y + 4}>{value}</text></g>; })}
    {line && <polyline className="analytics-trend-line" points={line} />}
    {chartPoints.map((point) => <g key={point.key} className="analytics-trend-point"><circle cx={point.x} cy={point.y} r="5" /><text className="analytics-trend-value" x={point.x} y={point.y - 12}>{point.average.toFixed(0)}%</text><text className="analytics-trend-label" x={point.x} y={height - 3}>{point.label}</text></g>)}
  </svg></div>;
}

export function AnalyticsPage() {
  const { profile } = useAuth();
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [scores, setScores] = useState<ScoreRecord[]>([]);
  const [projectEvaluations, setProjectEvaluations] = useState<ProjectEvaluationRecord[]>([]);
  const [flags, setFlags] = useState<FlagRecord[]>([]);
  const [cases, setCases] = useState<ReconsiderationRecord[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleFilter, setCycleFilter] = useState('all');
  const [orgFilter, setOrgFilter] = useState('all');
  const [tutorFilter, setTutorFilter] = useState('all');
  const [evaluatorFilter, setEvaluatorFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isTutor = profile?.role === 'tutor';

  useEffect(() => {
    async function loadAnalytics() {
      setLoading(true);
      setError('');
      const [reviewsResult, scoresResult, projectResult, flagsResult, casesResult, cyclesResult] = await Promise.all([
        supabase.from('reviews').select('id, tutor_id, evaluator_id, project_id, cycle_id, evaluation_mode, project_section_title, session_date, session_topic, school_branch, status, score_percentage, teaching_percentage, compliance_percentage, project_percentage, learning_outcome_status, follow_up_status, created_at, tutor:tutors(full_name, employee_code), evaluator:profiles!reviews_evaluator_id_fkey(full_name), project:projects(id, name), cycle:evaluation_cycles(id, name)').order('created_at', { ascending: true }).range(0, 4999),
        supabase.from('review_scores').select('review_id, numeric_score, compliance_result, is_observed, is_repeated, is_external, criterion:evaluation_criteria(code, title, criterion_type, weight_percentage)').range(0, 9999),
        supabase.from('review_project_evaluations').select('review_id, numeric_score, is_observed, weight_snapshot, metric:project_evaluation_metrics(code, title, scope, weight_percentage)').range(0, 9999),
        supabase.from('review_flags').select('id, review_id, tutor_id, level, is_active, is_repeated, created_at, criterion:evaluation_criteria(title)').range(0, 4999),
        supabase.from('objections').select('id, review_id, tutor_id, status, decision, created_at, decision_at').range(0, 4999),
        supabase.from('evaluation_cycles').select('id, name, start_date, end_date, status, is_default').order('start_date', { ascending: false }),
      ]);
      const firstError = reviewsResult.error || scoresResult.error || projectResult.error || flagsResult.error || casesResult.error || cyclesResult.error;
      if (firstError) setError(firstError.message);
      else {
        const loadedCycles = (cyclesResult.data ?? []) as Cycle[];
        setReviews((reviewsResult.data ?? []) as unknown as ReviewRecord[]);
        setScores((scoresResult.data ?? []) as unknown as ScoreRecord[]);
        setProjectEvaluations((projectResult.data ?? []) as unknown as ProjectEvaluationRecord[]);
        setFlags((flagsResult.data ?? []) as unknown as FlagRecord[]);
        setCases((casesResult.data ?? []) as ReconsiderationRecord[]);
        setCycles(loadedCycles);
        if (isTutor) {
          const defaultCycle = loadedCycles.find((cycle) => cycle.is_default) ?? loadedCycles.find((cycle) => cycle.status === 'active');
          setCycleFilter(defaultCycle?.id ?? 'all');
        }
      }
      setLoading(false);
    }
    void loadAnalytics();
  }, [isTutor]);

  const baseReviews = useMemo(() => reviews.filter((review) => !isTutor || review.status === 'published'), [isTutor, reviews]);
  const filterOptions = useMemo(() => ({
    orgs: [...new Map(baseReviews.filter((review) => review.project_id && review.project).map((review) => [review.project_id as string, review.project as NonNullable<ReviewRecord['project']>])).entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name)),
    tutors: [...new Map(baseReviews.filter((review) => review.tutor_id && review.tutor).map((review) => [review.tutor_id as string, review.tutor as NonNullable<ReviewRecord['tutor']>])).entries()].sort(([, a], [, b]) => a.full_name.localeCompare(b.full_name)),
    evaluators: [...new Map(baseReviews.filter((review) => review.evaluator_id && review.evaluator).map((review) => [review.evaluator_id as string, review.evaluator as NonNullable<ReviewRecord['evaluator']>])).entries()].sort(([, a], [, b]) => a.full_name.localeCompare(b.full_name)),
  }), [baseReviews]);

  const filteredReviews = useMemo(() => baseReviews.filter((review) => (
    (cycleFilter === 'all' || review.cycle_id === cycleFilter)
    && (isTutor || orgFilter === 'all' || review.project_id === orgFilter)
    && (isTutor || tutorFilter === 'all' || review.tutor_id === tutorFilter)
    && (isTutor || evaluatorFilter === 'all' || review.evaluator_id === evaluatorFilter)
    && (modeFilter === 'all' || review.evaluation_mode === modeFilter)
  )), [baseReviews, cycleFilter, evaluatorFilter, isTutor, modeFilter, orgFilter, tutorFilter]);

  const reviewIds = useMemo(() => new Set(filteredReviews.map((review) => review.id)), [filteredReviews]);
  const filteredScores = useMemo(() => scores.filter((score) => reviewIds.has(score.review_id)), [reviewIds, scores]);
  const filteredProject = useMemo(() => projectEvaluations.filter((item) => reviewIds.has(item.review_id)), [projectEvaluations, reviewIds]);
  const filteredFlags = useMemo(() => flags.filter((flag) => flag.is_active && reviewIds.has(flag.review_id)), [flags, reviewIds]);
  const filteredCases = useMemo(() => cases.filter((item) => reviewIds.has(item.review_id)), [cases, reviewIds]);
  const averageScore = average(filteredReviews.map((review) => review.score_percentage));
  const teachingAverage = average(filteredReviews.map((review) => review.teaching_percentage));
  const complianceAverage = average(filteredReviews.map((review) => review.compliance_percentage));
  const normalProjectAverage = average(filteredReviews.filter((review) => review.evaluation_mode === 'normal_session').map((review) => review.project_percentage));
  const finalProjectAverage = average(filteredReviews.filter((review) => review.evaluation_mode === 'session_12').map((review) => review.project_percentage));
  const yellowFlags = filteredFlags.filter((flag) => flag.level === 'yellow').length;
  const redFlags = filteredFlags.filter((flag) => flag.level === 'red').length;
  const openCases = filteredCases.filter((item) => openCaseStatuses.has(item.status)).length;

  const dimensions = useMemo<DimensionSummary[]>(() => {
    const map = new Map<string, { title: string; total: number; count: number }>();
    filteredScores.forEach((score) => {
      if (score.criterion?.criterion_type !== 'rating' || !score.is_observed || score.numeric_score === null) return;
      const current = map.get(score.criterion.code) ?? { title: score.criterion.title, total: 0, count: 0 };
      current.total += score.numeric_score;
      current.count += 1;
      map.set(score.criterion.code, current);
    });
    return [...map.entries()].map(([code, value]) => ({ code, title: value.title, average: value.total / value.count, count: value.count })).sort((a, b) => a.average - b.average);
  }, [filteredScores]);

  const projectDimensions = useMemo<DimensionSummary[]>(() => {
    const map = new Map<string, { title: string; total: number; count: number }>();
    filteredProject.forEach((item) => {
      if (!item.metric || !item.is_observed || item.numeric_score === null) return;
      const current = map.get(item.metric.code) ?? { title: item.metric.title, total: 0, count: 0 };
      current.total += item.numeric_score;
      current.count += 1;
      map.set(item.metric.code, current);
    });
    return [...map.entries()].map(([code, value]) => ({ code, title: value.title, average: value.total / value.count, count: value.count })).sort((a, b) => a.average - b.average);
  }, [filteredProject]);

  const trend = useMemo<TrendPoint[]>(() => filteredReviews.filter((review) => review.score_percentage !== null).sort((a, b) => reviewDate(a).localeCompare(reviewDate(b))).slice(-12).map((review) => ({ key: review.id, label: shortDate(reviewDate(review)), average: review.score_percentage ?? 0, reviews: 1 })), [filteredReviews]);

  const tutorRisks = useMemo<TutorRisk[]>(() => {
    const map = new Map<string, { name: string; code: string; items: ReviewRecord[] }>();
    filteredReviews.forEach((review) => {
      if (!review.tutor_id || !review.tutor) return;
      const current = map.get(review.tutor_id) ?? { name: review.tutor.full_name, code: review.tutor.employee_code, items: [] };
      current.items.push(review);
      map.set(review.tutor_id, current);
    });
    return [...map.entries()].map(([id, value]) => {
      const ids = new Set(value.items.map((item) => item.id));
      const tutorFlags = filteredFlags.filter((flag) => flag.tutor_id === id && ids.has(flag.review_id));
      const tutorCases = filteredCases.filter((item) => item.tutor_id === id && openCaseStatuses.has(item.status));
      const avg = average(value.items.map((item) => item.score_percentage));
      const yellow = tutorFlags.filter((flag) => flag.level === 'yellow').length;
      const red = tutorFlags.filter((flag) => flag.level === 'red').length;
      return { id, name: value.name, code: value.code, reviews: value.items.length, average: avg, yellow, red, openCases: tutorCases.length, risk: red * 5 + yellow * 2 + tutorCases.length * 2 + (avg !== null && avg < 70 ? 4 : 0) };
    }).sort((a, b) => b.risk - a.risk).slice(0, 8);
  }, [filteredCases, filteredFlags, filteredReviews]);

  const qcPerformance = useMemo<QcSummary[]>(() => {
    const map = new Map<string, { name: string; items: ReviewRecord[] }>();
    filteredReviews.forEach((review) => {
      if (!review.evaluator_id || !review.evaluator) return;
      const current = map.get(review.evaluator_id) ?? { name: review.evaluator.full_name, items: [] };
      current.items.push(review);
      map.set(review.evaluator_id, current);
    });
    return [...map.entries()].map(([id, value]) => ({ id, name: value.name, reviews: value.items.length, published: value.items.filter((item) => item.status === 'published').length, average: average(value.items.map((item) => item.score_percentage)) })).sort((a, b) => b.reviews - a.reviews);
  }, [filteredReviews]);

  function resetFilters() {
    setCycleFilter(isTutor ? (cycles.find((cycle) => cycle.is_default)?.id ?? 'all') : 'all');
    setOrgFilter('all'); setTutorFilter('all'); setEvaluatorFilter('all'); setModeFilter('all');
  }

  if (loading) return <div className="analytics-loading">Building analytics…</div>;

  if (isTutor) {
    return <div className="analytics-page tutor-analytics-page">
      <header className="analytics-header"><div><span className="analytics-kicker">My performance</span><h1>My Quality Analytics</h1><p>Your published reviews, scores, flags, and Evaluation Re-consideration cases only.</p></div></header>
      <section className="analytics-filter-bar tutor-cycle-filter"><label>Evaluation cycle<select value={cycleFilter} onChange={(event) => setCycleFilter(event.target.value)}><option value="all">All Cycles</option>{cycles.map((cycle) => <option value={cycle.id} key={cycle.id}>{cycle.name}</option>)}</select></label><label>Session evaluation<select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}><option value="all">All session types</option><option value="normal_session">Normal Session</option><option value="session_12">Session 12 – Final Project</option></select></label><button className="analytics-reset-button" type="button" onClick={resetFilters}>Reset</button></section>
      {error && <div className="alert alert-error">{error}</div>}
      <section className="tutor-kpi-grid">
        <article><small>My average score</small><strong>{formatPercent(averageScore)}</strong><span>{filteredReviews.length} published reviews</span></article>
        <article><small>Teaching average</small><strong>{formatPercent(teachingAverage)}</strong><span>{dimensions.length} dimensions observed</span></article>
        <article><small>Compliance score</small><strong>{formatPercent(complianceAverage)}</strong><span>{yellowFlags + redFlags} active flags</span></article>
        <article><small>Project Evaluation</small><strong>{formatPercent(normalProjectAverage)}</strong><span>Normal Sessions</span></article>
        <article><small>Final Project</small><strong>{formatPercent(finalProjectAverage)}</strong><span>Session 12</span></article>
        <article><small>Yellow flags</small><strong>{yellowFlags}</strong><span>{filteredFlags.filter((flag) => flag.level === 'yellow' && flag.is_repeated).length} repeated</span></article>
        <article><small>Red flags</small><strong>{redFlags}</strong><span>{filteredFlags.filter((flag) => flag.level === 'red' && flag.is_repeated).length} repeated</span></article>
        <article><small>Open Re-considerations</small><strong>{openCases}</strong><span>{filteredCases.length} cases in total</span></article>
      </section>
      <section className="analytics-two-column analytics-quality-row">
        <article className="analytics-card"><div className="analytics-card-heading"><div><span>Progress</span><h2>Score trend</h2><p>Published evaluations in the selected cycle.</p></div></div>{trend.length ? <TrendChart points={trend} /> : <div className="analytics-empty">No scored reviews in this cycle.</div>}</article>
        <article className="analytics-card"><div className="analytics-card-heading"><div><span>Teaching</span><h2>My dimensions</h2><p>Ordered from the lowest average to the strongest.</p></div></div><div className="analytics-dimension-list">{dimensions.map((item, index) => <div className="analytics-dimension-row" key={item.code}><span className="analytics-rank">{String(index + 1).padStart(2, '0')}</span><div className="analytics-dimension-copy"><strong>{item.title}</strong><small>{item.count} observations</small></div><div className="analytics-dimension-bar"><i style={{ width: `${item.average / 5 * 100}%` }} /></div><strong className="analytics-dimension-score">{item.average.toFixed(2)} <small>/ 5</small></strong></div>)}</div></article>
      </section>
      <section className="analytics-two-column analytics-quality-row">
        <article className="analytics-card"><div className="analytics-card-heading"><div><span>Section 3</span><h2>Project evaluation dimensions</h2><p>Normal Session and Session 12 metrics visible in your published reviews.</p></div></div><div className="analytics-dimension-list">{projectDimensions.length ? projectDimensions.map((item, index) => <div className="analytics-dimension-row" key={item.code}><span className="analytics-rank">{String(index + 1).padStart(2, '0')}</span><div className="analytics-dimension-copy"><strong>{item.title}</strong><small>{item.count} observations</small></div><div className="analytics-dimension-bar"><i style={{ width: `${item.average / 5 * 100}%` }} /></div><strong className="analytics-dimension-score">{item.average.toFixed(2)} <small>/ 5</small></strong></div>) : <div className="analytics-empty">No Section 3 scores yet.</div>}</div></article>
        <article className="analytics-card analytics-table-card"><div className="analytics-card-heading"><div><span>History</span><h2>My review history</h2><p>Only published reviews visible to your tutor account.</p></div></div><div className="analytics-table-wrap"><table><thead><tr><th>Date</th><th>Cycle</th><th>Type</th><th>Overall</th><th>Teaching</th><th>Section 3</th></tr></thead><tbody>{filteredReviews.slice().reverse().map((review) => <tr key={review.id}><td>{reviewDate(review)}</td><td>{review.cycle?.name || '—'}</td><td>{review.evaluation_mode === 'session_12' ? 'Session 12' : 'Normal'}</td><td>{formatPercent(review.score_percentage)}</td><td>{formatPercent(review.teaching_percentage)}</td><td>{formatPercent(review.project_percentage)}</td></tr>)}</tbody></table></div></article>
      </section>
    </div>;
  }

  return <div className="analytics-page">
    <header className="analytics-header"><div><span className="analytics-kicker">Leadership command center</span><h1>Quality Analytics</h1><p>Filter performance by cycle, Org., tutor, evaluator, and evaluation type.</p></div></header>
    <section className="analytics-filter-bar"><label>Cycle<select value={cycleFilter} onChange={(event) => setCycleFilter(event.target.value)}><option value="all">All Cycles</option>{cycles.map((cycle) => <option value={cycle.id} key={cycle.id}>{cycle.name}</option>)}</select></label><label>Org.<select value={orgFilter} onChange={(event) => setOrgFilter(event.target.value)}><option value="all">All Orgs.</option>{filterOptions.orgs.map(([id, org]) => <option value={id} key={id}>{org.name}</option>)}</select></label><label>Tutor<select value={tutorFilter} onChange={(event) => setTutorFilter(event.target.value)}><option value="all">All tutors</option>{filterOptions.tutors.map(([id, tutor]) => <option value={id} key={id}>{tutor.employee_code} — {tutor.full_name}</option>)}</select></label><label>Evaluator<select value={evaluatorFilter} onChange={(event) => setEvaluatorFilter(event.target.value)}><option value="all">All evaluators</option>{filterOptions.evaluators.map(([id, evaluator]) => <option value={id} key={id}>{evaluator.full_name}</option>)}</select></label><label>Evaluation type<select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}><option value="all">All types</option><option value="normal_session">Normal Session</option><option value="session_12">Session 12</option></select></label><button className="analytics-reset-button" type="button" onClick={resetFilters}>Reset</button></section>
    {error && <div className="alert alert-error">{error}</div>}
    <section className="analytics-kpi-grid"><article className="analytics-kpi-card analytics-kpi-blue"><div><small>Total reviews</small><strong>{filteredReviews.length}</strong><p>{filteredReviews.filter((review) => review.status === 'published').length} published</p></div></article><article className="analytics-kpi-card analytics-kpi-indigo"><div><small>Average score</small><strong>{formatPercent(averageScore)}</strong><p>{formatPercent(teachingAverage)} Teaching</p></div></article><article className="analytics-kpi-card analytics-kpi-green"><div><small>Project Evaluation</small><strong>{formatPercent(normalProjectAverage)}</strong><p>Normal Session</p></div></article><article className="analytics-kpi-card analytics-kpi-violet"><div><small>Final Project</small><strong>{formatPercent(finalProjectAverage)}</strong><p>Session 12</p></div></article><article className="analytics-kpi-card analytics-kpi-yellow"><div><small>Yellow flags</small><strong>{yellowFlags}</strong><p>{openCases} open Re-considerations</p></div></article><article className="analytics-kpi-card analytics-kpi-red"><div><small>Red flags</small><strong>{redFlags}</strong><p>{formatPercent(complianceAverage)} Compliance</p></div></article></section>
    <section className="analytics-two-column analytics-quality-row"><article className="analytics-card"><div className="analytics-card-heading"><div><span>Quality movement</span><h2>Score trend</h2><p>Recent filtered reviews.</p></div></div>{trend.length ? <TrendChart points={trend} /> : <div className="analytics-empty">No score data.</div>}</article><article className="analytics-card"><div className="analytics-card-heading"><div><span>Teaching</span><h2>Dimension ranking</h2><p>Weakest to strongest.</p></div></div><div className="analytics-dimension-list">{dimensions.map((item, index) => <div className="analytics-dimension-row" key={item.code}><span className="analytics-rank">{String(index + 1).padStart(2, '0')}</span><div className="analytics-dimension-copy"><strong>{item.title}</strong><small>{item.count} observations</small></div><div className="analytics-dimension-bar"><i style={{ width: `${item.average / 5 * 100}%` }} /></div><strong className="analytics-dimension-score">{item.average.toFixed(2)} <small>/ 5</small></strong></div>)}</div></article></section>
    <section className="analytics-two-column analytics-table-row"><article className="analytics-card analytics-table-card"><div className="analytics-card-heading"><div><span>Risk prioritization</span><h2>Tutors needing attention</h2><p>Low score, flags, and open Re-consideration signals.</p></div></div><div className="analytics-table-wrap"><table><thead><tr><th>Tutor</th><th>Reviews</th><th>Average</th><th>Yellow</th><th>Red</th><th>Open cases</th></tr></thead><tbody>{tutorRisks.map((item) => <tr key={item.id}><td><strong>{item.code}</strong><span>{item.name}</span></td><td>{item.reviews}</td><td>{formatPercent(item.average)}</td><td>{item.yellow}</td><td>{item.red}</td><td>{item.openCases}</td></tr>)}</tbody></table></div></article><article className="analytics-card analytics-table-card"><div className="analytics-card-heading"><div><span>QC operations</span><h2>Evaluator productivity</h2><p>Review volume and score distribution.</p></div></div><div className="analytics-table-wrap"><table><thead><tr><th>Evaluator</th><th>Reviews</th><th>Published</th><th>Average</th></tr></thead><tbody>{qcPerformance.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.reviews}</td><td>{item.published}</td><td>{formatPercent(item.average)}</td></tr>)}</tbody></table></div></article></section>
    <section className="analytics-card analytics-table-card"><div className="analytics-card-heading"><div><span>Filtered records</span><h2>Review history</h2><p>Cycle and Org. are visible for operational reporting.</p></div></div><div className="analytics-table-wrap"><table><thead><tr><th>Date</th><th>Cycle</th><th>Org.</th><th>Tutor</th><th>Evaluator</th><th>Type</th><th>Overall</th></tr></thead><tbody>{filteredReviews.slice().reverse().map((review) => <tr key={review.id}><td>{reviewDate(review)}</td><td>{review.cycle?.name || '—'}</td><td>{review.project?.name || '—'}</td><td>{review.tutor?.full_name || '—'}</td><td>{review.evaluator?.full_name || '—'}</td><td>{review.evaluation_mode === 'session_12' ? 'Session 12' : 'Normal'}</td><td>{formatPercent(review.score_percentage)}</td></tr>)}</tbody></table></div></section>
  </div>;
}
