import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

type ObjectionRow = {
  id: string;
  created_at: string;
  object_type: string;
  reason_code: string;
  status: string;
  explanation: string;
  decision: string | null;
  review: { session_date: string | null; session_topic: string | null } | null;
  tutor: { full_name: string; employee_code: string } | null;
};

type SelectedReview = {
  id: string;
  status: string;
  session_date: string | null;
  session_topic: string | null;
};

type EligibleFlag = {
  id: string;
  level: 'yellow' | 'red';
  severity_reason: string | null;
  criterion: { title: string } | null;
};

type EligibleScore = {
  id: string;
  numeric_score: number | null;
  evidence: string | null;
  criterion: { code: string; title: string } | null;
};

type TargetType = 'flag' | 'criterion_score';

type ReasonOption = [string, string];

const flagReasonOptions: ReasonOption[] = [
  ['behavior_did_not_occur', 'The flagged behavior did not occur'],
  ['evidence_misunderstood', 'The evidence was misunderstood'],
  ['timestamp_incorrect', 'The timestamp is incorrect'],
  ['external_cause', 'An external or school cause was not considered'],
  ['severity_mismatch', 'The flag severity does not match the evidence'],
];

const scoreReasonOptions: ReasonOption[] = [
  ['score_mismatch', 'The score does not match the evidence'],
  ['evidence_misunderstood', 'The evidence was misunderstood'],
  ['timestamp_incorrect', 'The timestamp is incorrect'],
  ['not_observable', 'The criterion was not observable'],
  ['external_cause', 'An external or school cause was not considered'],
];

const allReasonOptions = [...flagReasonOptions, ...scoreReasonOptions].filter(
  (option, index, options) => options.findIndex(([value]) => value === option[0]) === index,
);

function formatDate(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : 'Date not entered';
}

function parseTarget(value: string): { type: TargetType; id: string } | null {
  const separatorIndex = value.indexOf(':');
  if (separatorIndex < 1) return null;
  const type = value.slice(0, separatorIndex);
  const id = value.slice(separatorIndex + 1);
  if ((type !== 'flag' && type !== 'criterion_score') || !id) return null;
  return { type, id };
}

export function ObjectionsPage() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const reviewId = searchParams.get('review');
  const [rows, setRows] = useState<ObjectionRow[]>([]);
  const [selectedReview, setSelectedReview] = useState<SelectedReview | null>(null);
  const [eligibleFlags, setEligibleFlags] = useState<EligibleFlag[]>([]);
  const [eligibleScores, setEligibleScores] = useState<EligibleScore[]>([]);
  const [targetKey, setTargetKey] = useState('');
  const [reasonCode, setReasonCode] = useState(flagReasonOptions[0][0]);
  const [explanation, setExplanation] = useState('');
  const [requestedOutcome, setRequestedOutcome] = useState('');
  const [loading, setLoading] = useState(true);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadObjections() {
    const { data, error: queryError } = await supabase
      .from('objections')
      .select('id, created_at, object_type, reason_code, status, explanation, decision, review:reviews(session_date, session_topic), tutor:tutors(full_name, employee_code)')
      .order('created_at', { ascending: false });

    if (queryError) setError(queryError.message);
    else setRows((data ?? []) as unknown as ObjectionRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadObjections();
  }, []);

  useEffect(() => {
    async function loadEligibility() {
      if (profile?.role !== 'tutor' || !reviewId) {
        setSelectedReview(null);
        setEligibleFlags([]);
        setEligibleScores([]);
        setTargetKey('');
        return;
      }

      setEligibilityLoading(true);
      setError('');

      const [reviewResult, flagsResult, scoresResult] = await Promise.all([
        supabase
          .from('reviews')
          .select('id, status, session_date, session_topic')
          .eq('id', reviewId)
          .maybeSingle(),
        supabase
          .from('review_flags')
          .select('id, level, severity_reason, criterion:evaluation_criteria(title)')
          .eq('review_id', reviewId)
          .eq('is_active', true),
        supabase
          .from('review_scores')
          .select('id, numeric_score, evidence, criterion:evaluation_criteria(code, title)')
          .eq('review_id', reviewId)
          .eq('is_observed', true)
          .lte('numeric_score', 1),
      ]);

      const firstError = reviewResult.error || flagsResult.error || scoresResult.error;
      if (firstError) {
        setError(firstError.message);
        setSelectedReview(null);
        setEligibleFlags([]);
        setEligibleScores([]);
        setTargetKey('');
      } else {
        const review = reviewResult.data as SelectedReview | null;
        const flags = (flagsResult.data ?? []) as unknown as EligibleFlag[];
        const scores = (scoresResult.data ?? []) as unknown as EligibleScore[];
        setSelectedReview(review);
        setEligibleFlags(flags);
        setEligibleScores(scores);

        const firstTarget = flags[0]
          ? `flag:${flags[0].id}`
          : scores[0]
            ? `criterion_score:${scores[0].id}`
            : '';
        setTargetKey(firstTarget);
        setReasonCode(flags[0] ? flagReasonOptions[0][0] : scoreReasonOptions[0][0]);
      }

      setEligibilityLoading(false);
    }

    void loadEligibility();
  }, [profile?.role, reviewId]);

  const selectedTarget = useMemo(() => parseTarget(targetKey), [targetKey]);
  const currentReasonOptions = selectedTarget?.type === 'criterion_score' ? scoreReasonOptions : flagReasonOptions;
  const eligibleCount = eligibleFlags.length + eligibleScores.length;

  function changeTarget(value: string) {
    setTargetKey(value);
    const target = parseTarget(value);
    setReasonCode(target?.type === 'criterion_score' ? scoreReasonOptions[0][0] : flagReasonOptions[0][0]);
  }

  async function submitObjection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!reviewId || !profile?.tutor_id || !selectedTarget) {
      setError('Choose an eligible flag or score before submitting.');
      return;
    }

    setSaving(true);
    const { error: insertError } = await supabase.from('objections').insert({
      review_id: reviewId,
      tutor_id: profile.tutor_id,
      submitted_by: profile.id,
      object_type: selectedTarget.type,
      target_flag_id: selectedTarget.type === 'flag' ? selectedTarget.id : null,
      target_score_id: selectedTarget.type === 'criterion_score' ? selectedTarget.id : null,
      reason_code: reasonCode,
      explanation: explanation.trim(),
      requested_outcome: requestedOutcome.trim() || null,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      setExplanation('');
      setRequestedOutcome('');
      setNotice('Your objection was submitted and added to the review queue.');
      await loadObjections();
    }
    setSaving(false);
  }

  return (
    <div className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Evaluation reconsideration</p><h1>Objections</h1><p>Tutors can object only to an active yellow/red flag or an observed teaching score of 1.</p></div></header>

      {profile?.role === 'tutor' && reviewId && (
        <section className="panel form-section">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Selected review</p>
              <h2>{selectedReview?.session_topic || 'Raise an objection'}</h2>
              {selectedReview && <p className="muted">{formatDate(selectedReview.session_date)}</p>}
            </div>
          </div>

          {eligibilityLoading ? (
            <div className="empty-state">Checking eligible objection items…</div>
          ) : !selectedReview || selectedReview.status !== 'published' ? (
            <div className="alert alert-error">This review is not published or is not available to this tutor account.</div>
          ) : eligibleCount === 0 ? (
            <div className="empty-state">
              <h2>No eligible objection items</h2>
              <p>This review has no active yellow/red flags and no teaching dimension scored 1.</p>
            </div>
          ) : (
            <form className="form-grid" onSubmit={submitObjection}>
              <label className="full-width">
                Objection item
                <select value={targetKey} onChange={(event) => changeTarget(event.target.value)} required>
                  {eligibleFlags.map((flag) => (
                    <option key={flag.id} value={`flag:${flag.id}`}>
                      {flag.level.toUpperCase()} flag — {flag.criterion?.title || 'Compliance item'}
                    </option>
                  ))}
                  {eligibleScores.map((score) => (
                    <option key={score.id} value={`criterion_score:${score.id}`}>
                      Score {score.numeric_score ?? 1} — {score.criterion?.code ? `${score.criterion.code} · ` : ''}{score.criterion?.title || 'Teaching metric'}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Reason
                <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
                  {currentReasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>

              <label className="full-width">Explanation<textarea rows={5} required minLength={10} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Explain the exact point and the evidence supporting your request…" /></label>
              <label className="full-width">Requested outcome <span className="muted">(optional)</span><textarea rows={2} value={requestedOutcome} onChange={(event) => setRequestedOutcome(event.target.value)} placeholder="For example: remove the flag or reconsider this metric score." /></label>
              <div className="full-width"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit objection'}</button></div>
            </form>
          )}
        </section>
      )}

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <section className="panel table-panel">
        {loading ? <div className="empty-state">Loading objections…</div> : rows.length === 0 ? <div className="empty-state"><h2>No objections yet</h2><p>Submitted objections and their decisions will appear here.</p></div> : (
          <div className="table-wrap"><table><thead><tr><th>Review</th><th>Tutor</th><th>Objected item</th><th>Reason</th><th>Status</th><th>Decision</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{formatDate(row.review?.session_date)}</strong><span className="table-subtext">{row.review?.session_topic || 'Session evaluation'}</span></td><td>{row.tutor ? `${row.tutor.employee_code} — ${row.tutor.full_name}` : '—'}</td><td>{row.object_type === 'flag' ? 'Compliance flag' : 'Score of 1'}</td><td>{allReasonOptions.find(([value]) => value === row.reason_code)?.[1] ?? row.reason_code}</td><td><span className={`status-badge status-${row.status}`}>{row.status.replaceAll('_', ' ')}</span></td><td>{row.decision?.replaceAll('_', ' ') || 'Pending'}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
