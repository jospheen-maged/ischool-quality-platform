import { useEffect, useState, type FormEvent } from 'react';
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
        <div className="brand-mark brand-mark-large">iS</div>
        <p className="eyebrow">iSchool Quality</p>
        <h1>Clear evaluations. Fair decisions. Better learning.</h1>
        <p>One secure workspace for session reviews, compliance flags, tutor objections, and quality analytics.</p>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Welcome back</p>
            <h2>Sign in to your workspace</h2>
          </div>

          <label>
            Email address
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>

          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
}
