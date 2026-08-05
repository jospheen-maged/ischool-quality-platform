import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { ComplianceResult, EvaluationCriterion } from '../types';

type TutorOption = { id: string; employee_code: string; full_name: string };
type ProjectOption = { id: string; name: string; description: string | null };
type ModelWeights = { teaching_weight: number; compliance_weight: number; project_weight: number };
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

const defaultWeights: ModelWeights = { teaching_weight: 70, compliance_weight: 20, project_weight: 10 };

const emptyMetadata = {
  tutorId: '',
  sessionDate: '',
  schoolBranch: '',
  courseTrack: '',
  sessionTopic: '',
  sessionType: '',
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
  projectId: '',
  projectScore: '',
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

export function NewEvaluationPage() {
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState<CriterionWithSection[]>([]);
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [weights, setWeights] = useState<ModelWeights>(defaultWeights);
  const [metadata, setMetadata] = useState(emptyMetadata);
  const [feedback, setFeedback] = useState(emptyFeedback);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadFormData() {
      const [criteriaResult, tutorsResult, projectsResult, settingsResult] = await Promise.all([
        supabase
          .from('evaluation_criteria')
          .select('id, section_id, code, title, description, max_score, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order, criterion_type, section:evaluation_sections(title, sort_order, is_scored)')
          .eq('is_active', true)
          .order('sort_order'),
        supabase.from('tutors').select('id, employee_code, full_name').eq('is_active', true).order('full_name'),
        supabase.from('projects').select('id, name, description').eq('is_active', true).order('sort_order').order('name'),
        supabase.from('quality_model_settings').select('teaching_weight, compliance_weight, project_weight').eq('id', true).single(),
      ]);

      const firstError = criteriaResult.error || tutorsResult.error || projectsResult.error || settingsResult.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setCriteria((criteriaResult.data ?? []) as unknown as CriterionWithSection[]);
        setTutors((tutorsResult.data ?? []) as TutorOption[]);
        setProjects((projectsResult.data ?? []) as ProjectOption[]);
        setWeights(settingsResult.data as ModelWeights);
      }
      setLoading(false);
    }

    void loadFormData();
  }, []);

  const groupedCriteria = useMemo(() => {
    const groups = new Map<string, CriterionWithSection[]>();
    criteria
      .slice()
      .sort((a, b) => (a.section?.sort_order ?? 0) - (b.section?.sort_order ?? 0) || a.sort_order - b.sort_order)
      .forEach((criterion) => {
        const title = criterion.section?.title ?? 'Evaluation';
        groups.set(title, [...(groups.get(title) ?? []), criterion]);
      });
    return [...groups.entries()];
  }, [criteria]);

  const scoreSummary = useMemo(() => {
    const ratingCriteria = criteria.filter((criterion) => criterion.criterion_type === 'rating');
    const complianceCriteria = criteria.filter((criterion) => criterion.criterion_type === 'compliance');
    const complianceItemWeight = complianceCriteria.length ? Number(weights.compliance_weight) / complianceCriteria.length : 0;

    const observedRatings = ratingCriteria.filter((criterion) => {
      const answer = answers[criterion.id];
      return answer?.observed && answer.score;
    });
    const teachingEarned = observedRatings.reduce((total, criterion) => {
      const score = answers[criterion.id]?.score ?? 0;
      return total + (score / 5) * Number(criterion.weight_percentage);
    }, 0);
    const teachingObservedWeight = observedRatings.reduce((total, criterion) => total + Number(criterion.weight_percentage), 0);

    const assessedCompliance = complianceCriteria.filter((criterion) => {
      const result = answers[criterion.id]?.compliance;
      return result && result in complianceFactors;
    });
    const complianceEarned = assessedCompliance.reduce((total, criterion) => {
      const result = answers[criterion.id]?.compliance;
      return total + (result ? (complianceFactors[result] ?? 0) * complianceItemWeight : 0);
    }, 0);
    const complianceObservedWeight = assessedCompliance.length * complianceItemWeight;

    const projectScore = metadata.projectScore ? Number(metadata.projectScore) : null;
    const projectObservedWeight = projectScore ? Number(weights.project_weight) : 0;
    const projectEarned = projectScore ? (projectScore / 5) * projectObservedWeight : 0;

    const earned = teachingEarned + complianceEarned + projectEarned;
    const observedWeight = teachingObservedWeight + complianceObservedWeight + projectObservedWeight;
    const percentage = observedWeight ? Math.round((earned / observedWeight) * 100) : 0;

    return {
      earned: Math.round(earned * 100) / 100,
      observedWeight: Math.round(observedWeight * 100) / 100,
      percentage,
      teachingPercentage: teachingObservedWeight ? Math.round((teachingEarned / teachingObservedWeight) * 100) : null,
      compliancePercentage: complianceObservedWeight ? Math.round((complianceEarned / complianceObservedWeight) * 100) : null,
      projectPercentage: projectScore ? Math.round((projectScore / 5) * 100) : null,
      complianceItemWeight,
    };
  }, [answers, criteria, metadata.projectScore, weights]);

  function updateAnswer(criterionId: string, patch: Partial<Answer>) {
    setAnswers((current) => {
      const existing = current[criterionId] ?? {
        observed: true,
        timestamp: '',
        evidence: '',
        severityReason: '',
        externalDetails: '',
      };
      return {
        ...current,
        [criterionId]: {
          ...existing,
          ...patch,
        },
      };
    });
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
          school_branch: metadata.schoolBranch || null,
          course_track: metadata.courseTrack || null,
          session_topic: metadata.sessionTopic || null,
          session_type: metadata.sessionType || null,
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
          project_id: metadata.projectId || null,
          project_score: metadata.projectScore ? Number(metadata.projectScore) : null,
          project_weight_snapshot: metadata.projectScore ? Number(weights.project_weight) : null,
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
              weight_snapshot: Number(criterion.weight_percentage),
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
    <form className="page-stack" onSubmit={handleSubmit}>
      <header className="page-header sticky-header evaluation-dynamic-header">
        <div>
          <p className="eyebrow">QC workspace</p>
          <h1>New onsite observation</h1>
          <p>Only the tutor is required. Add the context and evidence that were actually observed.</p>
          <div className="evaluation-weight-chips">
            <span>Teaching {weights.teaching_weight}%</span>
            <span>Compliance {weights.compliance_weight}%</span>
            <span>Project {weights.project_weight}%</span>
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
          <div><p className="eyebrow">Section 1 · Optional context</p><h2>Evaluator & session context</h2><p>Tutor is the only required field.</p></div>
        </div>
        <div className="form-grid">
          <label>Tutor *<select value={metadata.tutorId} onChange={(event) => setMetadata({ ...metadata, tutorId: event.target.value })} required><option value="">Select tutor</option>{tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.employee_code} — {tutor.full_name}</option>)}</select></label>
          <label>Session date<input type="date" value={metadata.sessionDate} onChange={(event) => setMetadata({ ...metadata, sessionDate: event.target.value })} /></label>
          <label>School / branch<input value={metadata.schoolBranch} onChange={(event) => setMetadata({ ...metadata, schoolBranch: event.target.value })} /></label>
          <label>Students present<input type="number" min="0" value={metadata.studentsPresent} onChange={(event) => setMetadata({ ...metadata, studentsPresent: event.target.value })} /></label>
          <label>Age / level<input value={metadata.ageLevel} onChange={(event) => setMetadata({ ...metadata, ageLevel: event.target.value })} /></label>
          <label>Observation scope<select value={metadata.observationScope} onChange={(event) => setMetadata({ ...metadata, observationScope: event.target.value })}><option value="full_session">Full session</option><option value="partial_session">Partial session</option></select></label>
          <label>Observed minutes<input type="number" min="1" value={metadata.observationMinutes} onChange={(event) => setMetadata({ ...metadata, observationMinutes: event.target.value })} /></label>
          <label>Environment readiness<input value={metadata.environmentReadiness} onChange={(event) => setMetadata({ ...metadata, environmentReadiness: event.target.value })} placeholder="Ready, delayed, device shortage…" /></label>
          <label>Course / track<input value={metadata.courseTrack} onChange={(event) => setMetadata({ ...metadata, courseTrack: event.target.value })} /></label>
          <label>Session topic<input value={metadata.sessionTopic} onChange={(event) => setMetadata({ ...metadata, sessionTopic: event.target.value })} /></label>
          <label>Session type<select value={metadata.sessionType} onChange={(event) => setMetadata({ ...metadata, sessionType: event.target.value })}><option value="">Not specified</option><option value="group">Group</option><option value="one_to_one">One-to-one</option></select></label>
          <label>Session ID<input value={metadata.sessionId} onChange={(event) => setMetadata({ ...metadata, sessionId: event.target.value })} /></label>
          <label>Project<select value={metadata.projectId} onChange={(event) => setMetadata({ ...metadata, projectId: event.target.value, projectScore: event.target.value ? metadata.projectScore : '' })}><option value="">No project selected</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label>Project quality rating<select value={metadata.projectScore} disabled={!metadata.projectId} onChange={(event) => setMetadata({ ...metadata, projectScore: event.target.value })}><option value="">Not scored</option>{[1, 2, 3, 4, 5].map((score) => <option value={score} key={score}>{score} / 5</option>)}</select></label>
          <label className="full-width">Intended learning outcome<textarea rows={2} value={metadata.intendedLearningOutcome} onChange={(event) => setMetadata({ ...metadata, intendedLearningOutcome: event.target.value })} /></label>
          <label>Learning outcome status<select value={metadata.learningOutcomeStatus} onChange={(event) => setMetadata({ ...metadata, learningOutcomeStatus: event.target.value })}><option value="achieved">Achieved</option><option value="partially_achieved">Partially achieved</option><option value="not_achieved">Not achieved</option><option value="not_observed">Not observed</option></select></label>
          <label>Follow-up status<select value={metadata.followUpStatus} onChange={(event) => setMetadata({ ...metadata, followUpStatus: event.target.value })}><option value="none">None</option><option value="routine">Routine</option><option value="required">Required</option><option value="urgent">Urgent</option></select></label>
          <label className="full-width">External / school cause<textarea rows={2} value={metadata.externalSchoolCause} onChange={(event) => setMetadata({ ...metadata, externalSchoolCause: event.target.value })} placeholder="Record anything outside the tutor's control." /></label>
          <label className="full-width">Context details<textarea rows={2} value={metadata.contextDetails} onChange={(event) => setMetadata({ ...metadata, contextDetails: event.target.value })} /></label>
        </div>
      </section>

      {groupedCriteria.map(([sectionTitle, sectionCriteria]) => (
        <section className="panel form-section" key={sectionTitle}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">{sectionCriteria[0]?.criterion_type === 'rating' ? `Section 2 · ${weights.teaching_weight}%` : `Section 3 · ${weights.compliance_weight}%`}</p>
              <h2>{sectionTitle}</h2>
              <p>Unanswered items are excluded from the score.</p>
            </div>
          </div>
          <div className="criteria-list">
            {sectionCriteria.map((criterion) => {
              const answer = answers[criterion.id] ?? {
                observed: true,
                timestamp: '',
                evidence: '',
                severityReason: '',
                externalDetails: '',
              };
              const needsSeverityReason = answer.compliance && ['coaching_note', 'yellow_flag', 'red_flag'].includes(answer.compliance);
              return (
                <article className="criterion-card" key={criterion.id}>
                  <div className="criterion-copy">
                    <span className="criterion-code">{criterion.code}</span>
                    <h3>{criterion.title}{criterion.criterion_type === 'rating' ? ` · ${criterion.weight_percentage}%` : ''}</h3>
                    {criterion.description && <p>{criterion.description}</p>}
                  </div>

                  {criterion.criterion_type === 'rating' ? (
                    <>
                      <label className="checkbox-row"><input type="checkbox" checked={!answer.observed} onChange={(event) => updateAnswer(criterion.id, { observed: !event.target.checked, score: undefined })} />Not observed during the observation scope</label>
                      {answer.observed && (
                        <fieldset className="rating-control"><legend>Anchored rating</legend>{[1, 2, 3, 4, 5].map((score) => <label key={score} className={answer.score === score ? 'selected' : ''}><input type="radio" name={`score-${criterion.id}`} value={score} checked={answer.score === score} onChange={() => updateAnswer(criterion.id, { score })} /><span>{score}</span></label>)}</fieldset>
                      )}
                      <div className="content-grid">
                        <div><strong>1 · Not evident</strong><p>{criterion.anchor_1}</p></div>
                        <div><strong>3 · Effective practice</strong><p>{criterion.anchor_3}</p></div>
                        <div><strong>5 · Highly effective</strong><p>{criterion.anchor_5}</p></div>
                      </div>
                    </>
                  ) : (
                    <fieldset className="compliance-control">
                      <legend>Decision path outcome</legend>
                      {complianceOptions.map((option) => (
                        <label key={option.value} className={answer.compliance === option.value ? `selected ${option.value}` : ''} title={option.hint}>
                          <input type="radio" name={`compliance-${criterion.id}`} value={option.value} checked={answer.compliance === option.value} onChange={() => updateAnswer(criterion.id, { compliance: option.value })} />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}

                  {answer.compliance === 'external_cause' && (
                    <label>External cause details<textarea rows={2} value={answer.externalDetails} onChange={(event) => updateAnswer(criterion.id, { externalDetails: event.target.value })} placeholder="What was outside the tutor's control?" /></label>
                  )}
                  {needsSeverityReason && (
                    <label>Severity rationale<textarea rows={2} value={answer.severityReason} onChange={(event) => updateAnswer(criterion.id, { severityReason: event.target.value })} placeholder="Explain the impact, seriousness, and required response." /></label>
                  )}

                  <div className="evidence-grid">
                    <label>Time note (optional)<input placeholder="e.g. 12:35" pattern="^[0-9]{1,3}:[0-5][0-9]$" value={answer.timestamp} onChange={(event) => updateAnswer(criterion.id, { timestamp: event.target.value })} /></label>
                    <label>Observed evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateAnswer(criterion.id, { evidence: event.target.value })} placeholder="Record what students did, what the tutor did, and the visible impact." /></label>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Section 4 · Optional feedback</p><h2>Evidence-based feedback</h2><p>Action plan and required action are optional.</p></div></div>
        <div className="form-grid">
          <label className="full-width">Observed strength<textarea rows={3} value={feedback.observedStrength} onChange={(event) => setFeedback({ ...feedback, observedStrength: event.target.value })} /></label>
          <label className="full-width">Development priority<textarea rows={3} value={feedback.developmentPriority} onChange={(event) => setFeedback({ ...feedback, developmentPriority: event.target.value })} /></label>
          <label className="full-width">Student impact<textarea rows={2} value={feedback.studentImpact} onChange={(event) => setFeedback({ ...feedback, studentImpact: event.target.value })} placeholder="How did the observed practice affect learning?" /></label>
          <label className="full-width">Required action (optional)<textarea rows={3} value={feedback.requiredAction} onChange={(event) => setFeedback({ ...feedback, requiredAction: event.target.value })} placeholder="One specific behaviour to change next." /></label>
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
