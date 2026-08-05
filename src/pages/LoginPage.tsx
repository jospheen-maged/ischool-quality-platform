import { useEffect, useState, type FormEvent } from 'react';
import ischoolLogo from '../assets/ischool-logo-official.svg';
import { useAuth } from '../auth/AuthProvider';
import { useRouter } from '../lib/router';

const features = [
  ['Evidence-led reviews', 'Capture only what was directly observed.'],
  ['Clear role access', 'Management and QC see the tools relevant to them.'],
  ['Actionable outcomes', 'Turn every review into one focused next step.'],
];

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
    <main className="login-page">
      <div className="login-glow login-glow-one" />
      <div className="login-glow login-glow-two" />

      <section className="login-frame">
        <aside className="login-brand-panel">
          <div className="login-brand-row">
            <div className="login-logo-wrap"><img src={ischoolLogo} alt="iSchool" /></div>
            <div>
              <span className="login-product-label">B2B Offline</span>
              <strong>Quality Workspace</strong>
            </div>
          </div>

          <div className="login-brand-copy">
            <span className="login-kicker">Quality evaluation, made practical</span>
            <h1>See the evidence.<br />Make the next action clear.</h1>
            <p>A focused workspace for tutor reviews, objections, analytics, and follow-up.</p>
          </div>

          <div className="login-feature-list">
            {features.map(([title, description], index) => (
              <div className="login-feature" key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{title}</strong><small>{description}</small></div>
              </div>
            ))}
          </div>
        </aside>

        <section className="login-form-panel">
          <form className="login-card" onSubmit={handleSubmit}>
            <div className="login-card-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" /></svg>
            </div>
            <div className="login-card-heading">
              <span>Secure workspace</span>
              <h2>Welcome back</h2>
              <p>Sign in with your approved iSchool account.</p>
            </div>

            <label className="login-field">
              <span>Email address</span>
              <div>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3zM3 7l9 6 9-6" /></svg>
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@ischooltech.com" required />
              </div>
            </label>

            <label className="login-field">
              <span>Password</span>
              <div>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" /></svg>
                <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
              </div>
            </label>

            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <button className="login-button" type="submit" disabled={submitting}>
              <span>{submitting ? 'Signing in…' : 'Sign in'}</span>
              {!submitting && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>}
            </button>

            <div className="login-trust-note"><span /> Role-based access and audit history are enabled.</div>
          </form>
        </section>
      </section>
    </main>
  );
}
