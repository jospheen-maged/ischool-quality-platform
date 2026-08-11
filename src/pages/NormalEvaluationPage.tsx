import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ComplianceResult, EvaluationCriterion } from '../types';
import '../evaluation-model-v2.css';

type TutorOption = { id: string; employee_code: string; full_name: string };
type OrgOption = { id: string; name: string };
type CycleOption = { id: string; name: string; start_date: string; end_date: string; status: 'active' | 'closed'; is_default: boolean };
type ModelWeights = { teaching_weight: number; compliance_weight: number; project_weight: number };
type CriterionWithSection = EvaluationCriterion & { section: { title: string; sort_order: number; is_scored: boolean } | null };
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

const emptyMetadata = {
  tutorId: '',
  sessionDate: '',
  cycleId: '',
  orgId: '',
  schoolBranch: '',
  courseTrack: '',
  sessionTopic: '',
  sessionFormat: '',
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

const defaultWeights: ModelWeights = { teaching_weight: 70, compliance_weight: 20, project_weight: 10 };
const complianceOptions: Array<{ value: ComplianceResult; label: string }> = [
  { value: 'clear', label: 'Clear' },
  { value: 'coaching_note', label: 'Coaching Note' },
  { value: 'yellow_flag', label: 'Yellow Flag' },
  { value: 'red_flag', label: 'Red Flag' },
  { value: 'external_cause', label: 'External Cause' },
  { value: 'not_applicable', label: 'N/A' },
];
const complianceFactors: Partial<Record<ComplianceResult, number>> = { clear: 1, coaching_note: 0.75, yellow_flag: 0.5, red_flag: 0 };

function blankAnswer(): Answer {
  return { observed: true, timestamp: '', evidence: '', severityReason: '', externalDetails: '' };
}

function timestampToSeconds(timestamp: string) {
  if (!timestamp) return null;
  const [minutesText, secondsText] = timestamp.split(':');
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds < 0 || seconds > 59) return null;
  return minutes * 60 + seconds;
}

export function NormalEvaluationPage() {
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState<CriterionWithSection[]>([]);
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [weights, setWeights] = useState<ModelWeights>(defaultWeights);
  const [metadata, setMetadata] = useState(emptyMetadata);
  const [feedback, setFeedback] = useState(emptyFeedback);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadFormData() {
      const [criteriaResult, tutorsResult, orgsResult, settingsResult, cyclesResult] = await Promise.all([
        supabase
          .from('evaluation_criteria')
          .select('id, section_id, code, title, description, max_score, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order, criterion_type, section:evaluation_sections(title, sort_order, is_scored)')
          .eq('is_active', true)
          .order('sort_order'),
        supabase.from('tutors').select('id, employee_code, full_name').eq('is_active', true).order('full_name'),
        supabase.from('projects').select('id, name').eq('is_active', true).order('sort_order').order('name'),
        supabase.from('quality_model_settings').select('teaching_weight, compliance_weight, project_weight').eq('id', true).single(),
        supabase.from('evaluation_cycles').select('id, name, start_date, end_date, status, is_default').order('start_date', { ascending: false }),
      ]);

      const firstError = criteriaResult.error || tutorsResult.error || orgsResult.error || settingsResult.error || cyclesResult.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        const loadedCycles = (cyclesResult.data ?? []) as CycleOption[];
        setCriteria((criteriaResult.data ?? []) as unknown as CriterionWithSection[]);
        setTutors((tutorsResult.data ?? []) as TutorOption[]);
        setOrgs((orgsResult.data ?? []) as OrgOption[]);
        setWeights(settingsResult.data as ModelWeights);
        setCycles(loadedCycles);
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

  const activeTeachingWeight = useMemo(
    () => teachingCriteria.reduce((sum, criterion) => sum + Number(criterion.weight_percentage), 0),
    [teachingCriteria],
  );
  const teachingScale = activeTeachingWeight ? Number(weights.teaching_weight) / activeTeachingWeight : 0;
  const complianceItemWeight = complianceCriteria.length ? Number(weights.compliance_weight) / complianceCriteria.length : 0;

  const scoreSummary = useMemo(() => {
    const observedTeaching = teachingCriteria.filter((criterion) => answers[criterion.id]?.observed && answers[criterion.id]?.score);
    const teachingEarned = observedTeaching.reduce(
      (sum, criterion) => sum + ((answers[criterion.id]?.score ?? 0) / 5) * Number(criterion.weight_percentage) * teachingScale,
      0,
    );
    const teachingObservedWeight = observedTeaching.reduce(
      (sum, criterion) => sum + Number(criterion.weight_percentage) * teachingScale,
      0,
    );
    const assessedCompliance = complianceCriteria.filter((criterion) => {
      const result = answers[criterion.id]?.compliance;
      return result && result in complianceFactors;
    });
    const complianceEarned = assessedCompliance.reduce(
      (sum, criterion) => sum + (complianceFactors[answers[criterion.id]?.compliance as ComplianceResult] ?? 0) * complianceItemWeight,
      0,
    );
    const complianceObservedWeight = assessedCompliance.length * complianceItemWeight;
    const earned = teachingEarned + complianceEarned;
    const observedWeight = teachingObservedWeight + complianceObservedWeight;
    return {
      earned: Math.round(earned * 100) / 100,
      observedWeight: Math.round(observedWeight * 100) / 100,
      percentage: observedWeight ? Math.round((earned / observedWeight) * 100) : 0,
      teachingCompleted: observedTeaching.length,
      complianceCompleted: complianceCriteria.filter((criterion) => Boolean(answers[criterion.id]?.compliance)).length,
    };
  }, [answers, complianceCriteria, complianceItemWeight, teachingCriteria, teachingScale]);

  function updateAnswer(id: string, patch: Partial<Answer>) {
    setAnswers((current) => ({ ...current, [id]: { ...(current[id] ?? blankAnswer()), ...patch } }));
  }

  function updateSessionDate(sessionDate: string) {
    const matchedCycle = cycles.find((cycle) => sessionDate >= cycle.start_date && sessionDate <= cycle.end_date);
    setMetadata((current) => ({ ...current, sessionDate, cycleId: matchedCycle?.id ?? current.cycleId }));
  }

  async function saveReview(status: 'draft' | 'submitted') {
    setError('');
    if (!metadata.tutorId) {
      setError('Tutor name is required.');
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
          evaluation_mode: 'normal_session',
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
          project_section_title: null,
          project_section_weight_snapshot: null,
          project_weight_snapshot: null,
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
          return criterion.criterion_type === 'rating' ? !answer.observed || Boolean(answer.score) : Boolean(answer.compliance);
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
              weight_snapshot: Number(criterion.weight_percentage) * teachingScale,
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
            severity_reason: ['coaching_note', 'yellow_flag', 'red_flag'].includes(result) ? answer.severityReason.trim() || null : null,
            weight_snapshot: complianceItemWeight,
            timestamp_seconds: timestampToSeconds(answer.timestamp),
            evidence: answer.evidence.trim() || null,
          };
        });

      if (scoreRows.length) {
        const { error: scoresError } = await supabase.from('review_scores').insert(scoreRows);
        if (scoresError) throw scoresError;
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
        state: { notice: status === 'draft' ? 'Draft saved.' : 'Session evaluation submitted.' },
      });
    } catch (caught) {
      const message = caught && typeof caught === 'object' && 'message' in caught
        ? String((caught as { message: unknown }).message)
        : 'Unable to save the evaluation.';
      setError(message);
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
    <form className="page-stack evaluation-v2-page session-only-evaluation" onSubmit={handleSubmit}>
      <header className="page-header evaluation-dynamic-header">
        <div>
          <p className="eyebrow">QC workspace · Session observation</p>
          <h1>New Evaluation</h1>
          <p>Session observation only. Project Evaluation is completed in its own standalone workspace.</p>
          <div className="evaluation-weight-chips">
            <span>Teaching {weights.teaching_weight}%</span>
            <span>Compliance {weights.compliance_weight}%</span>
            <span className="standalone-chip">Project Audit {weights.project_weight}% · Separate</span>
          </div>
        </div>
        <div className="session-header-actions">
          <button className="button button-secondary" type="button" onClick={() => navigate('/project-evaluation-audit')}>Project Evaluation Audit</button>
          <div className="score-pill">
            <span>Session score</span>
            <strong>{scoreSummary.percentage}%</strong>
            <small>{scoreSummary.observedWeight ? `${scoreSummary.earned} / ${scoreSummary.observedWeight}` : 'Start scoring'}</small>
          </div>
        </div>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="panel form-section compact-context-section">
        <div className="panel-heading">
          <div><p className="eyebrow">1 · Session context</p><h2>Basic information</h2><p>Only Tutor is required.</p></div>
        </div>
        <div className="form-grid context-primary-grid">
          <label>Tutor *<select required value={metadata.tutorId} onChange={(event) => setMetadata({ ...metadata, tutorId: event.target.value })}><option value="">Select tutor</option>{tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.employee_code} — {tutor.full_name}</option>)}</select></label>
          <label>Session date<input type="date" value={metadata.sessionDate} onChange={(event) => updateSessionDate(event.target.value)} /></label>
          <label>Org.<select value={metadata.orgId} onChange={(event) => setMetadata({ ...metadata, orgId: event.target.value })}><option value="">No Org. selected</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          <label>Session ID<input value={metadata.sessionId} onChange={(event) => setMetadata({ ...metadata, sessionId: event.target.value })} /></label>
        </div>
        <details className="evaluation-more-details">
          <summary>More session details</summary>
          <div className="form-grid">
            <label>Evaluation cycle<select value={metadata.cycleId} onChange={(event) => setMetadata({ ...metadata, cycleId: event.target.value })}><option value="">No cycle selected</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
            <label>School / branch<input value={metadata.schoolBranch} onChange={(event) => setMetadata({ ...metadata, schoolBranch: event.target.value })} /></label>
            <label>Session format<select value={metadata.sessionFormat} onChange={(event) => setMetadata({ ...metadata, sessionFormat: event.target.value })}><option value="">Not specified</option><option value="group">Group</option><option value="one_to_one">One-to-one</option></select></label>
            <label>Students present<input type="number" min="0" value={metadata.studentsPresent} onChange={(event) => setMetadata({ ...metadata, studentsPresent: event.target.value })} /></label>
            <label>Age / level<input value={metadata.ageLevel} onChange={(event) => setMetadata({ ...metadata, ageLevel: event.target.value })} /></label>
            <label>Observation scope<select value={metadata.observationScope} onChange={(event) => setMetadata({ ...metadata, observationScope: event.target.value })}><option value="full_session">Full session</option><option value="partial_session">Partial session</option></select></label>
            <label>Observed minutes<input type="number" min="1" value={metadata.observationMinutes} onChange={(event) => setMetadata({ ...metadata, observationMinutes: event.target.value })} /></label>
            <label>Environment readiness<input value={metadata.environmentReadiness} onChange={(event) => setMetadata({ ...metadata, environmentReadiness: event.target.value })} /></label>
            <label>Course / track<input value={metadata.courseTrack} onChange={(event) => setMetadata({ ...metadata, courseTrack: event.target.value })} /></label>
            <label>Session topic<input value={metadata.sessionTopic} onChange={(event) => setMetadata({ ...metadata, sessionTopic: event.target.value })} /></label>
            <label className="full-width">Intended learning outcome<textarea rows={2} value={metadata.intendedLearningOutcome} onChange={(event) => setMetadata({ ...metadata, intendedLearningOutcome: event.target.value })} /></label>
            <label>Learning outcome status<select value={metadata.learningOutcomeStatus} onChange={(event) => setMetadata({ ...metadata, learningOutcomeStatus: event.target.value })}><option value="achieved">Achieved</option><option value="partially_achieved">Partially achieved</option><option value="not_achieved">Not achieved</option><option value="not_observed">Not observed</option></select></label>
            <label>Follow-up status<select value={metadata.followUpStatus} onChange={(event) => setMetadata({ ...metadata, followUpStatus: event.target.value })}><option value="none">None</option><option value="routine">Routine</option><option value="required">Required</option><option value="urgent">Urgent</option></select></label>
            <label className="full-width">External / school cause<textarea rows={2} value={metadata.externalSchoolCause} onChange={(event) => setMetadata({ ...metadata, externalSchoolCause: event.target.value })} /></label>
            <label className="full-width">Context details<textarea rows={2} value={metadata.contextDetails} onChange={(event) => setMetadata({ ...metadata, contextDetails: event.target.value })} /></label>
          </div>
        </details>
      </section>

      <section className="panel form-section">
        <div className="panel-heading evaluation-section-heading">
          <div><p className="eyebrow">2 · Teaching · {weights.teaching_weight}%</p><h2>Teaching Quality</h2><p>Rate only what was observed.</p></div>
          <span className="section-progress">{scoreSummary.teachingCompleted}/{teachingCriteria.length} scored</span>
        </div>
        <div className="criteria-list compact-criteria-list">
          {teachingCriteria.map((criterion) => {
            const answer = answers[criterion.id] ?? blankAnswer();
            return (
              <article className="criterion-card compact-criterion-card" key={criterion.id}>
                <div className="criterion-copy">
                  <span className="criterion-code">{criterion.code}</span>
                  <h3>{criterion.title}</h3>
                  {criterion.description && <p>{criterion.description}</p>}
                  <label className="checkbox-row"><input type="checkbox" checked={!answer.observed} onChange={(event) => updateAnswer(criterion.id, { observed: !event.target.checked, score: undefined })} />Not observed</label>
                </div>
                <div className="criterion-scoring-area">
                  <fieldset className="rating-control" disabled={!answer.observed}>
                    <legend>Score</legend>
                    {[1, 2, 3, 4, 5].map((score) => <label key={score} className={answer.score === score ? 'selected' : ''}><input type="radio" name={`teaching-${criterion.id}`} checked={answer.score === score} onChange={() => updateAnswer(criterion.id, { score })} /><span>{score}</span></label>)}
                  </fieldset>
                  <details className="rating-guide"><summary>View rating guide</summary><div className="rating-guide-grid"><div><strong>1 · Not evident</strong><p>{criterion.anchor_1}</p></div><div><strong>3 · Effective</strong><p>{criterion.anchor_3}</p></div><div><strong>5 · Highly effective</strong><p>{criterion.anchor_5}</p></div></div></details>
                </div>
                <div className="evidence-grid"><label>Timestamp<input value={answer.timestamp} placeholder="12:35" onChange={(event) => updateAnswer(criterion.id, { timestamp: event.target.value })} /></label><label>Evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateAnswer(criterion.id, { evidence: event.target.value })} /></label></div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading evaluation-section-heading">
          <div><p className="eyebrow">3 · Compliance · {weights.compliance_weight}%</p><h2>Compliance</h2><p>Record the outcome and evidence only.</p></div>
          <span className="section-progress">{scoreSummary.complianceCompleted}/{complianceCriteria.length} checked</span>
        </div>
        <div className="criteria-list compact-criteria-list">
          {complianceCriteria.map((criterion) => {
            const answer = answers[criterion.id] ?? blankAnswer();
            const needsReason = answer.compliance && ['coaching_note', 'yellow_flag', 'red_flag'].includes(answer.compliance);
            return (
              <article className="criterion-card compact-criterion-card compliance-criterion-card" key={criterion.id}>
                <div className="criterion-copy"><span className="criterion-code">{criterion.code}</span><h3>{criterion.title}</h3>{criterion.description && <p>{criterion.description}</p>}</div>
                <div className="criterion-scoring-area"><fieldset className="compliance-control"><legend>Result</legend>{complianceOptions.map((option) => <label key={option.value} className={answer.compliance === option.value ? `selected ${option.value}` : ''}><input type="radio" name={`compliance-${criterion.id}`} checked={answer.compliance === option.value} onChange={() => updateAnswer(criterion.id, { compliance: option.value })} /><span>{option.label}</span></label>)}</fieldset></div>
                {needsReason && <label className="full-width">Severity rationale<textarea rows={2} value={answer.severityReason} onChange={(event) => updateAnswer(criterion.id, { severityReason: event.target.value })} /></label>}
                {answer.compliance === 'external_cause' && <label className="full-width">External cause details<textarea rows={2} value={answer.externalDetails} onChange={(event) => updateAnswer(criterion.id, { externalDetails: event.target.value })} /></label>}
                <div className="evidence-grid"><label>Timestamp<input value={answer.timestamp} placeholder="12:35" onChange={(event) => updateAnswer(criterion.id, { timestamp: event.target.value })} /></label><label>Evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateAnswer(criterion.id, { evidence: event.target.value })} /></label></div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel form-section feedback-compact-section">
        <div className="panel-heading"><div><p className="eyebrow">4 · Feedback</p><h2>Evidence-based feedback</h2><p>Use one point per line for Strengths and Development Areas.</p></div></div>
        <div className="form-grid feedback-primary-grid">
          <label>Strengths<textarea rows={4} value={feedback.observedStrength} onChange={(event) => setFeedback({ ...feedback, observedStrength: event.target.value })} placeholder={'• Point 1\n• Point 2'} /></label>
          <label>Development Areas<textarea rows={4} value={feedback.developmentPriority} onChange={(event) => setFeedback({ ...feedback, developmentPriority: event.target.value })} placeholder={'• Point 1\n• Point 2'} /></label>
        </div>
        <details className="evaluation-more-details">
          <summary>Action plan & internal notes</summary>
          <div className="form-grid">
            <label className="full-width">Student impact<textarea rows={2} value={feedback.studentImpact} onChange={(event) => setFeedback({ ...feedback, studentImpact: event.target.value })} /></label>
            <label className="full-width">Required action<textarea rows={2} value={feedback.requiredAction} onChange={(event) => setFeedback({ ...feedback, requiredAction: event.target.value })} /></label>
            <label>Follow-up date<input type="date" value={feedback.followUpDate} onChange={(event) => setFeedback({ ...feedback, followUpDate: event.target.value })} /></label>
            <label>Follow-up plan<input value={feedback.followUpPlan} onChange={(event) => setFeedback({ ...feedback, followUpPlan: event.target.value })} /></label>
            <label className="full-width">Internal quality notes<textarea rows={2} value={feedback.internalNotes} onChange={(event) => setFeedback({ ...feedback, internalNotes: event.target.value })} /></label>
          </div>
        </details>
      </section>

      <footer className="form-actions">
        <button className="button button-secondary" type="button" disabled={saving} onClick={() => void saveReview('draft')}>{saving ? 'Saving…' : 'Save draft'}</button>
        <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit evaluation'}</button>
      </footer>
    </form>
  );
}
