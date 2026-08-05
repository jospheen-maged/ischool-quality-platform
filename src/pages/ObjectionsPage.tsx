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
  reviewer_recommendation: ObjectionDecision | null;
  reviewer_notes: string | null;
  proposed_score: number | null;
  proposed_flag_action: 'remove' | 'downgrade_to_yellow' | null;
  approval_status: 'pending' | 'approved' | 'declined' | null;
  approval_notes: string | null;
  score_changed: boolean;
  flag_changed: boolean;
  review: { id: string; session_date: string | null; session_topic: string | null; status: string } | null;
  tutor: { full_name: string; employee_code: string } | null;
  assigned_reviewer: { id: string; full_name: string } | null;
  approver: { id: string; full_name: string } | null;
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
  reviewer_recommendation,
  reviewer_notes,
  proposed_score,
  proposed_flag_action,
  approval_status,
  approval_notes,
  score_changed,
  flag_changed,
  review:reviews(id, session_date, session_topic, status),
  tutor:tutors(full_name, employee_code),
  assigned_reviewer:profiles!objections_assigned_reviewer_id_fkey(id, full_name),
  approver:profiles!objections_qtl_approved_by_fkey(id, full_name),
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

  const [recommendation, setRecommendation] = useState<ObjectionDecision>('accepted');
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [proposedScore, setProposedScore] = useState('2');
  const [proposedFlagAction, setProposedFlagAction] = useState<'remove' | 'downgrade_to_yellow'>('remove');
  const [approvalNotes, setApprovalNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isTutor = profile?.role === 'tutor';
  const isQC = profile?.role === 'qc';
  const isApprover = profile?.role === 'super_admin' || profile?.role === 'qtl';
  const isStaff = ['super_admin', 'admin', 'qtl', 'qc'].includes(profile?.role ?? '');

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
          .eq('numeric_score', 1),
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

  const submittedCount = rows.filter((row) => row.status === 'submitted').length;
  const qcReviewCount = rows.filter((row) => ['under_review', 'evidence_required'].includes(row.status)).length;
  const awaitingApprovalCount = rows.filter((row) => row.status === 'awaiting_qtl').length;
  const resolvedCount = rows.filter((row) => ['decision_issued', 'closed'].includes(row.status)).length;

  const canQCRecommend = Boolean(
    isQC
    && selectedObjection
    && selectedObjection.assigned_reviewer_id === profile?.id
    && ['under_review', 'evidence_required'].includes(selectedObjection.status),
  );

  const canApproveSelected = Boolean(
    isApprover
    && selectedObjection
    && selectedObjection.status === 'awaiting_qtl'
    && selectedObjection.reviewer_recommendation,
  );

  useEffect(() => {
    if (!selectedObjection) return;
    setRecommendation(selectedObjection.reviewer_recommendation ?? 'accepted');
    setReviewerNotes(selectedObjection.reviewer_notes ?? '');
    setProposedScore(String(selectedObjection.proposed_score ?? Math.max(2, Number(selectedObjection.target_score?.numeric_score ?? 1))));
    setProposedFlagAction(selectedObjection.proposed_flag_action ?? 'remove');
    setApprovalNotes('');
  }, [selectedObjectionId, selectedObjection?.approval_status, selectedObjection?.status]);

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
      setNotice('Your objection was submitted to the Quality Control queue.');
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
      setNotice('Objection assigned to you. Review it and send your recommendation for approval.');
      await loadObjections(objectionId);
    }

    setActing(false);
  }

  async function submitRecommendation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedObjection) return;

    setActing(true);
    setError('');
    setNotice('');

    const proposesChange = recommendation === 'accepted' || recommendation === 'partially_accepted';
    const scoreValue = selectedObjection.object_type === 'criterion_score' && proposesChange
      ? Number(proposedScore)
      : null;
    const flagValue = selectedObjection.object_type === 'flag' && proposesChange
      ? proposedFlagAction
      : null;

    const { error: recommendationError } = await supabase.rpc('submit_objection_recommendation', {
      p_objection_id: selectedObjection.id,
      p_recommendation: recommendation,
      p_reviewer_notes: reviewerNotes.trim(),
      p_proposed_score: scoreValue,
      p_proposed_flag_action: flagValue,
    });

    if (recommendationError) setError(recommendationError.message);
    else {
      setNotice('QC recommendation submitted. The review is unchanged until Super Admin or QTL approval.');
      await loadObjections(selectedObjection.id);
    }

    setActing(false);
  }

  async function approveRecommendation(approve: boolean) {
    if (!selectedObjection) return;

    setActing(true);
    setError('');
    setNotice('');

    const { error: approvalError } = await supabase.rpc('approve_objection_recommendation', {
      p_objection_id: selectedObjection.id,
      p_approve: approve,
      p_approval_notes: approvalNotes.trim(),
    });

    if (approvalError) setError(approvalError.message);
    else {
      setNotice(approve
        ? 'QC decision approved. Any approved score or flag change is now applied to the published review.'
        : 'QC decision declined and returned to the assigned QC for revision.');
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
              : 'QC reviews the objection and proposes the change. Only Super Admin or QTL can approve or decline the recommendation.'}
          </p>
        </div>
      </header>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {isStaff && (
        <section className="people-summary-grid objection-summary-grid" aria-label="Objection summary">
          <article><span className="people-summary-icon people-summary-orange">{submittedCount}</span><div><small>Waiting for QC</small><strong>{submittedCount}</strong></div></article>
          <article><span className="people-summary-icon people-summary-violet">{qcReviewCount}</span><div><small>QC review</small><strong>{qcReviewCount}</strong></div></article>
          <article><span className="people-summary-icon people-summary-blue">{awaitingApprovalCount}</span><div><small>Awaiting approval</small><strong>{awaitingApprovalCount}</strong></div></article>
          <article><span className="people-summary-icon people-summary-green">{resolvedCount}</span><div><small>Resolved</small><strong>{resolvedCount}</strong></div></article>
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
                {eligibleScores.map((score) => <option key={score.id} value={`criterion_score:${score.id}`}>Score 1 — {score.criterion?.code ? `${score.criterion.code} · ` : ''}{score.criterion?.title || 'Teaching metric'}</option>)}
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
              <small>Assigned QC</small>
              <p>{selectedObjection.assigned_reviewer?.full_name || 'Not assigned yet'}</p>
            </article>
          </div>

          {selectedObjection.approval_status === 'declined' && selectedObjection.status === 'under_review' && (
            <div className="alert alert-error objection-issued-decision">
              <strong>Recommendation returned to QC</strong>
              <span>{selectedObjection.approval_notes || 'The approver requested a revision.'}</span>
              {selectedObjection.approver?.full_name && <span>Returned by {selectedObjection.approver.full_name}</span>}
            </div>
          )}

          {!selectedObjection.assigned_reviewer_id && isQC && (
            <div className="objection-claim-row">
              <p>This objection is available in the independent QC queue. Take it before proposing a decision.</p>
              <button className="button button-primary" type="button" disabled={acting} onClick={() => void claimObjection(selectedObjection.id)}>{acting ? 'Assigning…' : 'Take objection'}</button>
            </div>
          )}

          {canQCRecommend && (
            <form className="form-grid objection-decision-form" onSubmit={submitRecommendation}>
              <div className="full-width objection-workflow-note">
                <strong>QC recommendation</strong>
                <span>Your proposed edit will remain pending until Super Admin or QTL approval.</span>
              </div>

              <label>Recommendation<select value={recommendation} onChange={(event) => setRecommendation(event.target.value as ObjectionDecision)}>
                <option value="accepted">Accept objection</option>
                <option value="partially_accepted">Partially accept</option>
                <option value="rejected">Reject objection</option>
                <option value="more_evidence_required">Request more evidence</option>
              </select></label>

              {(recommendation === 'accepted' || recommendation === 'partially_accepted') && selectedObjection.object_type === 'criterion_score' && (
                <label>Proposed metric score<select value={proposedScore} onChange={(event) => setProposedScore(event.target.value)}>
                  <option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>
                </select></label>
              )}

              {(recommendation === 'accepted' || recommendation === 'partially_accepted') && selectedObjection.object_type === 'flag' && (
                <label>Proposed flag change<select value={proposedFlagAction} onChange={(event) => setProposedFlagAction(event.target.value as 'remove' | 'downgrade_to_yellow')}>
                  <option value="remove">Remove flag</option>
                  {selectedObjection.target_flag?.level === 'red' && <option value="downgrade_to_yellow">Downgrade red to yellow</option>}
                </select></label>
              )}

              <label className="full-width">QC review notes<textarea rows={4} required minLength={5} value={reviewerNotes} onChange={(event) => setReviewerNotes(event.target.value)} placeholder="Explain your recommendation and the evidence used…" /></label>
              <div className="full-width objection-decision-actions">
                <button className="button button-primary" type="submit" disabled={acting}>{acting ? 'Sending…' : 'Send recommendation for approval'}</button>
              </div>
            </form>
          )}

          {selectedObjection.reviewer_recommendation && (
            <section className="objection-approval-card">
              <div>
                <span className="review-detail-kicker">QC recommendation</span>
                <h3>{formatLabel(selectedObjection.reviewer_recommendation)}</h3>
                <p>{selectedObjection.reviewer_notes || 'No QC notes recorded.'}</p>
              </div>
              <div className="objection-proposed-change">
                <small>Proposed review change</small>
                <strong>
                  {selectedObjection.reviewer_recommendation === 'rejected'
                    ? 'No change to the review'
                    : selectedObjection.reviewer_recommendation === 'more_evidence_required'
                      ? 'Request additional evidence'
                      : selectedObjection.object_type === 'criterion_score'
                        ? `Change metric score to ${selectedObjection.proposed_score ?? '—'} / 5`
                        : selectedObjection.proposed_flag_action === 'remove'
                          ? 'Remove the flag'
                          : 'Downgrade red flag to yellow'}
                </strong>
              </div>

              {canApproveSelected && (
                <div className="objection-approval-actions">
                  <label>Approval notes<textarea rows={3} required minLength={3} value={approvalNotes} onChange={(event) => setApprovalNotes(event.target.value)} placeholder="Add the reason for approval or return…" /></label>
                  <div>
                    <button className="people-secondary-button" type="button" disabled={acting || approvalNotes.trim().length < 3} onClick={() => void approveRecommendation(false)}>Decline & return to QC</button>
                    <button className="button button-primary" type="button" disabled={acting || approvalNotes.trim().length < 3} onClick={() => void approveRecommendation(true)}>{acting ? 'Saving…' : 'Approve QC decision'}</button>
                  </div>
                </div>
              )}

              {!canApproveSelected && selectedObjection.status === 'awaiting_qtl' && (
                <p className="muted">Waiting for Super Admin or QTL approval. The published review has not changed yet.</p>
              )}
            </section>
          )}

          {selectedObjection.decision && selectedObjection.approval_status === 'approved' && (
            <div className="alert alert-success objection-issued-decision">
              <strong>Final decision: {formatLabel(selectedObjection.decision)}</strong>
              <span>{selectedObjection.decision_notes || 'Decision approved.'}</span>
              {selectedObjection.approver?.full_name && <span>Approved by {selectedObjection.approver.full_name}</span>}
              {(selectedObjection.score_changed || selectedObjection.flag_changed) && <span>The published review was updated after approval.</span>}
            </div>
          )}
        </section>
      )}

      <section className="panel table-panel">
        {loading ? <div className="empty-state">Loading objections…</div> : rows.length === 0 ? (
          <div className="empty-state"><h2>No objections yet</h2><p>{isStaff ? 'All objections visible to your role will appear here.' : 'Submitted objections and their decisions will appear here.'}</p></div>
        ) : (
          <div className="table-wrap"><table><thead><tr><th>Review</th><th>Tutor</th><th>Objected item</th><th>QC reviewer</th><th>Status</th><th>Recommendation / decision</th>{isStaff && <th>Action</th>}</tr></thead><tbody>
            {rows.map((row) => <tr key={row.id} className={selectedObjectionId === row.id ? 'objection-selected-row' : ''}>
              <td><strong>{formatDate(row.review?.session_date)}</strong><span className="table-subtext">{row.review?.session_topic || 'Session evaluation'}</span></td>
              <td>{row.tutor ? `${row.tutor.employee_code} — ${row.tutor.full_name}` : '—'}</td>
              <td>{row.object_type === 'flag' ? `${row.target_flag?.level?.toUpperCase() || ''} flag` : `${row.target_score?.criterion?.code || 'Metric'} score`}</td>
              <td>{row.assigned_reviewer?.full_name || 'Unassigned'}</td>
              <td><span className={`status-badge status-${row.status}`}>{formatLabel(row.status)}</span></td>
              <td>{formatLabel(row.decision || row.reviewer_recommendation)}</td>
              {isStaff && <td><button className="people-table-action" type="button" onClick={() => setSelectedObjectionId(row.id)}>Review case</button></td>}
            </tr>)}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}
