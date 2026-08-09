import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { hasPermission } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import '../review-management.css';

type ReviewRow = {
  id: string;
  evaluator_id: string;
  session_date: string | null;
  school_branch: string | null;
  course_track: string | null;
  session_topic: string | null;
  status: string;
  learning_outcome_status: string;
  compliance_status: string;
  total_score: number | null;
  maximum_score: number | null;
  score_percentage: number | null;
  teaching_percentage: number | null;
  compliance_percentage: number | null;
  project_percentage: number | null;
  project_score: number | null;
  created_at: string;
  tutor: { full_name: string; employee_code: string } | null;
  evaluator: { full_name: string } | null;
  project: { name: string } | null;
};

type ReviewScore = {
  id: string;
  numeric_score: number | null;
  is_observed: boolean;
  compliance_result: string | null;
  evidence: string | null;
  timestamp_seconds: number | null;
  weight_snapshot: number | null;
  criterion: {
    code: string;
    title: string;
    criterion_type: 'rating' | 'compliance';
    weight_percentage: number;
  } | null;
};

type ReviewFeedback = {
  observed_strength: string | null;
  development_priority: string | null;
  student_impact: string | null;
  required_action: string | null;
  follow_up_plan: string | null;
  follow_up_date: string | null;
};

type ReviewFlag = {
  id: string;
  level: 'yellow' | 'red';
  is_repeated: boolean;
  is_active: boolean;
  severity_reason: string | null;
  criterion: { title: string } | null;
};

const reviewSelect = 'id, evaluator_id, session_date, school_branch, course_track, session_topic, status, learning_outcome_status, compliance_status, total_score, maximum_score, score_percentage, teaching_percentage, compliance_percentage, project_percentage, project_score, created_at, tutor:tutors(full_name, employee_code), evaluator:profiles!reviews_evaluator_id_fkey(full_name), project:projects(name)';
const publishableStatuses = ['submitted', 'awaiting_approval', 'returned', 'reopened'];

function formatStatus(value: string) {
  return value.replaceAll('_', ' ');
}

function formatTimestamp(seconds: number | null) {
  if (seconds === null) return '';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00`).toLocaleDateString() : 'Date not entered';
}

function feedbackPoints(value: string | null | undefined) {
  if (!value?.trim()) return [];
  return value
    .replace(/\r/g, '')
    .split(/\n+|[•●▪◦]+\s*|;\s+|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((item) => item.replace(/^\s*[-–—*]+\s*/, '').trim())
    .filter(Boolean);
}

function FeedbackPointList({ value }: { value: string | null | undefined }) {
  const points = feedbackPoints(value);
  if (points.length === 0) return <p>Not recorded.</p>;
  return (
    <ul className="review-feedback-points">
      {points.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}
    </ul>
  );
}

export function ReviewsPage() {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedReviewId = searchParams.get('review');
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [selectedReview, setSelectedReview] = useState<ReviewRow | null>(null);
  const [scores, setScores] = useState<ReviewScore[]>([]);
  const [feedback, setFeedback] = useState<ReviewFeedback | null>(null);
  const [flags, setFlags] = useState<ReviewFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const notice = (location.state as { notice?: string } | null)?.notice;

  useEffect(() => {
    async function loadReviews() {
      setLoading(true);
      const { data, error: queryError } = await supabase
        .from('reviews')
        .select(reviewSelect)
        .order('created_at', { ascending: false });

      if (queryError) setError(queryError.message);
      else setReviews((data ?? []) as unknown as ReviewRow[]);
      setLoading(false);
    }

    void loadReviews();
  }, []);

  useEffect(() => {
    async function loadReviewDetails() {
      if (!selectedReviewId) {
        setSelectedReview(null);
        setScores([]);
        setFeedback(null);
        setFlags([]);
        return;
      }

      setDetailLoading(true);
      setError('');
      const [reviewResult, scoresResult, feedbackResult, flagsResult] = await Promise.all([
        supabase.from('reviews').select(reviewSelect).eq('id', selectedReviewId).maybeSingle(),
        supabase
          .from('review_scores')
          .select('id, numeric_score, is_observed, compliance_result, evidence, timestamp_seconds, weight_snapshot, criterion:evaluation_criteria(code, title, criterion_type, weight_percentage)')
          .eq('review_id', selectedReviewId),
        supabase
          .from('review_feedback')
          .select('observed_strength, development_priority, student_impact, required_action, follow_up_plan, follow_up_date')
          .eq('review_id', selectedReviewId)
          .maybeSingle(),
        supabase
          .from('review_flags')
          .select('id, level, is_repeated, is_active, severity_reason, criterion:evaluation_criteria(title)')
          .eq('review_id', selectedReviewId),
      ]);

      const firstError = reviewResult.error || scoresResult.error || feedbackResult.error || flagsResult.error;
      if (firstError) {
        setError(firstError.message);
        setSelectedReview(null);
      } else {
        setSelectedReview(reviewResult.data as unknown as ReviewRow | null);
        setScores((scoresResult.data ?? []) as unknown as ReviewScore[]);
        setFeedback(feedbackResult.data as ReviewFeedback | null);
        setFlags((flagsResult.data ?? []) as unknown as ReviewFlag[]);
      }
      setDetailLoading(false);
    }

    void loadReviewDetails();
  }, [selectedReviewId]);

  const canCreate = hasPermission(profile, 'create_evaluation');
  const isTutor = profile?.role === 'tutor';

  function canPublishReview(review: ReviewRow) {
    if (!profile || !hasPermission(profile, 'publish_reviews') || !publishableStatuses.includes(review.status)) return false;
    if (profile.role === 'qc') return review.evaluator_id === profile.id;
    return ['super_admin', 'admin', 'qtl'].includes(profile.role);
  }

  function canEditReview(review: ReviewRow) {
    if (!profile || !hasPermission(profile, 'edit_reviews')) return false;
    if (profile.role === 'qc') return review.evaluator_id === profile.id;
    return ['super_admin', 'admin', 'qtl'].includes(profile.role);
  }

  function canDeleteReview(review: ReviewRow) {
    if (!profile || !hasPermission(profile, 'delete_reviews')) return false;
    if (profile.role === 'qc') return review.evaluator_id === profile.id;
    return ['super_admin', 'admin', 'qtl'].includes(profile.role);
  }

  async function publishReview(reviewId: string) {
    setPublishingId(reviewId);
    setError('');
    setSuccess('');

    try {
      const { error: publishError } = await supabase.rpc('publish_review_to_tutor', {
        p_review_id: reviewId,
      });
      if (publishError) throw publishError;

      setReviews((items) => items.map((item) => item.id === reviewId ? { ...item, status: 'published' } : item));
      setSelectedReview((item) => item?.id === reviewId ? { ...item, status: 'published' } : item);
      setSuccess('Review published successfully. It is now visible to the tutor.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to publish the review.');
    } finally {
      setPublishingId(null);
    }
  }

  async function deleteReview(review: ReviewRow) {
    const label = review.session_topic || review.project?.name || formatDate(review.session_date);
    const confirmed = window.confirm(
      `Delete "${label}" permanently?\n\nThis will also delete its scores, Section 3 evaluation, feedback, flags, and Evaluation Re-consideration cases. This action cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingId(review.id);
    setError('');
    setSuccess('');
    try {
      const { error: deleteError } = await supabase.rpc('delete_review_secure', { p_review_id: review.id });
      if (deleteError) throw deleteError;

      setReviews((items) => items.filter((item) => item.id !== review.id));
      if (selectedReviewId === review.id) {
        setSelectedReview(null);
        navigate('/reviews', { replace: true, state: { notice: 'Review deleted permanently.' } });
      } else {
        setSuccess('Review deleted permanently.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete the review.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="page-stack review-portal-page">
      <header className="page-header review-portal-header">
        <div>
          <p className="eyebrow">Evaluation records</p>
          <h1>{isTutor ? 'My reviews' : 'Reviews'}</h1>
          <p>{isTutor ? 'Only your published evaluations are available in this account.' : 'Published and in-progress evaluation records visible to your role.'}</p>
        </div>
        {canCreate && <Link className="button button-primary" to="/evaluations/new">New evaluation</Link>}
      </header>

      {notice && <div className="alert alert-success">{notice}</div>}
      {success && <div className="alert alert-success">{success}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {selectedReviewId && (
        <section className="review-detail-card">
          {detailLoading ? <div className="review-detail-loading">Loading review details…</div> : !selectedReview ? (
            <div className="review-detail-loading">This review is not available to your account.</div>
          ) : (
            <>
              <div className="review-detail-header">
                <div>
                  <span className="review-detail-kicker">Evaluation</span>
                  <h2>{selectedReview.session_topic || selectedReview.project?.name || 'Session evaluation'}</h2>
                  <p>{formatDate(selectedReview.session_date)} · {selectedReview.course_track || 'No course track'} · {selectedReview.school_branch || 'No branch'}</p>
                </div>
                <div className="review-detail-actions">
                  {canEditReview(selectedReview) && <Link className="people-secondary-button review-edit-link" to={`/reviews/edit?review=${selectedReview.id}`}>Edit review</Link>}
                  {canPublishReview(selectedReview) && (
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={publishingId === selectedReview.id}
                      onClick={() => void publishReview(selectedReview.id)}
                    >
                      {publishingId === selectedReview.id ? 'Publishing…' : 'Publish to tutor'}
                    </button>
                  )}
                  {canDeleteReview(selectedReview) && <button className="people-secondary-button review-delete-button" type="button" disabled={deletingId === selectedReview.id} onClick={() => void deleteReview(selectedReview)}>{deletingId === selectedReview.id ? 'Deleting…' : 'Delete review'}</button>}
                  {isTutor && selectedReview.status === 'published' && <Link className="button button-primary" to={`/objections?review=${selectedReview.id}`}>Evaluation Re-consideration</Link>}
                  <Link className="people-secondary-button" to="/reviews">Close details</Link>
                </div>
              </div>

              <div className="review-score-grid composite-score-grid">
                <article><small>Overall score</small><strong>{selectedReview.score_percentage !== null ? `${selectedReview.score_percentage}%` : '—'}</strong></article>
                <article><small>Teaching</small><strong>{selectedReview.teaching_percentage !== null ? `${selectedReview.teaching_percentage}%` : '—'}</strong></article>
                <article><small>Compliance score</small><strong>{selectedReview.compliance_percentage !== null ? `${selectedReview.compliance_percentage}%` : '—'}</strong><span>{formatStatus(selectedReview.compliance_status)}</span></article>
                <article><small>Section 3</small><strong>{selectedReview.project_percentage !== null ? `${selectedReview.project_percentage}%` : '—'}</strong><span>{selectedReview.project?.name || 'No Org. selected'}</span></article>
              </div>

              <div className="review-detail-layout">
                <div className="review-dimensions-card">
                  <div className="review-section-heading"><div><span className="review-detail-kicker">Evaluation breakdown</span><h3>Observed dimensions</h3></div></div>
                  <div className="review-dimension-list">
                    {scores.length === 0 ? <p className="muted">No score details available.</p> : scores.map((score) => (
                      <article key={score.id}>
                        <div className="review-dimension-title">
                          <span>{score.criterion?.code || '—'}</span>
                          <div><strong>{score.criterion?.title || 'Evaluation criterion'}</strong><small>{score.criterion?.criterion_type === 'rating' ? `${score.weight_snapshot ?? score.criterion.weight_percentage}% contribution` : 'Compliance check'}</small></div>
                        </div>
                        <div className="review-dimension-result">
                          <strong>{score.criterion?.criterion_type === 'rating' ? (score.is_observed ? `${score.numeric_score ?? '—'} / 5` : 'Not observed') : formatStatus(score.compliance_result || 'not recorded')}</strong>
                          {score.timestamp_seconds !== null && <small>{formatTimestamp(score.timestamp_seconds)}</small>}
                        </div>
                        {score.evidence && <p>{score.evidence}</p>}
                      </article>
                    ))}
                  </div>
                </div>

                <div className="review-feedback-stack">
                  <section className="review-feedback-card">
                    <span className="review-detail-kicker">Tutor feedback</span>
                    <div><small>Strengths</small><FeedbackPointList value={feedback?.observed_strength} /></div>
                    <div><small>Development Areas</small><FeedbackPointList value={feedback?.development_priority} /></div>
                    <div><small>Student impact</small><p>{feedback?.student_impact || 'Not recorded.'}</p></div>
                    <div><small>Required action</small><p>{feedback?.required_action || 'Not recorded.'}</p></div>
                    {feedback?.follow_up_plan && <div><small>Follow-up</small><p>{feedback.follow_up_plan}{feedback.follow_up_date ? ` · ${new Date(feedback.follow_up_date).toLocaleDateString()}` : ''}</p></div>}
                  </section>

                  <section className="review-feedback-card">
                    <span className="review-detail-kicker">Compliance flags</span>
                    {flags.filter((flag) => flag.is_active).length === 0 ? <p className="review-clear-state">No active yellow or red flags.</p> : flags.filter((flag) => flag.is_active).map((flag) => (
                      <article className={`review-flag review-flag-${flag.level}`} key={flag.id}>
                        <strong>{flag.level.toUpperCase()} · {flag.criterion?.title || 'Compliance'}</strong>
                        <p>{flag.severity_reason || 'No reason recorded.'}</p>
                        {flag.is_repeated && <small>Repeated observation</small>}
                      </article>
                    ))}
                  </section>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      <section className="panel table-panel review-list-card">
        {loading ? <div className="empty-state">Loading reviews…</div> : reviews.length === 0 ? (
          <div className="empty-state"><h2>No reviews yet</h2><p>{isTutor ? 'Your published reviews will appear here.' : 'Reviews will appear here once they are created and permitted by your access level.'}</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th>{!isTutor && <th>Tutor</th>}<th>Evaluator</th><th>Overall score</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {reviews.map((review) => (
                  <tr key={review.id}>
                    <td><strong>{formatDate(review.session_date)}</strong><span className="table-subtext">{review.session_topic || review.project?.name || 'No topic entered'}</span></td>
                    {!isTutor && <td>{review.tutor ? `${review.tutor.employee_code} — ${review.tutor.full_name}` : '—'}</td>}
                    <td>{review.evaluator?.full_name ?? '—'}</td>
                    <td><strong>{review.score_percentage !== null ? `${review.score_percentage}%` : '—'}</strong><span className="table-subtext">{review.total_score ?? '—'} / {review.maximum_score ?? '—'}</span></td>
                    <td><span className={`status-badge status-${review.status}`}>{formatStatus(review.status)}</span></td>
                    <td>
                      <div className="review-row-actions">
                        <Link to={`/reviews?review=${review.id}`}>View</Link>
                        {canEditReview(review) && <Link className="review-edit-link" to={`/reviews/edit?review=${review.id}`}>Edit</Link>}
                        {canPublishReview(review) && <button type="button" disabled={publishingId === review.id} onClick={() => void publishReview(review.id)}>{publishingId === review.id ? 'Publishing…' : 'Publish'}</button>}
                        {canDeleteReview(review) && <button className="review-delete-link" type="button" disabled={deletingId === review.id} onClick={() => void deleteReview(review)}>{deletingId === review.id ? 'Deleting…' : 'Delete'}</button>}
                        {isTutor && review.status === 'published' && <Link to={`/objections?review=${review.id}`}>Re-consider</Link>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
