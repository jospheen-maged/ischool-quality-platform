import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

type ObjectionDecision = 'accepted' | 'partially_accepted' | 'rejected' | 'more_evidence_required';

type ObjectionRow = {
  id: string;
  created_at: string;
  object_type: 'flag' | 'criterion_score';
  reason_code: string;
  status: string;
  explanation: string;
  requested_outcome: string | null;
  decision: string | null;
  decision_notes: string | null;
  assigned_reviewer_id: string | null;
  score_changed: boolean;
  flag_changed: boolean;
  review: { id: string; session_date: string | null; session_topic: string | null; status: string } | null;
  tutor: { full_name: string; employee_code: string } | null;
  assigned_reviewer: { id: string; full_name: string } | null;
  target_score: {
    id: string;
    numeric_score: number | null;
    evidence: string | null;
    criterion: { code: string; title: string } | null;
  } | null;
  target_flag: {
    id: string;
    level: 'yellow' | 'red';
    is_active: boolean;
    severity_reason: string | null;
    criterion: { code: string; title: string } | null;
  } | null;
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

const objectionSelect = `
  id,
  created_at,
  object_type,
  reason_code,
  status,
  explanation,
  requested_outcome,
  decision,
  decision_notes,
  assigned_reviewer_id,
  score_changed,
  flag_changed,
  review:reviews(id, session_date, session_topic, status),
  tutor:tutors(full_name, employee_code),
  assigned_reviewer:profiles!objections_assigned_reviewer_id_fkey(id, full_name),
  target_score:review_scores!objections_target_score_id_fkey(
    id,
    numeric_score,
    evidence,
    criterion:evaluation_criteria(code, title)
  ),
  target_flag:review_flags!objections_target_flag_id_fkey(
    id,
    level,
    is_active,
    severity_reason,
    criterion:evaluation_criteria(code, title)
  )
`;

function formatDate(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : 'Date not entered';
}

function formatLabel(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ') : 'Pending';
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
  const [selectedObjectionId, setSelectedObjectionId] = useState<string | null>(null);
  const [selectedReview, setSelectedReview] = useState<SelectedReview | null>(null);
  const [eligibleFlags, setEligibleFlags] = useState<EligibleFlag[]>([]);
  const [eligibleScores, setEligibleScores] = useState<EligibleScore[]>([]);
  const [targetKey, setTargetKey] = useState('');
  const [reasonCode, setReasonCode] = useState(flagReasonOptions[0][0]);
  const [explanation, setExplanation] = useState('');
  const [requestedOutcome, setRequestedOutcome] = useState('');

  const [decision, setDecision] = useState<ObjectionDecision>('accepted');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [newScore, setNewScore] = useState('2');
  const [flagAction, setFlagAction] = useState<'remove' | 'downgrade_to_yellow'>('remove');

  const [loading, setLoading] = useState(true);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isTutor = profile?.role === 'tutor';
  const isStaff = profile?.role === 'super_admin' || profile?.role === 'admin' || profile?.role === 'qtl' || profile?.role === 'qc';
  const isManagement = profile?.role === 'super_admin' || profile?.role === 'admin' || profile?.role === 'qtl';

  async function loadObjections(preferredId?: string | null) {
    setLoading(true);
    setError('');

    const { data, error: queryError } = await supabase
      .from('objections')
      .select(objectionSelect)
      .order('created_at', { ascending: false });

    if (queryError) {
      setError(queryError.message);
      setRows([]);
    } else {
      const nextRows = (data ?? []) as unknown as ObjectionRow[];
      setRows(nextRows);
      const desiredId = preferredId ?? selectedObjectionId;
      if (desiredId && nextRows.some((row) => row.id === desiredId)) setSelectedObjectionId(desiredId);
      else if (isStaff && nextRows[0]) setSelectedObjectionId(nextRows[0].id);
      else setSelectedObjectionId(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadObjections();
  }, [profile?.role]);

  useEffect(() => {
    async function loadEligibility() {
      if (!isTutor || !reviewId) {
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
  }, [isTutor, reviewId]);

  const selectedTarget = useMemo(() => parseTarget(targetKey), [targetKey]);
  const currentReasonOptions = selectedTarget?.type === 'criterion_score' ? scoreReasonOptions : flagReasonOptions;
  const eligibleCount = eligibleFlags.length + eligibleScores.length;
  const selectedObjection = useMemo(
    () => rows.find((row) => row.id === selectedObjectionId) ?? null,
    [rows, selectedObjectionId],
  );

  const pendingCount = rows.filter((row) => row.status === 'submitted').length;
  const inReviewCount = rows.filter((row) => row.status === 'under_review' || row.status === 'evidence_required').length;
  const decidedCount = rows.filter((row) => row.status === 'decision_issued' || row.status === 'closed').length;
  const canResolveSelected = Boolean(
    isStaff
    && selectedObjection
    && !['decision_issued', 'closed'].includes(selectedObjection.status)
    && (isManagement || selectedObjection.assigned_reviewer_id === profile?.id),
  );

  useEffect(() => {
    if (!selectedObjection) return;
    setDecision('accepted');
    setDecisionNotes('');
    setNewScore(String(Math.max(2, Number(selectedObjection.target_score?.numeric_score ?? 1))));
    setFlagAction('remove');
  }, [selectedObjectionId]);

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

  async function claimObjection(objectionId: string) {
    setActing(true);
    setError('');
    setNotice('');

    const { error: claimError } = await supabase.rpc('claim_objection', {
      p_objection_id: objectionId,
    });

    if (claimError) setError(claimError.message);
    else {
      setNotice('Objection assigned to you. You can now issue a decision.');
      await loadObjections(objectionId);
    }

    setActing(false);
  }

  async function resolveObjection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedObjection) return;

    setActing(true);
    setError('');
    setNotice('');

    const appliesReviewChange = decision === 'accepted' || decision === 'partially_accepted';
    const scoreValue = selectedObjection.object_type === 'criterion_score' && appliesReviewChange
      ? Number(newScore)
      : null;
    const nextFlagAction = selectedObjection.object_type === 'flag' && appliesReviewChange
      ? flagAction
      : null;

    const { error: resolveError } = await supabase.rpc('resolve_objection', {
      p_objection_id: selectedObjection.id,
      p_decision: decision,
      p_decision_notes: decisionNotes.trim(),
      p_new_score: scoreValue,
      p_flag_action: nextFlagAction,
    });

    if (resolveError) setError(resolveError.message);
    else {
      const message = decision === 'rejected'
        ? 'Objection rejected. The published review was not changed.'
        : decision === 'more_evidence_required'
          ? 'More evidence requested from the tutor.'
          : 'Decision saved and the published review was updated.';
      setNotice(message);
      await loadObjections(selectedObjection.id);
    }

    setActing(false);
  }

  return (
    <div className="page-stack objection-workspace-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Evaluation reconsideration</p>
          <h1>{isTutor ? 'My objections' : 'Objection review queue'}</h1>
          <p>
            {isTutor
              ? 'You can object only to an active yellow/red flag or an observed teaching score of 1.'
              : 'Management can see every objection. QC reviewers can claim independent cases, issue decisions, and apply approved review changes.'}
          </p>
        </div>
      </header>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {isStaff && (
        <section className="people-summary-grid objection-summary-grid" aria-label="Objection summary">
          <article><span className="people-summary-icon people-summary-blue">{rows.length}</span><div><small>Total visible</small><strong>{rows.length}</strong></div></article>
          <article><span className="people-summary-icon people-summary-orange">{pendingCount}</span><div><small>Waiting assignment</small><strong>{pendingCount}</strong></div></article>
          <article><span className="people-summary-icon people-summary-violet">{inReviewCount}</span><div><small>Under review</small><strong>{inReviewCount}</strong></div></article>
          <article><span className="people-summary-icon people-summary-green">{decidedCount}</span><div><small>Decision issued</small><strong>{decidedCount}</strong></div></article>
        </section>
      )}

      {isTutor && reviewId && (
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
            <div className="empty-state"><h2>No eligible objection items</h2><p>This review has no active yellow/red flags and no teaching dimension scored 1.</p></div>
          ) : (
            <form className="form-grid" onSubmit={submitObjection}>
              <label className="full-width">Objection item<select value={targetKey} onChange={(event) => changeTarget(event.target.value)} required>
                {eligibleFlags.map((flag) => <option key={flag.id} value={`flag:${flag.id}`}>{flag.level.toUpperCase()} flag — {flag.criterion?.title || 'Compliance item'}</option>)}
                {eligibleScores.map((score) => <option key={score.id} value={`criterion_score:${score.id}`}>Score {score.numeric_score ?? 1} — {score.criterion?.code ? `${score.criterion.code} · ` : ''}{score.criterion?.title || 'Teaching metric'}</option>)}
              </select></label>
              <label>Reason<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>{currentReasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="full-width">Explanation<textarea rows={5} required minLength={10} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Explain the exact point and the evidence supporting your request…" /></label>
              <label className="full-width">Requested outcome <span className="muted">(optional)</span><textarea rows={2} value={requestedOutcome} onChange={(event) => setRequestedOutcome(event.target.value)} placeholder="For example: remove the flag or reconsider this metric score." /></label>
              <div className="full-width"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit objection'}</button></div>
            </form>
          )}
        </section>
      )}

      {isStaff && selectedObjection && (
        <section className="panel objection-review-panel">
          <div className="panel-heading objection-review-heading">
            <div>
              <p className="eyebrow">Selected objection</p>
              <h2>{selectedObjection.tutor ? `${selectedObjection.tutor.employee_code} — ${selectedObjection.tutor.full_name}` : 'Tutor objection'}</h2>
              <p className="muted">{formatDate(selectedObjection.review?.session_date)} · {selectedObjection.review?.session_topic || 'Session evaluation'}</p>
            </div>
            <span className={`status-badge status-${selectedObjection.status}`}>{formatLabel(selectedObjection.status)}</span>
          </div>

          <div className="objection-review-grid">
            <article className="objection-evidence-card">
              <span className="review-detail-kicker">Objected item</span>
              {selectedObjection.object_type === 'criterion_score' ? (
                <>
                  <h3>{selectedObjection.target_score?.criterion?.code} · {selectedObjection.target_score?.criterion?.title || 'Teaching metric'}</h3>
                  <strong className="objection-current-value">Current score: {selectedObjection.target_score?.numeric_score ?? '—'} / 5</strong>
                  <p>{selectedObjection.target_score?.evidence || 'No evaluator evidence recorded.'}</p>
                </>
              ) : (
                <>
                  <h3>{selectedObjection.target_flag?.level?.toUpperCase()} flag · {selectedObjection.target_flag?.criterion?.title || 'Compliance item'}</h3>
                  <strong className="objection-current-value">{selectedObjection.target_flag?.is_active ? 'Active flag' : 'Flag already changed'}</strong>
                  <p>{selectedObjection.target_flag?.severity_reason || 'No severity reason recorded.'}</p>
                </>
              )}
            </article>

            <article className="objection-evidence-card">
              <span className="review-detail-kicker">Tutor request</span>
              <h3>{allReasonOptions.find(([value]) => value === selectedObjection.reason_code)?.[1] ?? formatLabel(selectedObjection.reason_code)}</h3>
              <p>{selectedObjection.explanation}</p>
              {selectedObjection.requested_outcome && <><small>Requested outcome</small><p>{selectedObjection.requested_outcome}</p></>}
              <small>Reviewer</small>
              <p>{selectedObjection.assigned_reviewer?.full_name || 'Not assigned yet'}</p>
            </article>
          </div>

          {!selectedObjection.assigned_reviewer_id && profile?.role === 'qc' && (
            <div className="objection-claim-row">
              <p>This objection is unassigned. Claim it before issuing a decision.</p>
              <button className="button button-primary" type="button" disabled={acting} onClick={() => void claimObjection(selectedObjection.id)}>{acting ? 'Assigning…' : 'Take objection'}</button>
            </div>
          )}

          {canResolveSelected && (
            <form className="form-grid objection-decision-form" onSubmit={resolveObjection}>
              <label>Decision<select value={decision} onChange={(event) => setDecision(event.target.value as ObjectionDecision)}>
                <option value="accepted">Accept</option>
                <option value="partially_accepted">Partially accept</option>
                <option value="rejected">Reject</option>
                <option value="more_evidence_required">Request more evidence</option>
              </select></label>

              {(decision === 'accepted' || decision === 'partially_accepted') && selectedObjection.object_type === 'criterion_score' && (
                <label>New metric score<select value={newScore} onChange={(event) => setNewScore(event.target.value)}>
                  <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>
                </select></label>
              )}

              {(decision === 'accepted' || decision === 'partially_accepted') && selectedObjection.object_type === 'flag' && (
                <label>Review change<select value={flagAction} onChange={(event) => setFlagAction(event.target.value as 'remove' | 'downgrade_to_yellow')}>
                  <option value="remove">Remove flag</option>
                  {selectedObjection.target_flag?.level === 'red' && <option value="downgrade_to_yellow">Downgrade red to yellow</option>}
                </select></label>
              )}

              <label className="full-width">Decision notes<textarea rows={4} required minLength={5} value={decisionNotes} onChange={(event) => setDecisionNotes(event.target.value)} placeholder="Explain the final decision and the evidence used…" /></label>
              <div className="full-width objection-decision-actions">
                <button className="button button-primary" type="submit" disabled={acting}>{acting ? 'Saving decision…' : 'Save decision and update review'}</button>
              </div>
            </form>
          )}

          {selectedObjection.decision && (
            <div className="alert alert-success objection-issued-decision">
              <strong>{formatLabel(selectedObjection.decision)}</strong>
              <span>{selectedObjection.decision_notes || 'Decision issued.'}</span>
              {(selectedObjection.score_changed || selectedObjection.flag_changed) && <span>The published review was updated.</span>}
            </div>
          )}
        </section>
      )}

      <section className="panel table-panel">
        {loading ? <div className="empty-state">Loading objections…</div> : rows.length === 0 ? (
          <div className="empty-state"><h2>No objections yet</h2><p>{isStaff ? 'All objections visible to your role will appear here.' : 'Submitted objections and their decisions will appear here.'}</p></div>
        ) : (
          <div className="table-wrap"><table><thead><tr><th>Review</th><th>Tutor</th><th>Objected item</th><th>Reviewer</th><th>Status</th><th>Decision</th>{isStaff && <th>Action</th>}</tr></thead><tbody>
            {rows.map((row) => <tr key={row.id} className={selectedObjectionId === row.id ? 'objection-selected-row' : ''}>
              <td><strong>{formatDate(row.review?.session_date)}</strong><span className="table-subtext">{row.review?.session_topic || 'Session evaluation'}</span></td>
              <td>{row.tutor ? `${row.tutor.employee_code} — ${row.tutor.full_name}` : '—'}</td>
              <td>{row.object_type === 'flag' ? `${row.target_flag?.level?.toUpperCase() || ''} flag` : `${row.target_score?.criterion?.code || 'Metric'} score`}</td>
              <td>{row.assigned_reviewer?.full_name || 'Unassigned'}</td>
              <td><span className={`status-badge status-${row.status}`}>{formatLabel(row.status)}</span></td>
              <td>{formatLabel(row.decision)}</td>
              {isStaff && <td><button className="people-table-action" type="button" onClick={() => setSelectedObjectionId(row.id)}>Review case</button></td>}
            </tr>)}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}
