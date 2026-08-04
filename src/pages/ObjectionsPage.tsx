import { useEffect, useState, type FormEvent } from 'react';
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
  review: { session_date: string; session_topic: string | null } | null;
  tutor: { full_name: string; employee_code: string } | null;
};

const reasonOptions = [
  ['evidence_misunderstood', 'Evidence was misunderstood'],
  ['behavior_did_not_occur', 'The behavior did not occur'],
  ['timestamp_incorrect', 'The timestamp is incorrect'],
  ['not_observable', 'The criterion was not observable'],
  ['external_cause', 'An external or school cause was not considered'],
  ['severity_mismatch', 'The compliance severity does not match the evidence'],
  ['score_mismatch', 'The score does not match the evidence'],
  ['other', 'Other'],
];

export function ObjectionsPage() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const reviewId = searchParams.get('review');
  const [rows, setRows] = useState<ObjectionRow[]>([]);
  const [objectType, setObjectType] = useState('flag');
  const [reasonCode, setReasonCode] = useState(reasonOptions[0][0]);
  const [explanation, setExplanation] = useState('');
  const [requestedOutcome, setRequestedOutcome] = useState('');
  const [loading, setLoading] = useState(true);
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

  async function submitObjection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!reviewId || !profile?.tutor_id) {
      setError('A published review and linked tutor profile are required.');
      return;
    }

    setSaving(true);
    const { error: insertError } = await supabase.from('objections').insert({
      review_id: reviewId,
      tutor_id: profile.tutor_id,
      submitted_by: profile.id,
      object_type: objectType,
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
      <header className="page-header"><div><p className="eyebrow">Evaluation reconsideration</p><h1>Objections</h1><p>Evidence-based requests with a traceable decision history.</p></div></header>

      {profile?.role === 'tutor' && reviewId && (
        <section className="panel form-section">
          <div className="panel-heading"><div><p className="eyebrow">Selected review</p><h2>Raise an objection</h2></div></div>
          <form className="form-grid" onSubmit={submitObjection}>
            <label>Object to<select value={objectType} onChange={(event) => setObjectType(event.target.value)}><option value="flag">A compliance flag</option><option value="criterion_score">A teaching dimension score</option><option value="feedback">Written feedback</option><option value="calculation">The score calculation</option><option value="complete_review">The complete review</option></select></label>
            <label>Reason<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>{reasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="full-width">Explanation<textarea rows={5} required minLength={10} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Explain the exact point and include the relevant timestamp or evidence…" /></label>
            <label className="full-width">Requested outcome<textarea rows={2} value={requestedOutcome} onChange={(event) => setRequestedOutcome(event.target.value)} placeholder="For example: reconsider the score, update the feedback, or remove the flag." /></label>
            <div className="full-width"><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit objection'}</button></div>
          </form>
        </section>
      )}

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <section className="panel table-panel">
        {loading ? <div className="empty-state">Loading objections…</div> : rows.length === 0 ? <div className="empty-state"><h2>No objections yet</h2><p>Submitted objections and their decisions will appear here.</p></div> : (
          <div className="table-wrap"><table><thead><tr><th>Review</th><th>Tutor</th><th>Reason</th><th>Status</th><th>Decision</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.review ? new Date(row.review.session_date).toLocaleDateString() : '—'}</strong><span className="table-subtext">{row.review?.session_topic || row.object_type.replaceAll('_', ' ')}</span></td><td>{row.tutor ? `${row.tutor.employee_code} — ${row.tutor.full_name}` : '—'}</td><td>{reasonOptions.find(([value]) => value === row.reason_code)?.[1] ?? row.reason_code}</td><td><span className={`status-badge status-${row.status}`}>{row.status.replaceAll('_', ' ')}</span></td><td>{row.decision?.replaceAll('_', ' ') || 'Pending'}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
