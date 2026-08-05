import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from '../types';

type InviteForm = {
  fullName: string;
  email: string;
  role: Extract<UserRole, 'admin' | 'qtl' | 'qc'>;
};

const emptyInvite: InviteForm = { fullName: '', email: '', role: 'qc' };

const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Management',
  qtl: 'Quality Team Lead',
  qc: 'Quality Control',
  tutor: 'Tutor',
};

export function AccessPage() {
  const { profile: currentProfile } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invite, setInvite] = useState<InviteForm>(emptyInvite);
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadProfiles() {
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, tutor_id, is_active')
      .order('full_name');
    if (loadError) setError(loadError.message);
    else setProfiles((data ?? []) as Profile[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadProfiles();
  }, []);

  async function inviteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session?.access_token) throw new Error('Your session expired. Please sign in again.');

      const response = await fetch('/api/invite-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          fullName: invite.fullName.trim(),
          email: invite.email.trim().toLowerCase(),
          role: invite.role,
        }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Unable to create the account.');

      setInvite(emptyInvite);
      setShowInvite(false);
      setSuccess(result.message || 'Invitation sent successfully.');
      await loadProfiles();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create the account.');
    } finally {
      setSaving(false);
    }
  }

  async function updateProfile(id: string, changes: Partial<Pick<Profile, 'role' | 'is_active'>>) {
    setError('');
    setSuccess('');
    const { error: updateError } = await supabase.from('profiles').update(changes).eq('id', id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setProfiles((items) => items.map((item) => item.id === id ? { ...item, ...changes } : item));
    setSuccess('Account access updated.');
  }

  return (
    <div className="page-stack admin-page">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">Security and permissions</p>
          <h1>Accounts & Access</h1>
          <p>Create Management and QC accounts, then control what each person can see and do.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setShowInvite((value) => !value)}>
          {showInvite ? 'Close form' : '+ Create account'}
        </button>
      </header>

      <section className="access-role-grid">
        <article><span className="role-mark role-management">M</span><div><strong>Management</strong><p>Sees all reviews, objections, analytics, tutor records, and can manage operational data.</p></div></article>
        <article><span className="role-mark role-qc">QC</span><div><strong>Quality Control</strong><p>Creates evaluations, sees assigned reviews, and handles available or assigned objections.</p></div></article>
      </section>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {showInvite && (
        <form className="panel admin-form-card" onSubmit={inviteAccount}>
          <div className="admin-form-heading">
            <div><p className="eyebrow">New account</p><h2>Invite a team member</h2></div>
            <span>They will receive an email to set their password securely.</span>
          </div>
          <div className="admin-form-grid admin-form-grid-three">
            <label>Full name<input value={invite.fullName} onChange={(event) => setInvite({ ...invite, fullName: event.target.value })} placeholder="Team member name" required /></label>
            <label>Email address<input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} placeholder="name@ischooltech.com" required /></label>
            <label>Access role<select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as InviteForm['role'] })}><option value="admin">Management</option><option value="qtl">Quality Team Lead</option><option value="qc">Quality Control</option></select></label>
          </div>
          <div className="admin-form-actions">
            <button className="button button-secondary" type="button" onClick={() => { setInvite(emptyInvite); setShowInvite(false); }}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Sending invitation…' : 'Send invitation'}</button>
          </div>
        </form>
      )}

      <section className="panel directory-panel">
        <div className="directory-toolbar">
          <div><strong>{profiles.length}</strong><span>Total accounts</span></div>
          <div><strong>{profiles.filter((item) => item.is_active).length}</strong><span>Active accounts</span></div>
        </div>

        {loading ? (
          <div className="empty-state">Loading accounts…</div>
        ) : profiles.length === 0 ? (
          <div className="empty-state"><strong>No accounts found</strong></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Team member</th><th>Role</th><th>Status</th><th>Access</th></tr></thead>
              <tbody>
                {profiles.map((item) => {
                  const isSelf = item.id === currentProfile?.id;
                  return (
                    <tr key={item.id}>
                      <td><strong>{item.full_name || 'Unnamed account'}</strong><small>{item.email || 'No email available'}</small></td>
                      <td>
                        {isSelf || item.role === 'super_admin' ? (
                          <span className="role-pill">{roleLabels[item.role]}</span>
                        ) : (
                          <select className="table-select" value={item.role} onChange={(event) => void updateProfile(item.id, { role: event.target.value as UserRole })}>
                            <option value="admin">Management</option>
                            <option value="qtl">Quality Team Lead</option>
                            <option value="qc">Quality Control</option>
                            <option value="tutor">Tutor</option>
                          </select>
                        )}
                      </td>
                      <td><span className={`account-status ${item.is_active ? 'is-active' : 'is-inactive'}`}>{item.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td>{isSelf || item.role === 'super_admin' ? <span className="muted">Protected</span> : <button className="table-action" type="button" onClick={() => void updateProfile(item.id, { is_active: !item.is_active })}>{item.is_active ? 'Deactivate' : 'Activate'}</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
