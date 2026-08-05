import { useEffect, useState, type FormEvent } from 'react';
import ischoolLogo from '../assets/ischool-logo-official.svg';
import { useRouter } from '../lib/router';
import { supabase } from '../lib/supabase';

export function SetPasswordPage() {
  const { navigate } = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function prepareInvitation() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          window.history.replaceState(null, '', '/set-password');
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session) throw new Error('This invitation link is invalid or has expired. Ask the administrator to send a new invitation.');
        if (mounted) setReady(true);
      } catch (caught) {
        if (mounted) setError(caught instanceof Error ? caught.message : 'Unable to open the invitation.');
      } finally {
        if (mounted) setChecking(false);
      }
    }

    void prepareInvitation();
    return () => { mounted = false; };
  }, []);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must contain at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    navigate('/reviews', { replace: true });
  }

  return (
    <main className="password-setup-page">
      <section className="password-setup-card">
        <div className="password-setup-brand">
          <img src={ischoolLogo} alt="iSchool" />
          <div><strong>B2B Offline</strong><span>Tutor quality portal</span></div>
        </div>

        <div className="password-setup-copy">
          <span className="people-kicker">Account setup</span>
          <h1>Create your password</h1>
          <p>Use this password to access your published reviews and submit objections.</p>
        </div>

        {checking ? <div className="password-setup-loading">Checking your invitation…</div> : !ready ? (
          <div className="alert alert-error">{error || 'The invitation could not be opened.'}</div>
        ) : (
          <form className="password-setup-form" onSubmit={savePassword}>
            <label>New password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" required /></label>
            <label>Confirm password<input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter it again" required /></label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="people-primary-button" type="submit" disabled={saving}>{saving ? 'Saving password…' : 'Create password and continue'}</button>
          </form>
        )}

        <p className="password-setup-note">Your account only shows information permitted for your assigned role.</p>
      </section>
    </main>
  );
}
