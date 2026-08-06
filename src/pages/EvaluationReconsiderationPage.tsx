import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { hasPermission } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import '../evaluation-reconsideration.css';

type ReconsiderationDecision = 'accepted' | 'partially_accepted' | 'rejected' | 'more_evidence_required';
type FlagAction = 'remove' | 'downgrade_to_yellow';
type TargetType = 'flag' | 'criterion_score';
type ReasonOption = [string, string];

type ReconsiderationRow = {
  id: string;
  review_id: string;
  tutor_id: string;
  created_at: string;
  object_type: TargetType;
  reason_code: string;
  status: string;
  explanation: string;
  requested_outcome: string | null;
  decision: string | null;
  decision_notes: string | null;
  assigned_reviewer_id: string | null;
  reviewer_recommendation: ReconsiderationDecision | null;
  reviewer_notes: string | null;
  proposed_score: number | null;
  proposed_flag_action: FlagAction | null;
  approval_status: 'pending' | 'approved' | 'declined' | null;
  approval_notes: string | null;
  qtl_approved_by: string | null;
  score_changed: boolean;
  flag_changed: boolean;
  review: {
    id: string;
    session_date: string | null;
    session_topic: string | null;
    status: string;
    evaluator_id: string;
  } | null;
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
  tutor_name: string;
  tutor_code: string;
  evaluator_name: string;
  assigned_reviewer_name: string;
  approver_name: string;
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

const reconsiderationSelect = `
  id,
  review_id,
  tutor_id,
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
  qtl_approved_by,
  score_changed,
  flag_changed,
  review:reviews(id, session_date, session_topic, status, evaluator_id),
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

export function EvaluationReconsiderationPage() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const reviewId = searchParams.get('review');

  const [rows, setRows] = useState<ReconsiderationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedReview, setSelectedReview] = useState<SelectedReview | null>(null);
  const [eligibleFlags, setEligibleFlags] = useState<EligibleFlag[]>([]);
  const [eligibleScores, setEligibleScores] = useState<EligibleScore[]>([]);
  const [targetKey, setTargetKey] = useState('');
  const [reasonCode, setReasonCode] = useState(flagReasonOptions[0][0]);
  const [explanation, setExplanation] = useState('');
  const [requestedOutcome, setRequestedOutcome] = useState('');

  const [decision, setDecision] = useState<ReconsiderationDecision>('accepted');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [proposedScore, setProposedScore] = useState('2');
  const [proposedFlagAction, setProposedFlagAction] = useState<FlagAction>('remove');
  const [approvalNotes, setApprovalNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isTutor = profile?.role === 'tutor';
  const isQC = profile?.role === 'qc';
  const isQTL = profile?.role === 'qtl';
  const isSuperAdmin = profile?.role === 'super_admin';
  const isStaff = ['super_admin', 'admin', 'qtl', 'qc'].includes(profile?.role ?? '');
  const canReview = isSuperAdmin || hasPermission(profile, 'review_objections');

  async function loadReconsiderations(preferredId?: string | null) {
    setLoading(true);
    setError('');

    const { data, error: queryError } = await supabase
      .from('objections')
      .select(reconsiderationSelect)
      .order('created_at', { ascending: false });

    if (queryError) {
      setRows([]);
      setSelectedId(null);
      setError(`Unable to load Evaluation Re-consideration cases: ${queryError.message}`);
      setLoading(false);
      return;
    }

    const rawRows = (data ?? []) as unknown as Omit<ReconsiderationRow, 'tutor_name' | 'tutor_code' | 'evaluator_name' | 'assigned_reviewer_name' | 'approver_name'>[];
    const profileIds = [...new Set(rawRows.flatMap((row) => [
      row.review?.evaluator_id,
      row.assigned_reviewer_id,
      row.qtl_approved_by,
    ]).filter((value): value is string => Boolean(value)))];
    const tutorIds = [...new Set(rawRows.map((row) => row.tutor_id).filter(Boolean))];

    const [profilesResult, tutorsResult] = await Promise.all([
      profileIds.length
        ? supabase.from('profiles').select('id, full_name').in('id', profileIds)
        : Promise.resolve({ data: [], error: null }),
      tutorIds.length
        ? supabase.from('tutors').select('id, full_name, employee_code').in('id', tutorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesResult.error || tutorsResult.error) {
      setRows([]);
      setSelectedId(null);
      setError(`The cases were found, but related people could not be loaded: ${(profilesResult.error || tutorsResult.error)?.message}`);
      setLoading(false);
      return;
    }

    const profileMap = new Map((profilesResult.data ?? []).map((item) => [item.id, item.full_name]));
    const tutorMap = new Map((tutorsResult.data ?? []).map((item) => [item.id, item]));
    const nextRows: ReconsiderationRow[] = rawRows.map((row) => {
      const tutor = tutorMap.get(row.tutor_id);
      return {
        ...row,
        tutor_name: tutor?.full_name ?? 'Tutor',
        tutor_code: tutor?.employee_code ?? '—',
        evaluator_name: row.review?.evaluator_id ? profileMap.get(row.review.evaluator_id) ?? 'Not available' : 'Not available',
        assigned_reviewer_name: row.assigned_reviewer_id ? profileMap.get(row.assigned_reviewer_id) ?? 'Assigned reviewer' : 'Unassigned',
        approver_name: row.qtl_approved_by ? profileMap.get(row.qtl_approved_by) ?? 'Approver' : '',
      };
    });

    setRows(nextRows);
    const desiredId = preferredId ?? selectedId;
    if (desiredId && nextRows.some((row) => row.id === desiredId)) setSelectedId(desiredId);
    else if (isStaff && nextRows[0]) setSelectedId(nextRows[0].id);
    else setSelectedId(null);
    setLoading(false);
  }

  useEffect(() => {
    void loadReconsiderations();
  }, [profile?.id, profile?.role]);

  useEffect(() => {
    async function loadTutorEligibility() {
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
        supabase.from('reviews').select('id, status, session_date, session_topic').eq('id', reviewId).maybeSingle(),
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

    void loadTutorEligibility();
  }, [isTutor, reviewId]);

  const selectedTarget = useMemo(() => parseTarget(targetKey), [targetKey]);
  const currentReasonOptions = selectedTarget?.type === 'criterion_score' ? scoreReasonOptions : flagReasonOptions;
  const selectedCase = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  const eligibleCount = eligibleFlags.length + eligibleScores.length;
  const submittedCount = rows.filter((row) => row.status === 'submitted').length;
  const inReviewCount = rows.filter((row) => ['under_review', 'evidence_required'].includes(row.status)).length;
  const awaitingApprovalCount = rows.filter((row) => row.status === 'awaiting_qtl').length;
  const resolvedCount = rows.filter((row) => ['decision_issued', 'closed'].includes(row.status)).length;

  const isFinal = selectedCase ? ['decision_issued', 'closed'].includes(selectedCase.status) : false;
  const canQCTake = Boolean(isQC && canReview && selectedCase && !selectedCase.assigned_reviewer_id && !isFinal);
  const canQCDecide = Boolean(
    isQC
    && canReview
    && selectedCase
    && selectedCase.assigned_reviewer_id === profile?.id
    && ['under_review', 'evidence_required'].includes(selectedCase.status),
  );
  const canSuperAdminDecide = Boolean(
    isSuperAdmin
    && selectedCase
    && !isFinal
    && selectedCase.status !== 'awaiting_qtl',
  );
  const canApproveQC = Boolean(
    (isSuperAdmin || isQTL)
    && selectedCase
    && selectedCase.status === 'awaiting_qtl'
    && selectedCase.reviewer_recommendation,
  );

  useEffect(() => {
    if (!selectedCase) return;
    setDecision(selectedCase.reviewer_recommendation ?? 'accepted');
    setDecisionNotes(selectedCase.reviewer_notes ?? '');
    setProposedScore(String(selectedCase.proposed_score ?? Math.max(2, Number(selectedCase.target_score?.numeric_score ?? 1))));
    setProposedFlagAction(selectedCase.proposed_flag_action ?? 'remove');
    setApprovalNotes('');
  }, [selectedCase?.id, selectedCase?.status, selectedCase?.approval_status]);

  function changeTarget(value: string) {
    setTargetKey(value);
    const target = parseTarget(value);
    setReasonCode(target?.type === 'criterion_score' ? scoreReasonOptions[0][0] : flagReasonOptions[0][0]);
  }

  async function submitTutorReconsideration(event: FormEvent<HTMLFormElement>) {
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

    if (insertError) setError(insertError.message);
    else {
      setExplanation('');
      setRequestedOutcome('');
      setNotice('Your Evaluation Re-consideration request was submitted.');
      await loadReconsiderations();
    }
    setSaving(false);
  }

  async function takeCase(caseId: string) {
    setActing(true);
    setError('');
    setNotice('');
    const { error: claimError } = await supabase.rpc('claim_objection', { p_objection_id: caseId });
    if (claimError) setError(claimError.message);
    else {
      setNotice('The case is assigned to you.');
      await loadReconsiderations(caseId);
    }
    setActing(false);
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCase) return;

    setActing(true);
    setError('');
    setNotice('');
    const appliesChange = decision === 'accepted' || decision === 'partially_accepted';
    const scoreValue = selectedCase.object_type === 'criterion_score' && appliesChange ? Number(proposedScore) : null;
    const flagValue = selectedCase.object_type === 'flag' && appliesChange ? proposedFlagAction : null;

    const result = isSuperAdmin
      ? await supabase.rpc('super_admin_resolve_reconsideration', {
          p_objection_id: selectedCase.id,
          p_decision: decision,
          p_decision_notes: decisionNotes.trim(),
          p_new_score: scoreValue,
          p_flag_action: flagValue,
        })
      : await supabase.rpc('submit_objection_recommendation', {
          p_objection_id: selectedCase.id,
          p_recommendation: decision,
          p_reviewer_notes: decisionNotes.trim(),
          p_proposed_score: scoreValue,
          p_proposed_flag_action: flagValue,
        });

    if (result.error) setError(result.error.message);
    else {
      setNotice(isSuperAdmin
        ? 'The Super Admin decision was applied immediately.'
        : 'The QC decision was sent to Super Admin / QTL for approval.');
      await loadReconsiderations(selectedCase.id);
    }
    setActing(false);
  }

  async function approveQCDecision(approve: boolean) {
    if (!selectedCase) return;
    if (!approve && approvalNotes.trim().length < 3) {
      setError('Write a short reason before returning the decision.');
      return;
    }

    setActing(true);
    setError('');
    setNotice('');
    const { error: approvalError } = await supabase.rpc('approve_objection_recommendation', {
      p_objection_id: selectedCase.id,
      p_approve: approve,
      p_approval_notes: approvalNotes.trim(),
    });

    if (approvalError) setError(approvalError.message);
    else {
      setNotice(approve ? 'The QC decision was approved and applied.' : 'The case was returned to QC.');
      await loadReconsiderations(selectedCase.id);
    }
    setActing(false);
  }

  return (
    <div className="page-stack reconsideration-page">
      <header className="page-header reconsideration-header">
        <div>
          <p className="eyebrow">Evaluation review request</p>
          <h1>{isTutor ? 'My Evaluation Re-considerations' : 'Evaluation Re-consideration'}</h1>
          <p>
            {isTutor
              ? 'Request a review of an active yellow/red flag or a teaching score of 1.'
              : isSuperAdmin
                ? 'You can see every case, take a direct decision, or approve a QC decision.'
                : 'Review tutor requests and follow each decision through approval.'}
          </p>
        </div>
      </header>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {isStaff && (
        <section className="people-summary-grid reconsideration-summary-grid" aria-label="Evaluation Re-consideration summary">
          <article><span className="people-summary-icon people-summary-orange">NEW</span><div><small>Waiting for review</small><strong>{submittedCount}</strong></div></article>
          <article><span className="people-summary-icon people-summary-violet">IN</span><div><small>Under review</small><strong>{inReviewCount}</strong></div></article>
          <article><span className="people-summary-icon people-summary-blue">AP</span><div><small>Awaiting approval</small><strong>{awaitingApprovalCount}</strong></div></article>
          <article><span className="people-summary-icon people-summary-green">OK</span><div><small>Resolved</small><strong>{resolvedCount}</strong></div></article>
        </section>
      )}

      {isTutor && reviewId && (
        <section className="panel form-section">
          <div className="panel-heading"><div><p className="eyebrow">Selected review</p><h2>{selectedReview?.session_topic || 'Submit Evaluation Re-consideration'}</h2>{selectedReview && <p className="muted">{formatDate(selectedReview.session_date)}</p>}</div></div>
          {eligibilityLoading ? <div className="empty-state">Checking eligible items…</div> : !selectedReview || selectedReview.status !== 'published' ? (
            <div className="alert alert-error">This review is not published or is not available to this tutor account.</div>
          ) : eligibleCount === 0 ? (
            <div className="empty-state"><h2>No eligible items</h2><p>This review has no active yellow/red flags and no teaching dimension scored 1.</p></div>
          ) : (
            <form className="form-grid" onSubmit={submitTutorReconsideration}>
              <label className="full-width">Item to reconsider<select value={targetKey} onChange={(event) => changeTarget(event.target.value)} required>
                {eligibleFlags.map((flag) => <option key={flag.id} value={`flag:${flag.id}`}>{flag.level.toUpperCase()} flag — {flag.criterion?.title || 'Compliance item'}</option>)}
                {eligibleScores.map((score) => <option key={score.id} value={`criterion_score:${score.id}`}>Score 1 — {score.criterion?.code ? `${score.criterion.code} · ` : ''}{score.criterion?.title || 'Teaching metric'}</option>)}
              </select></label>
              <label>Reason<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>{currentReasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="full-width">Explanation<textarea rows={5} required minLength={10} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Explain the exact point and supporting evidence…" /></label>
              <label className="full-width">Requested outcome <span className="muted">(optional)</span><textarea rows={2} value={requestedOutcome} onChange={(event) => setRequestedOutcome(event.target.value)} /></label>
              <div className="full-width"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit Re-consideration'}</button></div>
            </form>
          )}
        </section>
      )}

      {isStaff && selectedCase && (
        <section className="panel reconsideration-detail-panel">
          <div className="panel-heading reconsideration-detail-heading">
            <div><p className="eyebrow">Selected case</p><h2>{selectedCase.tutor_code} — {selectedCase.tutor_name}</h2><p className="muted">{formatDate(selectedCase.review?.session_date)} · {selectedCase.review?.session_topic || 'Session evaluation'}</p></div>
            <span className={`status-badge status-${selectedCase.status}`}>{formatLabel(selectedCase.status)}</span>
          </div>

          <div className="reconsideration-evidence-grid">
            <article className="reconsideration-evidence-card">
              <span className="review-detail-kicker">Item to reconsider</span>
              {selectedCase.object_type === 'criterion_score' ? (
                <><h3>{selectedCase.target_score?.criterion?.code} · {selectedCase.target_score?.criterion?.title || 'Teaching metric'}</h3><strong className="objection-current-value">Current score: {selectedCase.target_score?.numeric_score ?? '—'} / 5</strong><p>{selectedCase.target_score?.evidence || 'No evaluator evidence recorded.'}</p></>
              ) : (
                <><h3>{selectedCase.target_flag?.level?.toUpperCase()} flag · {selectedCase.target_flag?.criterion?.title || 'Compliance item'}</h3><strong className="objection-current-value">{selectedCase.target_flag?.is_active ? 'Active flag' : 'Flag already changed'}</strong><p>{selectedCase.target_flag?.severity_reason || 'No severity reason recorded.'}</p></>
              )}
              <small>Original evaluator</small><p>{selectedCase.evaluator_name}</p>
            </article>

            <article className="reconsideration-evidence-card">
              <span className="review-detail-kicker">Tutor request</span>
              <h3>{allReasonOptions.find(([value]) => value === selectedCase.reason_code)?.[1] ?? formatLabel(selectedCase.reason_code)}</h3>
              <p>{selectedCase.explanation}</p>
              {selectedCase.requested_outcome && <><small>Requested outcome</small><p>{selectedCase.requested_outcome}</p></>}
              <small>Decision owner</small><p>{selectedCase.assigned_reviewer_name}</p>
            </article>
          </div>

          {canQCTake && (
            <div className="objection-claim-row"><p>Take this case to issue the QC decision.</p><button className="button button-primary" type="button" disabled={acting} onClick={() => void takeCase(selectedCase.id)}>{acting ? 'Assigning…' : 'Take case'}</button></div>
          )}

          {(canQCDecide || canSuperAdminDecide) && (
            <form className="form-grid objection-decision-form" onSubmit={submitDecision}>
              <div className="full-width objection-workflow-note">
                <strong>{canSuperAdminDecide ? 'Super Admin direct decision' : 'QC decision'}</strong>
                <span>{canSuperAdminDecide ? 'Your decision is applied immediately and does not wait for QC approval.' : 'The review stays unchanged until Super Admin or QTL approval.'}</span>
              </div>
              <label>Decision<select value={decision} onChange={(event) => setDecision(event.target.value as ReconsiderationDecision)}>
                <option value="accepted">Accept request</option>
                <option value="partially_accepted">Partially accept</option>
                <option value="rejected">Reject request</option>
                <option value="more_evidence_required">Request more evidence</option>
              </select></label>
              {(decision === 'accepted' || decision === 'partially_accepted') && selectedCase.object_type === 'criterion_score' && (
                <label>New metric score<select value={proposedScore} onChange={(event) => setProposedScore(event.target.value)}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label>
              )}
              {(decision === 'accepted' || decision === 'partially_accepted') && selectedCase.object_type === 'flag' && (
                <label>Flag action<select value={proposedFlagAction} onChange={(event) => setProposedFlagAction(event.target.value as FlagAction)}><option value="remove">Remove flag</option>{selectedCase.target_flag?.level === 'red' && <option value="downgrade_to_yellow">Downgrade red to yellow</option>}</select></label>
              )}
              <label className="full-width">Decision rationale<textarea rows={4} required minLength={5} value={decisionNotes} onChange={(event) => setDecisionNotes(event.target.value)} placeholder="Explain the decision and evidence used…" /></label>
              <div className="full-width objection-decision-actions"><button className="button button-primary" type="submit" disabled={acting}>{acting ? 'Saving…' : canSuperAdminDecide ? 'Apply decision' : 'Send for approval'}</button></div>
            </form>
          )}

          {selectedCase.reviewer_recommendation && (
            <section className="objection-approval-card">
              <div><span className="review-detail-kicker">QC decision</span><h3>{formatLabel(selectedCase.reviewer_recommendation)}</h3><p>{selectedCase.reviewer_notes || 'No QC rationale recorded.'}</p></div>
              <div className="objection-proposed-change"><small>Proposed review change</small><strong>
                {['rejected', 'more_evidence_required'].includes(selectedCase.reviewer_recommendation)
                  ? 'No review edit proposed'
                  : selectedCase.object_type === 'criterion_score'
                    ? `Change metric score to ${selectedCase.proposed_score ?? '—'} / 5`
                    : selectedCase.proposed_flag_action === 'downgrade_to_yellow'
                      ? 'Downgrade red flag to yellow'
                      : 'Remove the flag'}
              </strong></div>

              {canApproveQC && (
                <div className="objection-approval-actions">
                  <label>Approval note <span className="muted">(optional for approve; required when returning)</span><textarea rows={3} value={approvalNotes} onChange={(event) => setApprovalNotes(event.target.value)} /></label>
                  <div><button className="people-secondary-button" type="button" disabled={acting} onClick={() => void approveQCDecision(false)}>Return to QC</button><button className="button button-primary" type="button" disabled={acting} onClick={() => void approveQCDecision(true)}>{acting ? 'Applying…' : 'Approve QC decision'}</button></div>
                </div>
              )}

              {selectedCase.approval_status === 'approved' && <div className="alert alert-success objection-issued-decision"><strong>Approved</strong><span>{selectedCase.approval_notes || 'Decision approved.'}</span>{selectedCase.approver_name && <span>Approved by {selectedCase.approver_name}</span>}</div>}
            </section>
          )}

          {selectedCase.decision && !selectedCase.reviewer_recommendation && (
            <div className="alert alert-success reconsideration-final-decision"><strong>Final decision: {formatLabel(selectedCase.decision)}</strong><span>{selectedCase.decision_notes || 'Decision recorded.'}</span></div>
          )}
        </section>
      )}

      <section className="panel table-panel">
        {loading ? <div className="empty-state">Loading Evaluation Re-consideration cases…</div> : rows.length === 0 ? (
          <div className="empty-state"><h2>No Evaluation Re-consideration cases</h2><p>{isSuperAdmin ? 'No cases were returned. Any database access error will appear above.' : 'Submitted requests and decisions will appear here.'}</p></div>
        ) : (
          <div className="table-wrap"><table><thead><tr><th>Review</th><th>Tutor</th><th>Item</th><th>Original evaluator</th><th>Decision owner</th><th>Status</th><th>Decision</th></tr></thead><tbody>
            {rows.map((row) => <tr key={row.id} className={row.id === selectedId ? 'reconsideration-selected-row' : undefined} onClick={() => isStaff && setSelectedId(row.id)}>
              <td><strong>{formatDate(row.review?.session_date)}</strong><span className="table-subtext">{row.review?.session_topic || 'Session evaluation'}</span></td>
              <td>{row.tutor_code} — {row.tutor_name}</td>
              <td>{row.object_type === 'flag' ? 'Compliance flag' : 'Score of 1'}</td>
              <td>{row.evaluator_name}</td>
              <td>{row.assigned_reviewer_name}</td>
              <td><span className={`status-badge status-${row.status}`}>{formatLabel(row.status)}</span></td>
              <td>{formatLabel(row.decision || row.reviewer_recommendation)}</td>
            </tr>)}
          </tbody></table></div>
        )}
      </section>
    </div>
  );
}
