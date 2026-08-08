import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../review-management.css';

type EvaluationMode = 'normal_session' | 'session_12';

type ReviewRecord = {
  id: string;
  evaluator_id: string;
  tutor_id: string;
  project_id: string | null;
  cycle_id: string | null;
  evaluation_mode: EvaluationMode;
  session_date: string | null;
  school_branch: string | null;
  course_track: string | null;
  session_topic: string | null;
  session_type: string | null;
  external_session_id: string | null;
  students_present: number | null;
  age_level: string | null;
  observation_scope: string;
  observation_minutes: number | null;
  environment_readiness: string | null;
  intended_learning_outcome: string | null;
  external_school_cause: string | null;
  context_details: string | null;
  learning_outcome_status: string;
  follow_up_status: string;
  status: string;
};

type TutorOption = { id: string; employee_code: string; full_name: string };
type OrgOption = { id: string; name: string; is_active: boolean };
type CycleOption = { id: string; name: string; start_date: string; end_date: string; status: string; is_default: boolean };
type ModelSettings = {
  teaching_weight: number;
  compliance_weight: number;
  project_weight: number;
  final_teaching_weight: number;
  final_compliance_weight: number;
  final_project_weight: number;
};
type Criterion = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  criterion_type: 'rating' | 'compliance';
  weight_percentage: number;
  anchor_1: string | null;
  anchor_3: string | null;
  anchor_5: string | null;
  sort_order: number;
};
type ProjectMetric = {
  id: string;
  scope: EvaluationMode;
  code: string;
  title: string;
  description: string | null;
  weight_percentage: number;
  anchor_1: string | null;
  anchor_3: string | null;
  anchor_5: string | null;
  sort_order: number;
};
type ScoreRow = {
  id: string;
  criterion_id: string;
  numeric_score: number | null;
  is_observed: boolean;
  compliance_result: string | null;
  is_applicable: boolean | null;
  is_external: boolean;
  external_details: string | null;
  severity_reason: string | null;
  timestamp_seconds: number | null;
  evidence: string | null;
};
type ProjectEvaluationRow = {
  id: string;
  metric_id: string;
  numeric_score: number | null;
  is_observed: boolean;
  evidence: string | null;
  timestamp_seconds: number | null;
};
type ScoreState = {
  score: string;
  observed: boolean;
  compliance: string;
  evidence: string;
  timestamp: string;
  severityReason: string;
  externalDetails: string;
};
type FeedbackState = {
  observedStrength: string;
  developmentPriority: string;
  studentImpact: string;
  requiredAction: string;
  followUpPlan: string;
  followUpDate: string;
  internalNotes: string;
};

const emptyFeedback: FeedbackState = {
  observedStrength: '',
  developmentPriority: '',
  studentImpact: '',
  requiredAction: '',
  followUpPlan: '',
  followUpDate: '',
  internalNotes: '',
};

const complianceOptions = [
  ['clear', 'Clear'],
  ['coaching_note', 'Coaching Note'],
  ['yellow_flag', 'Yellow Flag'],
  ['red_flag', 'Red Flag'],
  ['external_cause', 'External Cause'],
  ['not_applicable', 'N/A'],
] as const;

function toTimestamp(seconds: number | null) {
  if (seconds === null) return '';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function timestampToSeconds(value: string) {
  if (!value.trim()) return null;
  const [minutesText, secondsText] = value.split(':');
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds < 0 || seconds > 59) return null;
  return minutes * 60 + seconds;
}

export function EditReviewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reviewId = searchParams.get('review');
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [projectMetrics, setProjectMetrics] = useState<ProjectMetric[]>([]);
  const [answers, setAnswers] = useState<Record<string, ScoreState>>({});
  const [projectAnswers, setProjectAnswers] = useState<Record<string, ScoreState>>({});
  const [feedback, setFeedback] = useState<FeedbackState>(emptyFeedback);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      if (!reviewId) {
        setError('Review ID is missing.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      const [reviewResult, tutorsResult, orgsResult, cyclesResult, settingsResult, criteriaResult, metricsResult, scoresResult, projectScoresResult, feedbackResult] = await Promise.all([
        supabase.from('reviews').select('id, evaluator_id, tutor_id, project_id, cycle_id, evaluation_mode, session_date, school_branch, course_track, session_topic, session_type, external_session_id, students_present, age_level, observation_scope, observation_minutes, environment_readiness, intended_learning_outcome, external_school_cause, context_details, learning_outcome_status, follow_up_status, status').eq('id', reviewId).maybeSingle(),
        supabase.from('tutors').select('id, employee_code, full_name').eq('is_active', true).order('full_name'),
        supabase.from('projects').select('id, name, is_active').order('sort_order').order('name'),
        supabase.from('evaluation_cycles').select('id, name, start_date, end_date, status, is_default').order('start_date', { ascending: false }),
        supabase.from('quality_model_settings').select('teaching_weight, compliance_weight, project_weight, final_teaching_weight, final_compliance_weight, final_project_weight').eq('id', true).single(),
        supabase.from('evaluation_criteria').select('id, code, title, description, criterion_type, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order').eq('is_active', true).order('sort_order'),
        supabase.from('project_evaluation_metrics').select('id, scope, code, title, description, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order').eq('is_active', true).order('sort_order'),
        supabase.from('review_scores').select('id, criterion_id, numeric_score, is_observed, compliance_result, is_applicable, is_external, external_details, severity_reason, timestamp_seconds, evidence').eq('review_id', reviewId),
        supabase.from('review_project_evaluations').select('id, metric_id, numeric_score, is_observed, evidence, timestamp_seconds').eq('review_id', reviewId),
        supabase.from('review_feedback').select('observed_strength, development_priority, student_impact, required_action, follow_up_plan, follow_up_date, internal_notes').eq('review_id', reviewId).maybeSingle(),
      ]);

      const firstError = reviewResult.error || tutorsResult.error || orgsResult.error || cyclesResult.error || settingsResult.error || criteriaResult.error || metricsResult.error || scoresResult.error || projectScoresResult.error || feedbackResult.error;
      if (firstError) {
        setError(firstError.message);
        setLoading(false);
        return;
      }
      if (!reviewResult.data) {
        setError('This review is not available to your account.');
        setLoading(false);
        return;
      }

      setReview(reviewResult.data as ReviewRecord);
      setTutors((tutorsResult.data ?? []) as TutorOption[]);
      setOrgs((orgsResult.data ?? []) as OrgOption[]);
      setCycles((cyclesResult.data ?? []) as CycleOption[]);
      setSettings(settingsResult.data as ModelSettings);
      setCriteria((criteriaResult.data ?? []) as Criterion[]);
      setProjectMetrics((metricsResult.data ?? []) as ProjectMetric[]);

      const scoreMap: Record<string, ScoreState> = {};
      ((scoresResult.data ?? []) as ScoreRow[]).forEach((item) => {
        scoreMap[item.criterion_id] = {
          score: item.numeric_score === null ? '' : String(item.numeric_score),
          observed: item.is_observed,
          compliance: item.compliance_result ?? '',
          evidence: item.evidence ?? '',
          timestamp: toTimestamp(item.timestamp_seconds),
          severityReason: item.severity_reason ?? '',
          externalDetails: item.external_details ?? '',
        };
      });
      setAnswers(scoreMap);

      const projectMap: Record<string, ScoreState> = {};
      ((projectScoresResult.data ?? []) as ProjectEvaluationRow[]).forEach((item) => {
        projectMap[item.metric_id] = {
          score: item.numeric_score === null ? '' : String(item.numeric_score),
          observed: item.is_observed,
          compliance: '',
          evidence: item.evidence ?? '',
          timestamp: toTimestamp(item.timestamp_seconds),
          severityReason: '',
          externalDetails: '',
        };
      });
      setProjectAnswers(projectMap);

      const savedFeedback = feedbackResult.data;
      setFeedback(savedFeedback ? {
        observedStrength: savedFeedback.observed_strength ?? '',
        developmentPriority: savedFeedback.development_priority ?? '',
        studentImpact: savedFeedback.student_impact ?? '',
        requiredAction: savedFeedback.required_action ?? '',
        followUpPlan: savedFeedback.follow_up_plan ?? '',
        followUpDate: savedFeedback.follow_up_date ?? '',
        internalNotes: savedFeedback.internal_notes ?? '',
      } : emptyFeedback);
      setLoading(false);
    }

    void load();
  }, [reviewId]);

  const teachingCriteria = useMemo(() => criteria.filter((item) => item.criterion_type === 'rating'), [criteria]);
  const complianceCriteria = useMemo(() => criteria.filter((item) => item.criterion_type === 'compliance'), [criteria]);
  const selectedProjectMetrics = useMemo(() => projectMetrics.filter((item) => item.scope === review?.evaluation_mode), [projectMetrics, review?.evaluation_mode]);

  const weights = useMemo(() => {
    if (!review || !settings) return { teaching: 0, compliance: 0, project: 0 };
    return review.evaluation_mode === 'session_12'
      ? { teaching: Number(settings.final_teaching_weight), compliance: Number(settings.final_compliance_weight), project: Number(settings.final_project_weight) }
      : { teaching: Number(settings.teaching_weight), compliance: Number(settings.compliance_weight), project: Number(settings.project_weight) };
  }, [review, settings]);

  function updateAnswer(id: string, patch: Partial<ScoreState>) {
    setAnswers((current) => ({
      ...current,
      [id]: {
        score: '', observed: true, compliance: '', evidence: '', timestamp: '', severityReason: '', externalDetails: '',
        ...(current[id] ?? {}),
        ...patch,
      },
    }));
  }

  function updateProjectAnswer(id: string, patch: Partial<ScoreState>) {
    setProjectAnswers((current) => ({
      ...current,
      [id]: {
        score: '', observed: true, compliance: '', evidence: '', timestamp: '', severityReason: '', externalDetails: '',
        ...(current[id] ?? {}),
        ...patch,
      },
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || !reviewId || !settings) return;
    if (!review.tutor_id) {
      setError('Tutor is required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const sectionTitle = review.evaluation_mode === 'session_12' ? 'Final Project Evaluation' : 'Project Evaluation Quality';
      const { error: reviewError } = await supabase.from('reviews').update({
        tutor_id: review.tutor_id,
        project_id: review.project_id || null,
        cycle_id: review.cycle_id || null,
        evaluation_mode: review.evaluation_mode,
        project_section_title: sectionTitle,
        project_section_weight_snapshot: weights.project,
        project_weight_snapshot: weights.project,
        session_date: review.session_date || null,
        school_branch: review.school_branch || null,
        course_track: review.course_track || null,
        session_topic: review.session_topic || null,
        session_type: review.session_type || null,
        external_session_id: review.external_session_id || null,
        students_present: review.students_present,
        age_level: review.age_level || null,
        observation_scope: review.observation_scope,
        observation_minutes: review.observation_minutes,
        environment_readiness: review.environment_readiness || null,
        intended_learning_outcome: review.intended_learning_outcome || null,
        external_school_cause: review.external_school_cause || null,
        context_details: review.context_details || null,
        learning_outcome_status: review.learning_outcome_status,
        follow_up_status: review.follow_up_status,
      }).eq('id', reviewId);
      if (reviewError) throw reviewError;

      const teachingBase = Number(settings.teaching_weight) || 1;
      const teachingScale = weights.teaching / teachingBase;
      const complianceItemWeight = complianceCriteria.length ? weights.compliance / complianceCriteria.length : 0;
      const scoreRows: Record<string, unknown>[] = [];

      teachingCriteria.forEach((criterion) => {
        const answer = answers[criterion.id];
        if (!answer || (answer.observed && !answer.score)) return;
        scoreRows.push({
          review_id: reviewId,
          criterion_id: criterion.id,
          numeric_score: answer.observed ? Number(answer.score) : null,
          is_observed: answer.observed,
          compliance_result: null,
          is_applicable: null,
          is_external: false,
          external_details: null,
          severity_reason: null,
          weight_snapshot: Number(criterion.weight_percentage) * teachingScale,
          timestamp_seconds: timestampToSeconds(answer.timestamp),
          evidence: answer.evidence.trim() || null,
        });
      });

      complianceCriteria.forEach((criterion) => {
        const answer = answers[criterion.id];
        if (!answer?.compliance) return;
        const result = answer.compliance;
        scoreRows.push({
          review_id: reviewId,
          criterion_id: criterion.id,
          numeric_score: null,
          is_observed: true,
          compliance_result: result,
          is_applicable: result !== 'not_applicable',
          is_external: result === 'external_cause',
          external_details: result === 'external_cause' ? answer.externalDetails.trim() || null : null,
          severity_reason: ['coaching_note', 'yellow_flag', 'red_flag'].includes(result) ? answer.severityReason.trim() || null : null,
          weight_snapshot: complianceItemWeight,
          timestamp_seconds: timestampToSeconds(answer.timestamp),
          evidence: answer.evidence.trim() || null,
        });
      });

      if (scoreRows.length) {
        const { error: scoreError } = await supabase.from('review_scores').upsert(scoreRows, { onConflict: 'review_id,criterion_id' });
        if (scoreError) throw scoreError;
      }

      const { error: clearProjectError } = await supabase.from('review_project_evaluations').delete().eq('review_id', reviewId);
      if (clearProjectError) throw clearProjectError;

      const projectRows = selectedProjectMetrics.flatMap((metric) => {
        const answer = projectAnswers[metric.id];
        if (!answer || (answer.observed && !answer.score)) return [];
        return [{
          review_id: reviewId,
          metric_id: metric.id,
          numeric_score: answer.observed ? Number(answer.score) : null,
          is_observed: answer.observed,
          evidence: answer.evidence.trim() || null,
          timestamp_seconds: timestampToSeconds(answer.timestamp),
          weight_snapshot: (Number(metric.weight_percentage) / 100) * weights.project,
        }];
      });
      if (projectRows.length) {
        const { error: projectError } = await supabase.from('review_project_evaluations').insert(projectRows);
        if (projectError) throw projectError;
      }

      const { error: feedbackError } = await supabase.from('review_feedback').upsert({
        review_id: reviewId,
        observed_strength: feedback.observedStrength.trim() || null,
        development_priority: feedback.developmentPriority.trim() || null,
        student_impact: feedback.studentImpact.trim() || null,
        required_action: feedback.requiredAction.trim() || null,
        follow_up_plan: feedback.followUpPlan.trim() || null,
        follow_up_date: feedback.followUpDate || null,
        internal_notes: feedback.internalNotes.trim() || null,
      }, { onConflict: 'review_id' });
      if (feedbackError) throw feedbackError;

      const { error: recalcError } = await supabase.rpc('recalculate_review_total', { p_review_id: reviewId });
      if (recalcError) throw recalcError;

      navigate(`/reviews?review=${reviewId}`, { replace: true, state: { notice: 'Review updated successfully.' } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update the review.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="screen-center">Loading review editor…</div>;
  if (!review) return <div className="page-stack"><div className="alert alert-error">{error || 'Review not found.'}</div><Link className="button button-secondary" to="/reviews">Back to reviews</Link></div>;

  return (
    <form className="page-stack review-edit-page" onSubmit={save}>
      <header className="page-header sticky-header">
        <div>
          <p className="eyebrow">Review management</p>
          <h1>Edit review</h1>
          <p>Update the evaluation context, scores, Section 3, compliance, and feedback.</p>
          <div className="evaluation-weight-chips"><span>Teaching {weights.teaching}%</span><span>{review.evaluation_mode === 'session_12' ? 'Final Project Evaluation' : 'Project Evaluation Quality'} {weights.project}%</span><span>Compliance {weights.compliance}%</span></div>
        </div>
        <div className="review-edit-header-actions"><Link className="people-secondary-button" to={`/reviews?review=${review.id}`}>Cancel</Link><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
      </header>

      {review.status === 'published' && <div className="alert alert-error review-edit-warning"><strong>Published review</strong><span>Saved changes will become visible to the tutor immediately.</span></div>}
      {error && <div className="alert alert-error">{error}</div>}

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Review context</p><h2>Session & evaluator context</h2></div></div>
        <div className="form-grid">
          <label>Tutor *<select required value={review.tutor_id} onChange={(event) => setReview({ ...review, tutor_id: event.target.value })}>{tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.employee_code} — {tutor.full_name}</option>)}</select></label>
          <label>Evaluation type<select value={review.evaluation_mode} onChange={(event) => setReview({ ...review, evaluation_mode: event.target.value as EvaluationMode })}><option value="normal_session">Normal Session</option><option value="session_12">Session 12 – Final Project</option></select></label>
          <label>Cycle<select value={review.cycle_id ?? ''} onChange={(event) => setReview({ ...review, cycle_id: event.target.value || null })}><option value="">Auto / no cycle</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}{cycle.is_default ? ' · Default' : ''}</option>)}</select></label>
          <label>Org.<select value={review.project_id ?? ''} onChange={(event) => setReview({ ...review, project_id: event.target.value || null })}><option value="">No Org.</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}{!org.is_active ? ' · Inactive' : ''}</option>)}</select></label>
          <label>Session date<input type="date" value={review.session_date ?? ''} onChange={(event) => setReview({ ...review, session_date: event.target.value || null })} /></label>
          <label>School / branch<input value={review.school_branch ?? ''} onChange={(event) => setReview({ ...review, school_branch: event.target.value })} /></label>
          <label>Course / track<input value={review.course_track ?? ''} onChange={(event) => setReview({ ...review, course_track: event.target.value })} /></label>
          <label>Session topic<input value={review.session_topic ?? ''} onChange={(event) => setReview({ ...review, session_topic: event.target.value })} /></label>
          <label>Session format<select value={review.session_type ?? ''} onChange={(event) => setReview({ ...review, session_type: event.target.value || null })}><option value="">Not specified</option><option value="group">Group</option><option value="one_to_one">One-to-one</option></select></label>
          <label>Session ID<input value={review.external_session_id ?? ''} onChange={(event) => setReview({ ...review, external_session_id: event.target.value })} /></label>
          <label>Students present<input type="number" min="0" value={review.students_present ?? ''} onChange={(event) => setReview({ ...review, students_present: event.target.value ? Number(event.target.value) : null })} /></label>
          <label>Age / level<input value={review.age_level ?? ''} onChange={(event) => setReview({ ...review, age_level: event.target.value })} /></label>
          <label>Observation scope<select value={review.observation_scope} onChange={(event) => setReview({ ...review, observation_scope: event.target.value })}><option value="full_session">Full session</option><option value="partial_session">Partial session</option></select></label>
          <label>Observed minutes<input type="number" min="1" value={review.observation_minutes ?? ''} onChange={(event) => setReview({ ...review, observation_minutes: event.target.value ? Number(event.target.value) : null })} /></label>
          <label>Learning outcome<select value={review.learning_outcome_status} onChange={(event) => setReview({ ...review, learning_outcome_status: event.target.value })}><option value="achieved">Achieved</option><option value="partially_achieved">Partially achieved</option><option value="not_achieved">Not achieved</option><option value="not_observed">Not observed</option></select></label>
          <label>Follow-up status<select value={review.follow_up_status} onChange={(event) => setReview({ ...review, follow_up_status: event.target.value })}><option value="none">None</option><option value="routine">Routine</option><option value="required">Required</option><option value="urgent">Urgent</option></select></label>
          <label className="full-width">Environment readiness<input value={review.environment_readiness ?? ''} onChange={(event) => setReview({ ...review, environment_readiness: event.target.value })} /></label>
          <label className="full-width">Intended learning outcome<textarea rows={2} value={review.intended_learning_outcome ?? ''} onChange={(event) => setReview({ ...review, intended_learning_outcome: event.target.value })} /></label>
          <label className="full-width">External / school cause<textarea rows={2} value={review.external_school_cause ?? ''} onChange={(event) => setReview({ ...review, external_school_cause: event.target.value })} /></label>
          <label className="full-width">Context details<textarea rows={2} value={review.context_details ?? ''} onChange={(event) => setReview({ ...review, context_details: event.target.value })} /></label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Teaching · {weights.teaching}%</p><h2>Teaching Quality</h2><p>Edit the original rating and evidence.</p></div></div>
        <div className="review-edit-metric-list">
          {teachingCriteria.map((criterion) => {
            const answer = answers[criterion.id] ?? { score: '', observed: true, compliance: '', evidence: '', timestamp: '', severityReason: '', externalDetails: '' };
            return <article className="review-edit-metric" key={criterion.id}><div><span className="criterion-code">{criterion.code}</span><h3>{criterion.title}</h3><p>{criterion.description}</p></div><div className="review-edit-controls"><label>Score<select value={answer.observed ? answer.score : ''} disabled={!answer.observed} onChange={(event) => updateAnswer(criterion.id, { score: event.target.value })}><option value="">Not scored</option>{[1,2,3,4,5].map((score) => <option key={score} value={score}>{score} / 5</option>)}</select></label><label className="checkbox-row"><input type="checkbox" checked={!answer.observed} onChange={(event) => updateAnswer(criterion.id, { observed: !event.target.checked, score: '' })} />Not observed</label><label>Time<input placeholder="12:35" value={answer.timestamp} onChange={(event) => updateAnswer(criterion.id, { timestamp: event.target.value })} /></label><label className="full-width">Evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateAnswer(criterion.id, { evidence: event.target.value })} /></label></div></article>;
          })}
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Section 3 · {weights.project}%</p><h2>{review.evaluation_mode === 'session_12' ? 'Final Project Evaluation' : 'Project Evaluation Quality'}</h2><p>The rubric changes automatically with the evaluation type.</p></div></div>
        <div className="review-edit-metric-list">
          {selectedProjectMetrics.map((metric) => {
            const answer = projectAnswers[metric.id] ?? { score: '', observed: true, compliance: '', evidence: '', timestamp: '', severityReason: '', externalDetails: '' };
            return <article className="review-edit-metric" key={metric.id}><div><span className="criterion-code">{metric.code}</span><h3>{metric.title} · {metric.weight_percentage}%</h3><p>{metric.description}</p></div><div className="review-edit-controls"><label>Score<select value={answer.observed ? answer.score : ''} disabled={!answer.observed} onChange={(event) => updateProjectAnswer(metric.id, { score: event.target.value })}><option value="">Not scored</option>{[1,2,3,4,5].map((score) => <option key={score} value={score}>{score} / 5</option>)}</select></label><label className="checkbox-row"><input type="checkbox" checked={!answer.observed} onChange={(event) => updateProjectAnswer(metric.id, { observed: !event.target.checked, score: '' })} />Not observed</label><label>Time<input placeholder="12:35" value={answer.timestamp} onChange={(event) => updateProjectAnswer(metric.id, { timestamp: event.target.value })} /></label><label className="full-width">Evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateProjectAnswer(metric.id, { evidence: event.target.value })} /></label></div></article>;
          })}
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Compliance · {weights.compliance}%</p><h2>Compliance</h2><p>Changing a Yellow or Red result updates the linked active flag automatically.</p></div></div>
        <div className="review-edit-metric-list">
          {complianceCriteria.map((criterion) => {
            const answer = answers[criterion.id] ?? { score: '', observed: true, compliance: '', evidence: '', timestamp: '', severityReason: '', externalDetails: '' };
            const needsReason = ['coaching_note', 'yellow_flag', 'red_flag'].includes(answer.compliance);
            return <article className="review-edit-metric" key={criterion.id}><div><span className="criterion-code">{criterion.code}</span><h3>{criterion.title}</h3><p>{criterion.description}</p></div><div className="review-edit-controls"><label>Result<select value={answer.compliance} onChange={(event) => updateAnswer(criterion.id, { compliance: event.target.value })}><option value="">Not recorded</option>{complianceOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Time<input placeholder="12:35" value={answer.timestamp} onChange={(event) => updateAnswer(criterion.id, { timestamp: event.target.value })} /></label>{needsReason && <label className="full-width">Severity rationale<textarea rows={2} value={answer.severityReason} onChange={(event) => updateAnswer(criterion.id, { severityReason: event.target.value })} /></label>}{answer.compliance === 'external_cause' && <label className="full-width">External cause details<textarea rows={2} value={answer.externalDetails} onChange={(event) => updateAnswer(criterion.id, { externalDetails: event.target.value })} /></label>}<label className="full-width">Evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateAnswer(criterion.id, { evidence: event.target.value })} /></label></div></article>;
          })}
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Feedback</p><h2>Evidence-based feedback</h2></div></div>
        <div className="form-grid">
          <label className="full-width">Observed strength<textarea rows={3} value={feedback.observedStrength} onChange={(event) => setFeedback({ ...feedback, observedStrength: event.target.value })} /></label>
          <label className="full-width">Development priority<textarea rows={3} value={feedback.developmentPriority} onChange={(event) => setFeedback({ ...feedback, developmentPriority: event.target.value })} /></label>
          <label className="full-width">Student impact<textarea rows={2} value={feedback.studentImpact} onChange={(event) => setFeedback({ ...feedback, studentImpact: event.target.value })} /></label>
          <label className="full-width">Required action<textarea rows={2} value={feedback.requiredAction} onChange={(event) => setFeedback({ ...feedback, requiredAction: event.target.value })} /></label>
          <label>Follow-up date<input type="date" value={feedback.followUpDate} onChange={(event) => setFeedback({ ...feedback, followUpDate: event.target.value })} /></label>
          <label>Follow-up plan<input value={feedback.followUpPlan} onChange={(event) => setFeedback({ ...feedback, followUpPlan: event.target.value })} /></label>
          <label className="full-width">Internal quality notes<textarea rows={2} value={feedback.internalNotes} onChange={(event) => setFeedback({ ...feedback, internalNotes: event.target.value })} /></label>
        </div>
      </section>

      <footer className="form-actions"><Link className="button button-secondary" to={`/reviews?review=${review.id}`}>Cancel</Link><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving changes…' : 'Save changes'}</button></footer>
    </form>
  );
}
