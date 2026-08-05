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
    <main className="elegant-login-page">
      <section className="elegant-login-card">
        <header className="elegant-login-brand">
          <img src={ischoolLogo} alt="iSchool" />
          <div>
            <strong>B2B Offline</strong>
            <span>Quality Evaluation Workspace</span>
          </div>
        </header>

        <div className="elegant-login-copy">
          <span className="elegant-login-kicker">Secure access</span>
          <h1>Welcome back</h1>
          <p>Sign in with your approved iSchool account.</p>
        </div>

        <form className="elegant-login-form" onSubmit={handleSubmit}>
          <label>
            <span>Email address</span>
            <div className="elegant-input-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3zM3 7l9 6 9-6" /></svg>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@ischooltech.com" required />
            </div>
          </label>

          <label>
            <span>Password</span>
            <div className="elegant-input-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" /></svg>
              <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
            </div>
          </label>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <button className="elegant-login-button" type="submit" disabled={submitting}>
            <span>{submitting ? 'Signing in…' : 'Sign in to workspace'}</span>
            {!submitting && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>}
          </button>
        </form>

        <footer className="elegant-login-footer">
          <span className="elegant-status-dot" />
          Role-based access and audit history enabled
        </footer>
      </section>

      <p className="elegant-login-note">iSchool · B2B Offline Quality</p>
    </main>
  );
}
