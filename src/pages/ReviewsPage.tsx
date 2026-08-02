import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

type ReviewRow = {
  id: string;
  session_date: string;
  session_topic: string | null;
  status: string;
  total_score: number | null;
  maximum_score: number | null;
  score_percentage: number | null;
  created_at: string;
  tutor: { full_name: string; employee_code: string } | null;
  evaluator: { full_name: string } | null;
};

export function ReviewsPage() {
  const { profile } = useAuth();
  const location = useLocation();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const notice = (location.state as { notice?: string } | null)?.notice;

  useEffect(() => {
    async function loadReviews() {
      const { data, error: queryError } = await supabase
        .from('reviews')
        .select('id, session_date, session_topic, status, total_score, maximum_score, score_percentage, created_at, tutor:tutors(full_name, employee_code), evaluator:profiles!reviews_evaluator_id_fkey(full_name)')
        .order('created_at', { ascending: false });

      if (queryError) setError(queryError.message);
      else setReviews((data ?? []) as unknown as ReviewRow[]);
      setLoading(false);
    }

    void loadReviews();
  }, []);

  const canCreate = profile?.role !== 'tutor';

  return (
    <div className="page-stack">
      <header className="page-header">
        <div><p className="eyebrow">Evaluation records</p><h1>{profile?.role === 'tutor' ? 'My reviews' : 'Reviews'}</h1><p>Published and in-progress evaluation records visible to your role.</p></div>
        {canCreate && <Link className="button button-primary" to="/evaluations/new">New evaluation</Link>}
      </header>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <section className="panel table-panel">
        {loading ? <div className="empty-state">Loading reviews…</div> : reviews.length === 0 ? (
          <div className="empty-state"><h2>No reviews yet</h2><p>Reviews will appear here once they are created and permitted by your access level.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>Tutor</th><th>Evaluator</th><th>Score</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {reviews.map((review) => (
                  <tr key={review.id}>
                    <td><strong>{new Date(review.session_date).toLocaleDateString()}</strong><span className="table-subtext">{review.session_topic || 'No topic entered'}</span></td>
                    <td>{review.tutor ? `${review.tutor.employee_code} — ${review.tutor.full_name}` : '—'}</td>
                    <td>{review.evaluator?.full_name ?? '—'}</td>
                    <td>{review.total_score ?? '—'} / {review.maximum_score ?? '—'}<span className="table-subtext">{review.score_percentage !== null ? `${review.score_percentage}%` : ''}</span></td>
                    <td><span className={`status-badge status-${review.status}`}>{review.status.replaceAll('_', ' ')}</span></td>
                    <td>{profile?.role === 'tutor' && review.status === 'published' ? <Link to={`/objections?review=${review.id}`}>Raise objection</Link> : <span className="muted">Details soon</span>}</td>
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
