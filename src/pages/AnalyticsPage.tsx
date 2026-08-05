import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../analytics-dashboard.css';

type ReviewRecord = {
  id: string;
  tutor_id: string | null;
  evaluator_id: string | null;
  project_id: string | null;
  session_date: string | null;
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
};

type ScoreRecord = {
  review_id: string;
  numeric_score: number | null;
  compliance_result: string | null;
  is_observed: boolean;
  is_repeated: boolean;
  is_external: boolean;
  criterion: {
    code: string;
    title: string;
    criterion_type: 'rating' | 'compliance';
    weight_percentage: number;
  } | null;
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

type ObjectionRecord = {
  id: string;
  review_id: string;
  tutor_id: string;
  status: string;
  decision: string | null;
  created_at: string;
  decision_at: string | null;
  review: { id: string; evaluator_id: string | null; tutor_id: string | null } | null;
};

type DimensionSummary = {
  code: string;
  title: string;
  weight: number;
  average: number;
  count: number;
};

type TrendPoint = {
  key: string;
  label: string;
  average: number;
  reviews: number;
};

type TutorRisk = {
  id: string;
  name: string;
  code: string;
  reviews: number;
  average: number | null;
  yellow: number;
  red: number;
  followUps: number;
  openObjections: number;
  riskScore: number;
};

type QcSummary = {
  id: string;
  name: string;
  reviews: number;
  published: number;
  average: number | null;
  objections: number;
  overturned: number;
};

type KpiIcon = 'reviews' | 'score' | 'published' | 'objections' | 'yellow' | 'red';

const openObjectionStatuses = new Set(['submitted', 'under_review', 'evidence_required', 'awaiting_qtl']);
const decidedObjectionStatuses = new Set(['decision_issued', 'closed']);

const complianceLabels: Record<string, string> = {
  clear: 'Clear',
  coaching_note: 'Coaching note',
  yellow_flag: 'Yellow flag',
  red_flag: 'Red flag',
  external_cause: 'External cause',
};

const complianceColors: Record<string, string> = {
  clear: '#27a681',
  coaching_note: '#6b66c9',
  yellow_flag: '#f1ae2d',
  red_flag: '#d94d5d',
  external_cause: '#7e91a5',
};

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function formatPercent(value: number | null, digits = 1) {
  return value === null ? '—' : `${value.toFixed(digits)}%`;
}

function formatStatus(value: string) {
  return value.replaceAll('_', ' ');
}

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

function reviewDate(review: ReviewRecord) {
  return review.session_date || review.created_at.slice(0, 10);
}

function KpiGlyph({ icon }: { icon: KpiIcon }) {
  const paths: Record<KpiIcon, React.ReactNode> = {
    reviews: <><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    score: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.2 2.2 4.8-5.4" /></>,
    published: <><path d="M5 4h14v16H5z" /><path d="m8 12 2.5 2.5L16 9" /></>,
    objections: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></>,
    yellow: <><path d="M12 3 3.5 20h17z" /><path d="M12 9v4M12 16.5h.01" /></>,
    red: <><path d="M12 3 3.5 20h17z" /><path d="M9.5 10.5 14.5 15M14.5 10.5 9.5 15" /></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[icon]}</svg>;
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const width = 640;
  const height = 220;
  const paddingX = 26;
  const paddingY = 22;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? width / 2 : paddingX + (index / (points.length - 1)) * usableWidth,
    y: paddingY + ((100 - point.average) / 100) * usableHeight,
  }));
  const line = chartPoints.map((point) => `${point.x},${point.y}`).join(' ');
  const area = chartPoints.length
    ? `${paddingX},${height - paddingY} ${line} ${chartPoints.at(-1)?.x ?? width - paddingX},${height - paddingY}`
    : '';

  return (
    <div className="analytics-trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Average quality score trend">
        {[20, 40, 60, 80, 100].map((value) => {
          const y = paddingY + ((100 - value) / 100) * usableHeight;
          return <g key={value}><line x1={paddingX} x2={width - paddingX} y1={y} y2={y} /><text x="2" y={y + 4}>{value}</text></g>;
        })}
        {area && <polygon className="analytics-trend-area" points={area} />}
        {line && <polyline className="analytics-trend-line" points={line} />}
        {chartPoints.map((point) => (
          <g key={point.key} className="analytics-trend-point">
            <circle cx={point.x} cy={point.y} r="5" />
            <text className="analytics-trend-value" x={point.x} y={point.y - 12}>{point.average.toFixed(0)}%</text>
            <text className="analytics-trend-label" x={point.x} y={height - 3}>{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function AnalyticsPage() {
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [scores, setScores] = useState<ScoreRecord[]>([]);
  const [flags, setFlags] = useState<FlagRecord[]>([]);
  const [objections, setObjections] = useState<ObjectionRecord[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [tutorFilter, setTutorFilter] = useState('all');
  const [evaluatorFilter, setEvaluatorFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadAnalytics() {
      setLoading(true);
      setError('');

      const [reviewsResult, scoresResult, flagsResult, objectionsResult] = await Promise.all([
        supabase
          .from('reviews')
          .select('id, tutor_id, evaluator_id, project_id, session_date, school_branch, status, score_percentage, teaching_percentage, compliance_percentage, project_percentage, learning_outcome_status, follow_up_status, created_at, tutor:tutors(full_name, employee_code), evaluator:profiles!reviews_evaluator_id_fkey(full_name), project:projects(id, name)')
          .order('created_at', { ascending: true })
          .range(0, 4999),
        supabase
          .from('review_scores')
          .select('review_id, numeric_score, compliance_result, is_observed, is_repeated, is_external, criterion:evaluation_criteria(code, title, criterion_type, weight_percentage)')
          .range(0, 9999),
        supabase
          .from('review_flags')
          .select('id, review_id, tutor_id, level, is_active, is_repeated, created_at, criterion:evaluation_criteria(title)')
          .range(0, 4999),
        supabase
          .from('objections')
          .select('id, review_id, tutor_id, status, decision, created_at, decision_at, review:reviews(id, evaluator_id, tutor_id)')
          .range(0, 4999),
      ]);

      const firstError = reviewsResult.error || scoresResult.error || flagsResult.error || objectionsResult.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setReviews((reviewsResult.data ?? []) as unknown as ReviewRecord[]);
        setScores((scoresResult.data ?? []) as unknown as ScoreRecord[]);
        setFlags((flagsResult.data ?? []) as unknown as FlagRecord[]);
        setObjections((objectionsResult.data ?? []) as unknown as ObjectionRecord[]);
      }
      setLoading(false);
    }

    void loadAnalytics();
  }, []);

  const filterOptions = useMemo(() => ({
    branches: [...new Set(reviews.map((review) => review.school_branch).filter((value): value is string => Boolean(value)))].sort(),
    tutors: [...new Map(reviews.filter((review) => review.tutor_id && review.tutor).map((review) => [review.tutor_id as string, review.tutor as NonNullable<ReviewRecord['tutor']>])).entries()]
      .sort(([, a], [, b]) => a.full_name.localeCompare(b.full_name)),
    evaluators: [...new Map(reviews.filter((review) => review.evaluator_id && review.evaluator).map((review) => [review.evaluator_id as string, review.evaluator as NonNullable<ReviewRecord['evaluator']>])).entries()]
      .sort(([, a], [, b]) => a.full_name.localeCompare(b.full_name)),
    projects: [...new Map(reviews.filter((review) => review.project_id && review.project).map((review) => [review.project_id as string, review.project as NonNullable<ReviewRecord['project']>])).entries()]
      .sort(([, a], [, b]) => a.name.localeCompare(b.name)),
  }), [reviews]);

  const filteredReviews = useMemo(() => reviews.filter((review) => {
    const date = reviewDate(review);
    return (!dateFrom || date >= dateFrom)
      && (!dateTo || date <= dateTo)
      && (branchFilter === 'all' || review.school_branch === branchFilter)
      && (tutorFilter === 'all' || review.tutor_id === tutorFilter)
      && (evaluatorFilter === 'all' || review.evaluator_id === evaluatorFilter)
      && (projectFilter === 'all' || review.project_id === projectFilter);
  }), [branchFilter, dateFrom, dateTo, evaluatorFilter, projectFilter, reviews, tutorFilter]);

  const filteredReviewIds = useMemo(() => new Set(filteredReviews.map((review) => review.id)), [filteredReviews]);
  const filteredScores = useMemo(() => scores.filter((score) => filteredReviewIds.has(score.review_id)), [filteredReviewIds, scores]);
  const filteredFlags = useMemo(() => flags.filter((flag) => flag.is_active && filteredReviewIds.has(flag.review_id)), [filteredReviewIds, flags]);
  const filteredObjections = useMemo(() => objections.filter((objection) => filteredReviewIds.has(objection.review_id)), [filteredReviewIds, objections]);

  const averageScore = average(filteredReviews.map((review) => review.score_percentage));
  const publishedCount = filteredReviews.filter((review) => review.status === 'published').length;
  const publishedRate = filteredReviews.length ? (publishedCount / filteredReviews.length) * 100 : null;
  const openObjections = filteredObjections.filter((objection) => openObjectionStatuses.has(objection.status)).length;
  const yellowFlags = filteredFlags.filter((flag) => flag.level === 'yellow').length;
  const redFlags = filteredFlags.filter((flag) => flag.level === 'red').length;
  const followUps = filteredReviews.filter((review) => ['required', 'urgent'].includes(review.follow_up_status)).length;

  const dimensions = useMemo<DimensionSummary[]>(() => {
    const map = new Map<string, { title: string; weight: number; total: number; count: number }>();
    filteredScores.forEach((score) => {
      if (score.criterion?.criterion_type !== 'rating' || !score.is_observed || score.numeric_score === null) return;
      const current = map.get(score.criterion.code) ?? { title: score.criterion.title, weight: score.criterion.weight_percentage, total: 0, count: 0 };
      current.total += score.numeric_score;
      current.count += 1;
      map.set(score.criterion.code, current);
    });
    return [...map.entries()].map(([code, value]) => ({
      code,
      title: value.title,
      weight: value.weight,
      average: value.total / value.count,
      count: value.count,
    })).sort((a, b) => a.average - b.average);
  }, [filteredScores]);

  const complianceMix = useMemo(() => {
    const map = new Map<string, number>();
    filteredScores.forEach((score) => {
      if (score.criterion?.criterion_type !== 'compliance' || !score.compliance_result) return;
      map.set(score.compliance_result, (map.get(score.compliance_result) ?? 0) + 1);
    });
    return ['clear', 'coaching_note', 'yellow_flag', 'red_flag', 'external_cause']
      .map((key) => ({ key, count: map.get(key) ?? 0 }))
      .filter((item) => item.count > 0);
  }, [filteredScores]);

  const complianceTotal = complianceMix.reduce((sum, item) => sum + item.count, 0);
  let donutCursor = 0;
  const donutBackground = complianceMix.length
    ? `conic-gradient(${complianceMix.map((item) => {
        const start = donutCursor;
        donutCursor += complianceTotal ? (item.count / complianceTotal) * 100 : 0;
        return `${complianceColors[item.key] ?? '#9aa8b6'} ${start}% ${donutCursor}%`;
      }).join(', ')})`
    : '#edf2f7';

  const trend = useMemo<TrendPoint[]>(() => {
    const map = new Map<string, number[]>();
    filteredReviews.forEach((review) => {
      if (review.score_percentage === null) return;
      const key = reviewDate(review).slice(0, 7);
      const current = map.get(key) ?? [];
      current.push(review.score_percentage);
      map.set(key, current);
    });
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([key, values]) => ({ key, label: monthLabel(key), average: average(values) ?? 0, reviews: values.length }));
  }, [filteredReviews]);

  const statusMix = useMemo(() => {
    const map = new Map<string, number>();
    filteredReviews.forEach((review) => map.set(review.status, (map.get(review.status) ?? 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filteredReviews]);

  const tutorRisks = useMemo<TutorRisk[]>(() => {
    const map = new Map<string, { name: string; code: string; reviews: ReviewRecord[] }>();
    filteredReviews.forEach((review) => {
      if (!review.tutor_id || !review.tutor) return;
      const current = map.get(review.tutor_id) ?? { name: review.tutor.full_name, code: review.tutor.employee_code, reviews: [] };
      current.reviews.push(review);
      map.set(review.tutor_id, current);
    });

    return [...map.entries()].map(([id, value]) => {
      const tutorReviewIds = new Set(value.reviews.map((review) => review.id));
      const tutorFlags = filteredFlags.filter((flag) => flag.tutor_id === id && tutorReviewIds.has(flag.review_id));
      const tutorObjections = filteredObjections.filter((objection) => objection.tutor_id === id);
      const tutorAverage = average(value.reviews.map((review) => review.score_percentage));
      const yellow = tutorFlags.filter((flag) => flag.level === 'yellow').length;
      const red = tutorFlags.filter((flag) => flag.level === 'red').length;
      const tutorFollowUps = value.reviews.filter((review) => ['required', 'urgent'].includes(review.follow_up_status)).length;
      const tutorOpenObjections = tutorObjections.filter((objection) => openObjectionStatuses.has(objection.status)).length;
      const riskScore = red * 5 + yellow * 2 + tutorFollowUps * 2 + tutorOpenObjections * 2 + (tutorAverage !== null && tutorAverage < 70 ? 4 : tutorAverage !== null && tutorAverage < 80 ? 2 : 0);
      return { id, name: value.name, code: value.code, reviews: value.reviews.length, average: tutorAverage, yellow, red, followUps: tutorFollowUps, openObjections: tutorOpenObjections, riskScore };
    }).sort((a, b) => b.riskScore - a.riskScore || (a.average ?? 101) - (b.average ?? 101)).slice(0, 8);
  }, [filteredFlags, filteredObjections, filteredReviews]);

  const qcPerformance = useMemo<QcSummary[]>(() => {
    const reviewById = new Map(filteredReviews.map((review) => [review.id, review]));
    const map = new Map<string, { name: string; reviews: ReviewRecord[] }>();
    filteredReviews.forEach((review) => {
      if (!review.evaluator_id || !review.evaluator) return;
      const current = map.get(review.evaluator_id) ?? { name: review.evaluator.full_name, reviews: [] };
      current.reviews.push(review);
      map.set(review.evaluator_id, current);
    });

    return [...map.entries()].map(([id, value]) => {
      const linkedObjections = filteredObjections.filter((objection) => reviewById.get(objection.review_id)?.evaluator_id === id);
      const overturned = linkedObjections.filter((objection) => ['accepted', 'partially_accepted'].includes(objection.decision ?? '')).length;
      return {
        id,
        name: value.name,
        reviews: value.reviews.length,
        published: value.reviews.filter((review) => review.status === 'published').length,
        average: average(value.reviews.map((review) => review.score_percentage)),
        objections: linkedObjections.length,
        overturned,
      };
    }).sort((a, b) => b.reviews - a.reviews).slice(0, 8);
  }, [filteredObjections, filteredReviews]);

  const objectionPipeline = useMemo(() => [
    { label: 'Submitted', count: filteredObjections.filter((item) => item.status === 'submitted').length },
    { label: 'Under review', count: filteredObjections.filter((item) => ['under_review', 'evidence_required'].includes(item.status)).length },
    { label: 'Awaiting approval', count: filteredObjections.filter((item) => item.status === 'awaiting_qtl').length },
    { label: 'Decision issued', count: filteredObjections.filter((item) => decidedObjectionStatuses.has(item.status)).length },
  ], [filteredObjections]);

  const weakestDimension = dimensions[0] ?? null;
  const branchInsight = useMemo(() => {
    const map = new Map<string, number[]>();
    filteredReviews.forEach((review) => {
      if (!review.school_branch || review.score_percentage === null) return;
      const current = map.get(review.school_branch) ?? [];
      current.push(review.score_percentage);
      map.set(review.school_branch, current);
    });
    return [...map.entries()]
      .filter(([, values]) => values.length >= 1)
      .map(([branch, values]) => ({ branch, average: average(values) ?? 0, reviews: values.length }))
      .sort((a, b) => a.average - b.average)[0] ?? null;
  }, [filteredReviews]);
  const topRiskTutor = tutorRisks[0] ?? null;
  const externalCauses = filteredScores.filter((score) => score.compliance_result === 'external_cause' || score.is_external).length;

  const dataHealth = {
    missingTutor: filteredReviews.filter((review) => !review.tutor_id).length,
    missingBranch: filteredReviews.filter((review) => !review.school_branch).length,
    missingScore: filteredReviews.filter((review) => review.score_percentage === null).length,
    missingDate: filteredReviews.filter((review) => !review.session_date).length,
  };

  function resetFilters() {
    setDateFrom('');
    setDateTo('');
    setBranchFilter('all');
    setTutorFilter('all');
    setEvaluatorFilter('all');
    setProjectFilter('all');
  }

  function exportReviews() {
    const rows = filteredReviews.map((review) => [
      reviewDate(review),
      review.tutor?.employee_code ?? '',
      review.tutor?.full_name ?? '',
      review.evaluator?.full_name ?? '',
      review.school_branch ?? '',
      review.project?.name ?? '',
      review.status,
      review.score_percentage ?? '',
      review.teaching_percentage ?? '',
      review.compliance_percentage ?? '',
      review.project_percentage ?? '',
      review.learning_outcome_status,
      review.follow_up_status,
    ]);
    const headers = ['Date', 'Tutor ID', 'Tutor', 'Evaluator', 'School / Branch', 'Project', 'Status', 'Overall %', 'Teaching %', 'Compliance %', 'Project %', 'Learning Outcome', 'Follow-up'];
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `offline-quality-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const maxPipeline = Math.max(1, ...objectionPipeline.map((item) => item.count));

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <div>
          <span className="analytics-kicker">Leadership command center</span>
          <h1>Quality Analytics</h1>
          <p>See what needs attention, who needs support, and whether quality decisions are improving outcomes.</p>
        </div>
        <button className="analytics-export-button" type="button" onClick={exportReviews} disabled={filteredReviews.length === 0}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
          Export filtered data
        </button>
      </header>

      <section className="analytics-filter-bar" aria-label="Analytics filters">
        <label>Date from<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>Date to<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label>School / branch<select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">All schools</option>{filterOptions.branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}</select></label>
        <label>Tutor<select value={tutorFilter} onChange={(event) => setTutorFilter(event.target.value)}><option value="all">All tutors</option>{filterOptions.tutors.map(([id, tutor]) => <option key={id} value={id}>{tutor.employee_code} — {tutor.full_name}</option>)}</select></label>
        <label>Evaluator<select value={evaluatorFilter} onChange={(event) => setEvaluatorFilter(event.target.value)}><option value="all">All evaluators</option>{filterOptions.evaluators.map(([id, evaluator]) => <option key={id} value={id}>{evaluator.full_name}</option>)}</select></label>
        <label>Project<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects</option>{filterOptions.projects.map(([id, project]) => <option key={id} value={id}>{project.name}</option>)}</select></label>
        <button className="analytics-reset-button" type="button" onClick={resetFilters}>Reset</button>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="analytics-loading">Building leadership insights…</div> : (
        <>
          <section className="analytics-kpi-grid">
            <article className="analytics-kpi-card analytics-kpi-blue"><span className="analytics-kpi-icon"><KpiGlyph icon="reviews" /></span><div><small>Total reviews</small><strong>{filteredReviews.length}</strong><p>{followUps} require follow-up</p></div></article>
            <article className="analytics-kpi-card analytics-kpi-indigo"><span className="analytics-kpi-icon"><KpiGlyph icon="score" /></span><div><small>Average quality score</small><strong>{formatPercent(averageScore)}</strong><p>{dimensions.length ? `${dimensions.length} dimensions observed` : 'No scored dimensions'}</p></div></article>
            <article className="analytics-kpi-card analytics-kpi-green"><span className="analytics-kpi-icon"><KpiGlyph icon="published" /></span><div><small>Published reviews</small><strong>{publishedCount}</strong><p>{formatPercent(publishedRate)} of filtered reviews</p></div></article>
            <article className="analytics-kpi-card analytics-kpi-violet"><span className="analytics-kpi-icon"><KpiGlyph icon="objections" /></span><div><small>Open objections</small><strong>{openObjections}</strong><p>{filteredObjections.length} objections in total</p></div></article>
            <article className="analytics-kpi-card analytics-kpi-yellow"><span className="analytics-kpi-icon"><KpiGlyph icon="yellow" /></span><div><small>Active yellow flags</small><strong>{yellowFlags}</strong><p>{filteredFlags.filter((flag) => flag.level === 'yellow' && flag.is_repeated).length} repeated</p></div></article>
            <article className="analytics-kpi-card analytics-kpi-red"><span className="analytics-kpi-icon"><KpiGlyph icon="red" /></span><div><small>Active red flags</small><strong>{redFlags}</strong><p>{filteredFlags.filter((flag) => flag.level === 'red' && flag.is_repeated).length} repeated</p></div></article>
          </section>

          <section className="analytics-insight-grid">
            <article><span>Weakest dimension</span><strong>{weakestDimension?.title ?? 'Not enough data'}</strong><p>{weakestDimension ? `${weakestDimension.average.toFixed(2)} / 5 across ${weakestDimension.count} observations` : 'Score more sessions to unlock this insight.'}</p></article>
            <article><span>School needing support</span><strong>{branchInsight?.branch ?? 'Not enough data'}</strong><p>{branchInsight ? `${branchInsight.average.toFixed(1)}% average across ${branchInsight.reviews} reviews` : 'School / branch data is not available.'}</p></article>
            <article><span>Highest tutor risk signal</span><strong>{topRiskTutor ? `${topRiskTutor.code} — ${topRiskTutor.name}` : 'No tutor risk detected'}</strong><p>{topRiskTutor ? `${topRiskTutor.red} red · ${topRiskTutor.yellow} yellow · ${topRiskTutor.followUps} follow-ups` : 'No tutor-level reviews match the filters.'}</p></article>
            <article><span>External causes</span><strong>{externalCauses}</strong><p>{externalCauses ? 'Check whether the same school or operational issue is recurring.' : 'No external causes recorded in this view.'}</p></article>
          </section>

          <section className="analytics-two-column analytics-top-charts">
            <article className="analytics-card analytics-trend-card">
              <div className="analytics-card-heading"><div><span>Quality movement</span><h2>Average score trend</h2><p>Monthly average across the selected reviews.</p></div><strong>{formatPercent(averageScore)}</strong></div>
              {trend.length ? <TrendChart points={trend} /> : <div className="analytics-empty">No scored trend is available for these filters.</div>}
            </article>

            <article className="analytics-card analytics-status-card">
              <div className="analytics-card-heading"><div><span>Workflow health</span><h2>Review status</h2><p>Where evaluations currently sit in the workflow.</p></div></div>
              <div className="analytics-status-list">
                {statusMix.length ? statusMix.map(([status, count]) => {
                  const percentage = filteredReviews.length ? (count / filteredReviews.length) * 100 : 0;
                  return <div key={status}><div><strong>{formatStatus(status)}</strong><span>{count} reviews · {percentage.toFixed(0)}%</span></div><div className="analytics-progress"><i style={{ width: `${percentage}%` }} /></div></div>;
                }) : <div className="analytics-empty">No review status data.</div>}
              </div>
            </article>
          </section>

          <section className="analytics-two-column analytics-quality-row">
            <article className="analytics-card">
              <div className="analytics-card-heading"><div><span>Teaching quality</span><h2>Dimension ranking</h2><p>Sorted from weakest to strongest so priorities are immediately visible.</p></div></div>
              <div className="analytics-dimension-list">
                {dimensions.length ? dimensions.map((dimension, index) => (
                  <div key={dimension.code} className="analytics-dimension-row">
                    <span className="analytics-rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="analytics-dimension-copy"><strong>{dimension.title}</strong><small>{dimension.weight}% weight · {dimension.count} observations</small></div>
                    <div className="analytics-dimension-bar"><i style={{ width: `${(dimension.average / 5) * 100}%` }} /></div>
                    <strong className="analytics-dimension-score">{dimension.average.toFixed(2)} <small>/ 5</small></strong>
                  </div>
                )) : <div className="analytics-empty">No teaching dimensions have been scored yet.</div>}
              </div>
            </article>

            <article className="analytics-card analytics-compliance-card">
              <div className="analytics-card-heading"><div><span>Separate result</span><h2>Compliance mix</h2><p>Clear visibility without overlapping labels or hidden counts.</p></div></div>
              {complianceMix.length ? (
                <div className="analytics-compliance-layout">
                  <div className="analytics-donut" style={{ background: donutBackground }}><div><strong>{complianceTotal}</strong><span>outcomes</span></div></div>
                  <div className="analytics-compliance-legend">
                    {complianceMix.map((item) => <div key={item.key}><i style={{ background: complianceColors[item.key] }} /><div><strong>{complianceLabels[item.key] ?? formatStatus(item.key)}</strong><span>{item.count} · {complianceTotal ? ((item.count / complianceTotal) * 100).toFixed(0) : 0}%</span></div></div>)}
                  </div>
                </div>
              ) : <div className="analytics-empty">No compliance outcomes are available.</div>}
              <div className="analytics-flag-strip"><div><span>Yellow flags</span><strong>{yellowFlags}</strong></div><div><span>Red flags</span><strong>{redFlags}</strong></div><div><span>Repeated flags</span><strong>{filteredFlags.filter((flag) => flag.is_repeated).length}</strong></div><div><span>External causes</span><strong>{externalCauses}</strong></div></div>
            </article>
          </section>

          <section className="analytics-two-column analytics-table-row">
            <article className="analytics-card analytics-table-card">
              <div className="analytics-card-heading"><div><span>Risk prioritization</span><h2>Tutors needing attention</h2><p>Signal combines low scores, flags, follow-ups, and open objections.</p></div></div>
              <div className="analytics-table-wrap"><table><thead><tr><th>Tutor</th><th>Avg.</th><th>Flags</th><th>Follow-up</th><th>Objections</th><th>Signal</th></tr></thead><tbody>
                {tutorRisks.length ? tutorRisks.map((tutor) => {
                  const riskLabel = tutor.riskScore >= 8 ? 'High' : tutor.riskScore >= 4 ? 'Watch' : 'Stable';
                  return <tr key={tutor.id}><td><strong>{tutor.code}</strong><span>{tutor.name}</span></td><td>{formatPercent(tutor.average)}</td><td><span className="analytics-flag-count analytics-yellow-count">{tutor.yellow}Y</span><span className="analytics-flag-count analytics-red-count">{tutor.red}R</span></td><td>{tutor.followUps}</td><td>{tutor.openObjections}</td><td><span className={`analytics-risk-badge analytics-risk-${riskLabel.toLowerCase()}`}>{riskLabel}</span></td></tr>;
                }) : <tr><td colSpan={6}><div className="analytics-empty">No tutor-level risk data.</div></td></tr>}
              </tbody></table></div>
            </article>

            <article className="analytics-card analytics-table-card">
              <div className="analytics-card-heading"><div><span>QC operations</span><h2>Reviewer productivity</h2><p>Volume, publishing progress, and objection impact by evaluator.</p></div></div>
              <div className="analytics-table-wrap"><table><thead><tr><th>Evaluator</th><th>Reviews</th><th>Published</th><th>Avg.</th><th>Objections</th><th>Changed</th></tr></thead><tbody>
                {qcPerformance.length ? qcPerformance.map((qc) => <tr key={qc.id}><td><strong>{qc.name}</strong></td><td>{qc.reviews}</td><td>{qc.published}</td><td>{formatPercent(qc.average)}</td><td>{qc.objections}</td><td>{qc.overturned}</td></tr>) : <tr><td colSpan={6}><div className="analytics-empty">No evaluator performance data.</div></td></tr>}
              </tbody></table></div>
            </article>
          </section>

          <section className="analytics-two-column analytics-bottom-row">
            <article className="analytics-card">
              <div className="analytics-card-heading"><div><span>Reconsideration workflow</span><h2>Objection pipeline</h2><p>See bottlenecks before they become overdue cases.</p></div></div>
              <div className="analytics-pipeline">
                {objectionPipeline.map((item) => <div key={item.label}><div><strong>{item.label}</strong><span>{item.count}</span></div><div className="analytics-pipeline-bar"><i style={{ width: `${(item.count / maxPipeline) * 100}%` }} /></div></div>)}
              </div>
            </article>

            <article className="analytics-card analytics-data-health-card">
              <div className="analytics-card-heading"><div><span>Reporting confidence</span><h2>Data health</h2><p>Missing fields reduce tutor, school, trend, and score analysis accuracy.</p></div></div>
              <div className="analytics-data-health-grid">
                <div><strong>{dataHealth.missingTutor}</strong><span>reviews missing tutor</span></div>
                <div><strong>{dataHealth.missingBranch}</strong><span>reviews missing school / branch</span></div>
                <div><strong>{dataHealth.missingScore}</strong><span>reviews missing overall score</span></div>
                <div><strong>{dataHealth.missingDate}</strong><span>reviews missing session date</span></div>
              </div>
              <p className="analytics-data-note">Analytics use only records visible to your role and the active filters above.</p>
            </article>
          </section>
        </>
      )}
    </div>
  );
}
