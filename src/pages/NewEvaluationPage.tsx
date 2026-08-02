import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { EvaluationCriterion } from '../types';

type TutorOption = { id: string; employee_code: string; full_name: string };
type CriterionWithSection = EvaluationCriterion & {
  section: { title: string; sort_order: number } | null;
};

type Answer = {
  score?: number;
  compliance?: 'passed' | 'violated' | 'not_applicable';
  timestamp: string;
  evidence: string;
};

const emptyMetadata = {
  tutorId: '',
  sessionDate: '',
  branch: '',
  courseTrack: '',
  sessionTopic: '',
  sessionType: 'group',
  sessionId: '',
  recordingUrl: '',
};

export function NewEvaluationPage() {
  const navigate = useNavigate();
  const [criteria, setCriteria] = useState<CriterionWithSection[]>([]);
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [metadata, setMetadata] = useState(emptyMetadata);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadFormData() {
      const [criteriaResult, tutorsResult] = await Promise.all([
        supabase
          .from('evaluation_criteria')
          .select('id, section_id, code, title, description, max_score, sort_order, criterion_type, section:evaluation_sections(title, sort_order)')
          .eq('is_active', true)
          .order('sort_order'),
        supabase.from('tutors').select('id, employee_code, full_name').eq('is_active', true).order('full_name'),
      ]);

      const firstError = criteriaResult.error || tutorsResult.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setCriteria((criteriaResult.data ?? []) as unknown as CriterionWithSection[]);
        setTutors((tutorsResult.data ?? []) as TutorOption[]);
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
    const earned = ratingCriteria.reduce((total, criterion) => total + (answers[criterion.id]?.score ?? 0), 0);
    const maximum = ratingCriteria.reduce((total, criterion) => total + criterion.max_score, 0);
    return { earned, maximum, percentage: maximum ? Math.round((earned / maximum) * 100) : 0 };
  }, [answers, criteria]);

  function updateAnswer(criterionId: string, patch: Partial<Answer>) {
    setAnswers((current) => {
      const existing = current[criterionId] ?? { timestamp: '', evidence: '' };
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

    if (!metadata.tutorId || !metadata.sessionDate) {
      setError('Tutor and session date are required.');
      return;
    }

    if (status === 'submitted') {
      const unanswered = criteria.filter((criterion) => {
        const answer = answers[criterion.id];
        return criterion.criterion_type === 'rating' ? !answer?.score : !answer?.compliance;
      });
      if (unanswered.length) {
        setError(`Complete all criteria before submitting. ${unanswered.length} item(s) are unanswered.`);
        return;
      }
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
          session_date: metadata.sessionDate,
          branch_name: metadata.branch || null,
          course_track: metadata.courseTrack || null,
          session_topic: metadata.sessionTopic || null,
          session_type: metadata.sessionType,
          external_session_id: metadata.sessionId || null,
          recording_url: metadata.recordingUrl || null,
          status,
          total_score: scoreSummary.earned,
          maximum_score: scoreSummary.maximum,
          score_percentage: scoreSummary.percentage,
          submitted_at: status === 'submitted' ? new Date().toISOString() : null,
        })
        .select('id')
        .single();

      if (reviewError) throw reviewError;

      const scoreRows = criteria
        .filter((criterion) => answers[criterion.id])
        .map((criterion) => {
          const answer = answers[criterion.id];
          const minutes = answer.timestamp ? Number(answer.timestamp.split(':')[0] || 0) : null;
          const seconds = answer.timestamp ? Number(answer.timestamp.split(':')[1] || 0) : null;
          return {
            review_id: review.id,
            criterion_id: criterion.id,
            numeric_score: criterion.criterion_type === 'rating' ? answer.score ?? null : null,
            compliance_result: criterion.criterion_type === 'compliance' ? answer.compliance ?? null : null,
            timestamp_seconds: minutes === null || seconds === null ? null : minutes * 60 + seconds,
            evidence: answer.evidence.trim() || null,
          };
        });

      if (scoreRows.length) {
        const { error: scoresError } = await supabase.from('review_scores').insert(scoreRows);
        if (scoresError) throw scoresError;
      }

      navigate('/reviews', { replace: true, state: { notice: status === 'draft' ? 'Draft saved.' : 'Evaluation submitted.' } });
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
      <header className="page-header sticky-header">
        <div>
          <p className="eyebrow">QC workspace</p>
          <h1>New session evaluation</h1>
          <p>Rate observable learning behaviors, record evidence, and capture compliance accurately.</p>
        </div>
        <div className="score-pill">
          <span>Live ELEOT score</span>
          <strong>{scoreSummary.earned} / {scoreSummary.maximum || 70}</strong>
          <small>{scoreSummary.percentage}%</small>
        </div>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Session details</p><h2>Evaluation information</h2></div></div>
        <div className="form-grid">
          <label>Tutor<select value={metadata.tutorId} onChange={(event) => setMetadata({ ...metadata, tutorId: event.target.value })} required><option value="">Select tutor</option>{tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.employee_code} — {tutor.full_name}</option>)}</select></label>
          <label>Session date<input type="date" value={metadata.sessionDate} onChange={(event) => setMetadata({ ...metadata, sessionDate: event.target.value })} required /></label>
          <label>Branch / location<input value={metadata.branch} onChange={(event) => setMetadata({ ...metadata, branch: event.target.value })} /></label>
          <label>Course / track<input value={metadata.courseTrack} onChange={(event) => setMetadata({ ...metadata, courseTrack: event.target.value })} /></label>
          <label>Session topic<input value={metadata.sessionTopic} onChange={(event) => setMetadata({ ...metadata, sessionTopic: event.target.value })} /></label>
          <label>Session type<select value={metadata.sessionType} onChange={(event) => setMetadata({ ...metadata, sessionType: event.target.value })}><option value="group">Group</option><option value="one_to_one">One-to-one</option></select></label>
          <label>Session ID<input value={metadata.sessionId} onChange={(event) => setMetadata({ ...metadata, sessionId: event.target.value })} /></label>
          <label>Recording URL<input type="url" value={metadata.recordingUrl} onChange={(event) => setMetadata({ ...metadata, recordingUrl: event.target.value })} /></label>
        </div>
      </section>

      {groupedCriteria.map(([sectionTitle, sectionCriteria]) => (
        <section className="panel form-section" key={sectionTitle}>
          <div className="panel-heading"><div><p className="eyebrow">Evaluation section</p><h2>{sectionTitle}</h2></div></div>
          <div className="criteria-list">
            {sectionCriteria.map((criterion) => {
              const answer = answers[criterion.id] ?? { timestamp: '', evidence: '' };
              return (
                <article className="criterion-card" key={criterion.id}>
                  <div className="criterion-copy"><span className="criterion-code">{criterion.code}</span><h3>{criterion.title}</h3>{criterion.description && <p>{criterion.description}</p>}</div>
                  {criterion.criterion_type === 'rating' ? (
                    <fieldset className="rating-control"><legend>Rating</legend>{[1, 2, 3, 4, 5].map((score) => <label key={score} className={answer.score === score ? 'selected' : ''}><input type="radio" name={`score-${criterion.id}`} value={score} checked={answer.score === score} onChange={() => updateAnswer(criterion.id, { score })} /><span>{score}</span></label>)}</fieldset>
                  ) : (
                    <fieldset className="compliance-control"><legend>Compliance</legend>{(['passed', 'violated', 'not_applicable'] as const).map((result) => <label key={result} className={answer.compliance === result ? `selected ${result}` : ''}><input type="radio" name={`compliance-${criterion.id}`} value={result} checked={answer.compliance === result} onChange={() => updateAnswer(criterion.id, { compliance: result })} /><span>{result.replace('_', ' ')}</span></label>)}</fieldset>
                  )}
                  <div className="evidence-grid">
                    <label>Timestamp (MM:SS)<input placeholder="12:35" pattern="^[0-9]{1,3}:[0-5][0-9]$" value={answer.timestamp} onChange={(event) => updateAnswer(criterion.id, { timestamp: event.target.value })} /></label>
                    <label>Observed evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateAnswer(criterion.id, { evidence: event.target.value })} placeholder="Describe the specific observable moment…" /></label>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <footer className="form-actions">
        <button className="button button-secondary" type="button" disabled={saving} onClick={() => void saveReview('draft')}>Save draft</button>
        <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Submit for validation'}</button>
      </footer>
    </form>
  );
}
