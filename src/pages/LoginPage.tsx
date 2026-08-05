import { useEffect, useState, type FormEvent } from 'react';
import ischoolLogo from '../assets/ischool-logo-official.svg';
import { useAuth } from '../auth/AuthProvider';
import { useRouter } from '../lib/router';

export function LoginPage() {
  const { user, signIn } = useAuth();
  const { state, navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [navigate, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      const nextPath = (state as { from?: string } | null)?.from ?? '/';
      navigate(nextPath, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="auth-brand">
          <div className="auth-logo-panel"><img src={ischoolLogo} alt="iSchool" /></div>
          <span>B2B Offline Quality Evaluation</span>
        </div>

        <div className="auth-hero-copy">
          <p className="eyebrow light">Proposed operating model</p>
          <h1>Measure student learning. Protect fairness. Drive clear action.</h1>
          <p>One structured workspace that separates session context, teaching quality, compliance severity, and tutor development.</p>
        </div>

        <div className="auth-pillars" aria-label="Evaluation model pillars">
          <div><span>01</span><strong>Context</strong><small>Fair interpretation</small></div>
          <div><span>02</span><strong>Teaching</strong><small>Weighted quality</small></div>
          <div><span>03</span><strong>Compliance</strong><small>Separate status</small></div>
          <div><span>04</span><strong>Action</strong><small>Clear follow-up</small></div>
        </div>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit}>
          <div className="auth-card-heading">
            <div className="login-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" /></svg>
            </div>
            <div>
              <p className="eyebrow">Secure access</p>
              <h2>Welcome to B2B Offline</h2>
              <p>Sign in with your approved iSchool account.</p>
            </div>
          </div>

          <label>
            Email address
            <div className="input-with-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3zM3 7l9 6 9-6" /></svg>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@ischooltech.com" required />
            </div>
          </label>

          <label>
            Password
            <div className="input-with-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" /></svg>
              <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
            </div>
          </label>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <button className="button button-primary auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in to workspace'}
            {!submitting && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>}
          </button>

          <div className="auth-security-note">
            <span className="status-dot" />
            Role-based access and audit history are enabled.
          </div>
        </form>
      </section>
    </div>
  );
}
