import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ComplianceResult, EvaluationCriterion } from '../types';
import '../evaluation-model-v2.css';

type TutorOption = { id: string; employee_code: string; full_name: string };
type OrgOption = { id: string; name: string; description: string | null };
type CycleOption = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'active' | 'closed';
  is_default: boolean;
};
type ProjectMetric = {
  id: string;
  scope: 'normal_session' | 'session_12';
  code: string;
  title: string;
  description: string | null;
  weight_percentage: number;
  anchor_1: string | null;
  anchor_3: string | null;
  anchor_5: string | null;
  sort_order: number;
};
type ModelWeights = {
  teaching_weight: number;
  compliance_weight: number;
  project_weight: number;
  final_teaching_weight: number;
  final_compliance_weight: number;
  final_project_weight: number;
};
type CriterionWithSection = EvaluationCriterion & {
  section: { title: string; sort_order: number; is_scored: boolean } | null;
};

type Answer = {
  score?: number;
  observed: boolean;
  compliance?: ComplianceResult;
  timestamp: string;
  evidence: string;
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

const defaultWeights: ModelWeights = {
  teaching_weight: 70,
  compliance_weight: 20,
  project_weight: 10,
  final_teaching_weight: 60,
  final_compliance_weight: 20,
  final_project_weight: 20,
};

const emptyMetadata = {
  tutorId: '',
  sessionDate: '',
  cycleId: '',
  orgId: '',
  schoolBranch: '',
  courseTrack: '',
  sessionTopic: '',
  sessionFormat: '',
  evaluationMode: 'normal_session' as 'normal_session' | 'session_12',
  sessionId: '',
  studentsPresent: '',
  ageLevel: '',
  observationScope: 'full_session',
  observationMinutes: '',
  environmentReadiness: '',
  intendedLearningOutcome: '',
  externalSchoolCause: '',
  contextDetails: '',
  learningOutcomeStatus: 'not_observed',
  followUpStatus: 'none',
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

const complianceOptions: Array<{ value: ComplianceResult; label: string; hint: string }> = [
  { value: 'clear', label: 'Clear', hint: 'No issue observed.' },
  { value: 'coaching_note', label: 'Coaching Note', hint: 'Minor or low-impact issue; feedback only.' },
  { value: 'yellow_flag', label: 'Yellow Flag', hint: 'Material or avoidable issue requiring corrective action.' },
  { value: 'red_flag', label: 'Red Flag', hint: 'Critical breach requiring immediate escalation.' },
  { value: 'external_cause', label: 'External Cause', hint: 'Record the context and do not penalise the tutor.' },
  { value: 'not_applicable', label: 'N/A', hint: 'The item was not applicable to this observation.' },
];

const complianceFactors: Partial<Record<ComplianceResult, number>> = {
  clear: 1,
  coaching_note: 0.75,
  yellow_flag: 0.5,
  red_flag: 0,
};

function timestampToSeconds(timestamp: string) {
  if (!timestamp) return null;
  const [minutesText, secondsText] = timestamp.split(':');
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

function blankAnswer(): Answer {
  return {
    observed: true,
    timestamp: '',
    evidence: '',
    severityReason: '',
    externalDetails: '',
  };
}

export function NewEvaluationPage() {
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState<CriterionWithSection[]>([]);
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [projectMetrics, setProjectMetrics] = useState<ProjectMetric[]>([]);
  const [weights, setWeights] = useState<ModelWeights>(defaultWeights);
  const [metadata, setMetadata] = useState(emptyMetadata);
  const [feedback, setFeedback] = useState(emptyFeedback);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [projectAnswers, setProjectAnswers] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadFormData() {
      const [criteriaResult, tutorsResult, orgsResult, settingsResult, cyclesResult, projectMetricsResult] = await Promise.all([
        supabase
          .from('evaluation_criteria')
          .select('id, section_id, code, title, description, max_score, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order, criterion_type, section:evaluation_sections(title, sort_order, is_scored)')
          .eq('is_active', true)
          .order('sort_order'),
        supabase.from('tutors').select('id, employee_code, full_name').eq('is_active', true).order('full_name'),
        supabase.from('projects').select('id, name, description').eq('is_active', true).order('sort_order').order('name'),
        supabase
          .from('quality_model_settings')
          .select('teaching_weight, compliance_weight, project_weight, final_teaching_weight, final_compliance_weight, final_project_weight')
          .eq('id', true)
          .single(),
        supabase.from('evaluation_cycles').select('id, name, start_date, end_date, status, is_default').order('start_date', { ascending: false }),
        supabase
          .from('project_evaluation_metrics')
          .select('id, scope, code, title, description, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order')
          .eq('is_active', true)
          .order('scope')
          .order('sort_order'),
      ]);

      const firstError = criteriaResult.error
        || tutorsResult.error
        || orgsResult.error
        || settingsResult.error
        || cyclesResult.error
        || projectMetricsResult.error;

      if (firstError) {
        setError(firstError.message);
      } else {
        const loadedCycles = (cyclesResult.data ?? []) as CycleOption[];
        setCriteria((criteriaResult.data ?? []) as unknown as CriterionWithSection[]);
        setTutors((tutorsResult.data ?? []) as TutorOption[]);
        setOrgs((orgsResult.data ?? []) as OrgOption[]);
        setWeights(settingsResult.data as ModelWeights);
        setCycles(loadedCycles);
        setProjectMetrics((projectMetricsResult.data ?? []) as ProjectMetric[]);
        const defaultCycle = loadedCycles.find((cycle) => cycle.is_default) ?? loadedCycles.find((cycle) => cycle.status === 'active');
        if (defaultCycle) setMetadata((current) => ({ ...current, cycleId: defaultCycle.id }));
      }
      setLoading(false);
    }

    void loadFormData();
  }, []);

  const teachingCriteria = useMemo(
    () => criteria.filter((criterion) => criterion.criterion_type === 'rating').sort((a, b) => a.sort_order - b.sort_order),
    [criteria],
  );
  const complianceCriteria = useMemo(
    () => criteria.filter((criterion) => criterion.criterion_type === 'compliance').sort((a, b) => a.sort_order - b.sort_order),
    [criteria],
  );
  const selectedProjectMetrics = useMemo(
    () => projectMetrics.filter((metric) => metric.scope === metadata.evaluationMode).sort((a, b) => a.sort_order - b.sort_order),
    [metadata.evaluationMode, projectMetrics],
  );

  const effectiveWeights = metadata.evaluationMode === 'session_12'
    ? {
        teaching: Number(weights.final_teaching_weight),
        compliance: Number(weights.final_compliance_weight),
        project: Number(weights.final_project_weight),
      }
    : {
        teaching: Number(weights.teaching_weight),
        compliance: Number(weights.compliance_weight),
        project: Number(weights.project_weight),
      };

  const sectionTitle = metadata.evaluationMode === 'session_12'
    ? 'Final Project Evaluation – Session 12'
    : 'Project Evaluation Quality';

  const scoreSummary = useMemo(() => {
    const activeTeachingWeight = teachingCriteria.reduce((total, criterion) => total + Number(criterion.weight_percentage), 0);
    const teachingScale = activeTeachingWeight ? effectiveWeights.teaching / activeTeachingWeight : 0;
    const complianceItemWeight = complianceCriteria.length ? effectiveWeights.compliance / complianceCriteria.length : 0;

    const observedRatings = teachingCriteria.filter((criterion) => {
      const answer = answers[criterion.id];
      return answer?.observed && answer.score;
    });
    const teachingEarned = observedRatings.reduce((total, criterion) => {
      const score = answers[criterion.id]?.score ?? 0;
      const absoluteWeight = Number(criterion.weight_percentage) * teachingScale;
      return total + (score / 5) * absoluteWeight;
    }, 0);
    const teachingObservedWeight = observedRatings.reduce(
      (total, criterion) => total + Number(criterion.weight_percentage) * teachingScale,
      0,
    );

    const assessedCompliance = complianceCriteria.filter((criterion) => {
      const result = answers[criterion.id]?.compliance;
      return result && result in complianceFactors;
    });
    const complianceEarned = assessedCompliance.reduce((total, criterion) => {
      const result = answers[criterion.id]?.compliance;
      return total + (result ? (complianceFactors[result] ?? 0) * complianceItemWeight : 0);
    }, 0);
    const complianceObservedWeight = assessedCompliance.length * complianceItemWeight;

    const observedProjectMetrics = selectedProjectMetrics.filter((metric) => {
      const answer = projectAnswers[metric.id];
      return answer?.observed && answer.score;
    });
    const projectEarned = observedProjectMetrics.reduce((total, metric) => {
      const answer = projectAnswers[metric.id];
      const absoluteWeight = effectiveWeights.project * (Number(metric.weight_percentage) / 100);
      return total + ((answer?.score ?? 0) / 5) * absoluteWeight;
    }, 0);
    const projectObservedWeight = observedProjectMetrics.reduce(
      (total, metric) => total + effectiveWeights.project * (Number(metric.weight_percentage) / 100),
      0,
    );

    const earned = teachingEarned + complianceEarned + projectEarned;
    const observedWeight = teachingObservedWeight + complianceObservedWeight + projectObservedWeight;

    return {
      earned: Math.round(earned * 100) / 100,
      observedWeight: Math.round(observedWeight * 100) / 100,
      percentage: observedWeight ? Math.round((earned / observedWeight) * 100) : 0,
      teachingPercentage: teachingObservedWeight ? Math.round((teachingEarned / teachingObservedWeight) * 100) : null,
      compliancePercentage: complianceObservedWeight ? Math.round((complianceEarned / complianceObservedWeight) * 100) : null,
      projectPercentage: projectObservedWeight ? Math.round((projectEarned / projectObservedWeight) * 100) : null,
      teachingScale,
      complianceItemWeight,
    };
  }, [answers, complianceCriteria, effectiveWeights.compliance, effectiveWeights.project, effectiveWeights.teaching, projectAnswers, selectedProjectMetrics, teachingCriteria]);

  function updateAnswer(criterionId: string, patch: Partial<Answer>) {
    setAnswers((current) => ({
      ...current,
      [criterionId]: { ...(current[criterionId] ?? blankAnswer()), ...patch },
    }));
  }

  function updateProjectAnswer(metricId: string, patch: Partial<Answer>) {
    setProjectAnswers((current) => ({
      ...current,
      [metricId]: { ...(current[metricId] ?? blankAnswer()), ...patch },
    }));
  }

  function updateSessionDate(sessionDate: string) {
    const matchedCycle = cycles.find((cycle) => sessionDate >= cycle.start_date && sessionDate <= cycle.end_date);
    setMetadata((current) => ({ ...current, sessionDate, cycleId: matchedCycle?.id ?? current.cycleId }));
  }

  async function saveReview(status: 'draft' | 'submitted') {
    setError('');
    if (!metadata.tutorId) {
      setError('Tutor name is required. All other context and feedback fields are optional.');
      return;
    }

    setSaving(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError ?? new Error('No authenticated user.');

      const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .insert({
          tutor_id: metadata.tutorId,
          evaluator_id: userData.user.id,
          session_date: metadata.sessionDate || null,
          cycle_id: metadata.cycleId || null,
          project_id: metadata.orgId || null,
          school_branch: metadata.schoolBranch || null,
          course_track: metadata.courseTrack || null,
          session_topic: metadata.sessionTopic || null,
          session_type: metadata.sessionFormat || null,
          evaluation_mode: metadata.evaluationMode,
          external_session_id: metadata.sessionId || null,
          students_present: metadata.studentsPresent ? Number(metadata.studentsPresent) : null,
          age_level: metadata.ageLevel || null,
          observation_scope: metadata.observationScope,
          observation_minutes: metadata.observationMinutes ? Number(metadata.observationMinutes) : null,
          environment_readiness: metadata.environmentReadiness || null,
          intended_learning_outcome: metadata.intendedLearningOutcome || null,
          external_school_cause: metadata.externalSchoolCause || null,
          context_details: metadata.contextDetails || null,
          learning_outcome_status: metadata.learningOutcomeStatus,
          follow_up_status: metadata.followUpStatus,
          project_section_title: sectionTitle,
          project_section_weight_snapshot: effectiveWeights.project,
          project_weight_snapshot: effectiveWeights.project,
          project_score: null,
          status,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        })
        .select('id')
        .single();

      if (reviewError) throw reviewError;

      const scoreRows = criteria
        .filter((criterion) => {
          const answer = answers[criterion.id];
          if (!answer) return false;
          if (criterion.criterion_type === 'rating') return !answer.observed || Boolean(answer.score);
          return Boolean(answer.compliance);
        })
        .map((criterion) => {
          const answer = answers[criterion.id];
          if (criterion.criterion_type === 'rating') {
            return {
              review_id: review.id,
              criterion_id: criterion.id,
              numeric_score: answer.observed ? answer.score ?? null : null,
              is_observed: answer.observed,
              compliance_result: null,
              is_applicable: null,
              is_external: false,
              external_details: null,
              severity_reason: null,
              weight_snapshot: Number(criterion.weight_percentage) * scoreSummary.teachingScale,
              timestamp_seconds: timestampToSeconds(answer.timestamp),
              evidence: answer.evidence.trim() || null,
            };
          }

          const result = answer.compliance as ComplianceResult;
          return {
            review_id: review.id,
            criterion_id: criterion.id,
            numeric_score: null,
            is_observed: true,
            compliance_result: result,
            is_applicable: result !== 'not_applicable',
            is_external: result === 'external_cause',
            external_details: result === 'external_cause' ? answer.externalDetails.trim() || null : null,
            severity_reason: ['coaching_note', 'yellow_flag', 'red_flag'].includes(result)
              ? answer.severityReason.trim() || null
              : null,
            weight_snapshot: scoreSummary.complianceItemWeight,
            timestamp_seconds: timestampToSeconds(answer.timestamp),
            evidence: answer.evidence.trim() || null,
          };
        });

      if (scoreRows.length) {
        const { error: scoresError } = await supabase.from('review_scores').insert(scoreRows);
        if (scoresError) throw scoresError;
      }

      const projectRows = selectedProjectMetrics
        .filter((metric) => {
          const answer = projectAnswers[metric.id];
          return Boolean(answer) && (!answer.observed || Boolean(answer.score));
        })
        .map((metric) => {
          const answer = projectAnswers[metric.id];
          return {
            review_id: review.id,
            metric_id: metric.id,
            numeric_score: answer.observed ? answer.score ?? null : null,
            is_observed: answer.observed,
            evidence: answer.evidence.trim() || null,
            timestamp_seconds: timestampToSeconds(answer.timestamp),
            weight_snapshot: effectiveWeights.project * (Number(metric.weight_percentage) / 100),
          };
        });

      if (projectRows.length) {
        const { error: projectError } = await supabase.from('review_project_evaluations').insert(projectRows);
        if (projectError) throw projectError;
      }

      const hasFeedback = Object.values(feedback).some((value) => value.trim());
      if (hasFeedback) {
        const { error: feedbackError } = await supabase.from('review_feedback').insert({
          review_id: review.id,
          observed_strength: feedback.observedStrength.trim() || null,
          development_priority: feedback.developmentPriority.trim() || null,
          student_impact: feedback.studentImpact.trim() || null,
          required_action: feedback.requiredAction.trim() || null,
          follow_up_plan: feedback.followUpPlan.trim() || null,
          follow_up_date: feedback.followUpDate || null,
          internal_notes: feedback.internalNotes.trim() || null,
        });
        if (feedbackError) throw feedbackError;
      }

      navigate('/reviews', {
        replace: true,
        state: { notice: status === 'draft' ? 'Draft saved.' : 'Evaluation submitted for validation.' },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save the evaluation.');
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveReview('submitted');
  }

  if (loading) return <div className="screen-center">Loading evaluation template…</div>;

  return (
    <form className="page-stack evaluation-v2-page" onSubmit={handleSubmit}>
      <header className="page-header sticky-header evaluation-dynamic-header">
        <div>
          <p className="eyebrow">QC workspace</p>
          <h1>New onsite observation</h1>
          <p>Choose the evaluation type first. Section 3 and its weight change automatically.</p>
          <div className="evaluation-weight-chips">
            <span>Teaching {effectiveWeights.teaching}%</span>
            <span>{sectionTitle} {effectiveWeights.project}%</span>
            <span>Compliance {effectiveWeights.compliance}%</span>
          </div>
        </div>
        <div className="score-pill">
          <span>Live overall score</span>
          <strong>{scoreSummary.earned} / {scoreSummary.observedWeight || 100}</strong>
          <small>{scoreSummary.percentage}%</small>
        </div>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="panel form-section">
        <div className="panel-heading">
          <div><p className="eyebrow">Section 1 · Session context</p><h2>Evaluator & session context</h2><p>Tutor is the only required field.</p></div>
        </div>
        <div className="evaluation-mode-picker">
          <button type="button" className={metadata.evaluationMode === 'normal_session' ? 'selected' : ''} onClick={() => setMetadata({ ...metadata, evaluationMode: 'normal_session' })}>
            <strong>Normal Session</strong><span>70% Teaching · 10% Project Evaluation · 20% Compliance</span>
          </button>
          <button type="button" className={metadata.evaluationMode === 'session_12' ? 'selected' : ''} onClick={() => setMetadata({ ...metadata, evaluationMode: 'session_12' })}>
            <strong>Session 12 – Final Project</strong><span>60% Teaching · 20% Final Project · 20% Compliance</span>
          </button>
        </div>
        <div className="form-grid">
          <label>Tutor *<select value={metadata.tutorId} onChange={(event) => setMetadata({ ...metadata, tutorId: event.target.value })} required><option value="">Select tutor</option>{tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.employee_code} — {tutor.full_name}</option>)}</select></label>
          <label>Session date<input type="date" value={metadata.sessionDate} onChange={(event) => updateSessionDate(event.target.value)} /></label>
          <label>Evaluation cycle<select value={metadata.cycleId} onChange={(event) => setMetadata({ ...metadata, cycleId: event.target.value })}><option value="">No cycle selected</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}{cycle.status === 'closed' ? ' · Closed' : ''}</option>)}</select></label>
          <label>Org.<select value={metadata.orgId} onChange={(event) => setMetadata({ ...metadata, orgId: event.target.value })}><option value="">No Org. selected</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          <label>School / branch<input value={metadata.schoolBranch} onChange={(event) => setMetadata({ ...metadata, schoolBranch: event.target.value })} /></label>
          <label>Session format<select value={metadata.sessionFormat} onChange={(event) => setMetadata({ ...metadata, sessionFormat: event.target.value })}><option value="">Not specified</option><option value="group">Group</option><option value="one_to_one">One-to-one</option></select></label>
          <label>Students present<input type="number" min="0" value={metadata.studentsPresent} onChange={(event) => setMetadata({ ...metadata, studentsPresent: event.target.value })} /></label>
          <label>Age / level<input value={metadata.ageLevel} onChange={(event) => setMetadata({ ...metadata, ageLevel: event.target.value })} /></label>
          <label>Observation scope<select value={metadata.observationScope} onChange={(event) => setMetadata({ ...metadata, observationScope: event.target.value })}><option value="full_session">Full session</option><option value="partial_session">Partial session</option></select></label>
          <label>Observed minutes<input type="number" min="1" value={metadata.observationMinutes} onChange={(event) => setMetadata({ ...metadata, observationMinutes: event.target.value })} /></label>
          <label>Environment readiness<input value={metadata.environmentReadiness} onChange={(event) => setMetadata({ ...metadata, environmentReadiness: event.target.value })} placeholder="Ready, delayed, device shortage…" /></label>
          <label>Course / track<input value={metadata.courseTrack} onChange={(event) => setMetadata({ ...metadata, courseTrack: event.target.value })} /></label>
          <label>Session topic<input value={metadata.sessionTopic} onChange={(event) => setMetadata({ ...metadata, sessionTopic: event.target.value })} /></label>
          <label>Session ID<input value={metadata.sessionId} onChange={(event) => setMetadata({ ...metadata, sessionId: event.target.value })} /></label>
          <label className="full-width">Intended learning outcome<textarea rows={2} value={metadata.intendedLearningOutcome} onChange={(event) => setMetadata({ ...metadata, intendedLearningOutcome: event.target.value })} /></label>
          <label>Learning outcome status<select value={metadata.learningOutcomeStatus} onChange={(event) => setMetadata({ ...metadata, learningOutcomeStatus: event.target.value })}><option value="achieved">Achieved</option><option value="partially_achieved">Partially achieved</option><option value="not_achieved">Not achieved</option><option value="not_observed">Not observed</option></select></label>
          <label>Follow-up status<select value={metadata.followUpStatus} onChange={(event) => setMetadata({ ...metadata, followUpStatus: event.target.value })}><option value="none">None</option><option value="routine">Routine</option><option value="required">Required</option><option value="urgent">Urgent</option></select></label>
          <label className="full-width">External / school cause<textarea rows={2} value={metadata.externalSchoolCause} onChange={(event) => setMetadata({ ...metadata, externalSchoolCause: event.target.value })} placeholder="Record anything outside the tutor's control." /></label>
          <label className="full-width">Context details<textarea rows={2} value={metadata.contextDetails} onChange={(event) => setMetadata({ ...metadata, contextDetails: event.target.value })} /></label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Section 2 · {effectiveWeights.teaching}%</p><h2>Teaching Quality</h2><p>Unanswered items are excluded from the score.</p></div></div>
        <div className="criteria-list">
          {teachingCriteria.map((criterion) => {
            const answer = answers[criterion.id] ?? blankAnswer();
            return (
              <article className="criterion-card" key={criterion.id}>
                <div className="criterion-copy"><span className="criterion-code">{criterion.code}</span><h3>{criterion.title}</h3>{criterion.description && <p>{criterion.description}</p>}</div>
                <label className="checkbox-row"><input type="checkbox" checked={!answer.observed} onChange={(event) => updateAnswer(criterion.id, { observed: !event.target.checked, score: undefined })} />Not observed during the observation scope</label>
                {answer.observed && <fieldset className="rating-control"><legend>Anchored rating</legend>{[1, 2, 3, 4, 5].map((score) => <label key={score} className={answer.score === score ? 'selected' : ''}><input type="radio" name={`score-${criterion.id}`} checked={answer.score === score} onChange={() => updateAnswer(criterion.id, { score })} /><span>{score}</span></label>)}</fieldset>}
                <div className="content-grid"><div><strong>1 · Not evident</strong><p>{criterion.anchor_1}</p></div><div><strong>3 · Effective practice</strong><p>{criterion.anchor_3}</p></div><div><strong>5 · Highly effective</strong><p>{criterion.anchor_5}</p></div></div>
                <div className="evidence-grid"><label>Time note (optional)<input placeholder="e.g. 12:35" pattern="^[0-9]{1,3}:[0-5][0-9]$" value={answer.timestamp} onChange={(event) => updateAnswer(criterion.id, { timestamp: event.target.value })} /></label><label>Observed evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateAnswer(criterion.id, { evidence: event.target.value })} /></label></div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel form-section project-evaluation-section">
        <div className="panel-heading"><div><p className="eyebrow">Section 3 · {effectiveWeights.project}%</p><h2>{sectionTitle}</h2><p>{metadata.evaluationMode === 'session_12' ? 'Evaluate the student final outcome, ownership, presentation, and the tutor final evaluation.' : 'Audit whether the tutor evaluated the student project fairly and gave clear, useful feedback.'}</p></div><span className="model-total-chip valid">{scoreSummary.projectPercentage ?? '—'}%</span></div>
        <div className="criteria-list">
          {selectedProjectMetrics.map((metric) => {
            const answer = projectAnswers[metric.id] ?? blankAnswer();
            return (
              <article className="criterion-card project-metric-card" key={metric.id}>
                <div className="criterion-copy"><span className="criterion-code">{metric.code}</span><h3>{metric.title} · {metric.weight_percentage}% of Section 3</h3>{metric.description && <p>{metric.description}</p>}</div>
                <label className="checkbox-row"><input type="checkbox" checked={!answer.observed} onChange={(event) => updateProjectAnswer(metric.id, { observed: !event.target.checked, score: undefined })} />Not observed / external cause</label>
                {answer.observed && <fieldset className="rating-control"><legend>Anchored rating</legend>{[1, 2, 3, 4, 5].map((score) => <label key={score} className={answer.score === score ? 'selected' : ''}><input type="radio" name={`project-score-${metric.id}`} checked={answer.score === score} onChange={() => updateProjectAnswer(metric.id, { score })} /><span>{score}</span></label>)}</fieldset>}
                <div className="content-grid"><div><strong>1 · Limited</strong><p>{metric.anchor_1}</p></div><div><strong>3 · Partially demonstrated</strong><p>{metric.anchor_3}</p></div><div><strong>5 · Fully demonstrated</strong><p>{metric.anchor_5}</p></div></div>
                <div className="evidence-grid"><label>Time note (optional)<input placeholder="e.g. 48:10" pattern="^[0-9]{1,3}:[0-5][0-9]$" value={answer.timestamp} onChange={(event) => updateProjectAnswer(metric.id, { timestamp: event.target.value })} /></label><label>{answer.observed ? 'Evaluation evidence' : 'Not observed / external cause reason'}<textarea rows={2} value={answer.evidence} onChange={(event) => updateProjectAnswer(metric.id, { evidence: event.target.value })} /></label></div>
              </article>
            );
          })}
          {selectedProjectMetrics.length === 0 && <div className="empty-state">No active metrics are configured for this evaluation type.</div>}
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Section 4 · {effectiveWeights.compliance}%</p><h2>Compliance</h2><p>Active items share the compliance weight equally.</p></div></div>
        <div className="criteria-list">
          {complianceCriteria.map((criterion) => {
            const answer = answers[criterion.id] ?? blankAnswer();
            const needsSeverityReason = answer.compliance && ['coaching_note', 'yellow_flag', 'red_flag'].includes(answer.compliance);
            return (
              <article className="criterion-card" key={criterion.id}>
                <div className="criterion-copy"><span className="criterion-code">{criterion.code}</span><h3>{criterion.title}</h3>{criterion.description && <p>{criterion.description}</p>}</div>
                <fieldset className="compliance-control"><legend>Decision path outcome</legend>{complianceOptions.map((option) => <label key={option.value} className={answer.compliance === option.value ? `selected ${option.value}` : ''} title={option.hint}><input type="radio" name={`compliance-${criterion.id}`} checked={answer.compliance === option.value} onChange={() => updateAnswer(criterion.id, { compliance: option.value })} /><span>{option.label}</span></label>)}</fieldset>
                {answer.compliance === 'external_cause' && <label>External cause details<textarea rows={2} value={answer.externalDetails} onChange={(event) => updateAnswer(criterion.id, { externalDetails: event.target.value })} /></label>}
                {needsSeverityReason && <label>Severity rationale<textarea rows={2} value={answer.severityReason} onChange={(event) => updateAnswer(criterion.id, { severityReason: event.target.value })} /></label>}
                <div className="evidence-grid"><label>Time note (optional)<input placeholder="e.g. 12:35" pattern="^[0-9]{1,3}:[0-5][0-9]$" value={answer.timestamp} onChange={(event) => updateAnswer(criterion.id, { timestamp: event.target.value })} /></label><label>Observed evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateAnswer(criterion.id, { evidence: event.target.value })} /></label></div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Section 5 · Optional feedback</p><h2>Evidence-based feedback</h2><p>Action plan and required action are optional.</p></div></div>
        <div className="form-grid">
          <label className="full-width">Observed strength<textarea rows={3} value={feedback.observedStrength} onChange={(event) => setFeedback({ ...feedback, observedStrength: event.target.value })} /></label>
          <label className="full-width">Development priority<textarea rows={3} value={feedback.developmentPriority} onChange={(event) => setFeedback({ ...feedback, developmentPriority: event.target.value })} /></label>
          <label className="full-width">Student impact<textarea rows={2} value={feedback.studentImpact} onChange={(event) => setFeedback({ ...feedback, studentImpact: event.target.value })} /></label>
          <label className="full-width">Required action (optional)<textarea rows={3} value={feedback.requiredAction} onChange={(event) => setFeedback({ ...feedback, requiredAction: event.target.value })} /></label>
          <label>Follow-up date<input type="date" value={feedback.followUpDate} onChange={(event) => setFeedback({ ...feedback, followUpDate: event.target.value })} /></label>
          <label>Action / follow-up plan (optional)<input value={feedback.followUpPlan} onChange={(event) => setFeedback({ ...feedback, followUpPlan: event.target.value })} /></label>
          <label className="full-width">Internal quality notes<textarea rows={2} value={feedback.internalNotes} onChange={(event) => setFeedback({ ...feedback, internalNotes: event.target.value })} /></label>
        </div>
      </section>

      <footer className="form-actions">
        <button className="button button-secondary" type="button" disabled={saving} onClick={() => void saveReview('draft')}>Save draft</button>
        <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Submit for validation'}</button>
      </footer>
    </form>
  );
}
