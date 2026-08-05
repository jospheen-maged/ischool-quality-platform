import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from '../types';

type InviteForm = {
  fullName: string;
  email: string;
  role: Extract<UserRole, 'admin' | 'qtl' | 'qc'>;
};

type RoleFilter = 'all' | 'admin' | 'qtl' | 'qc' | 'tutor';

const emptyInvite: InviteForm = { fullName: '', email: '', role: 'qc' };

const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Management',
  qtl: 'Quality Team Lead',
  qc: 'Quality Control',
  tutor: 'Tutor',
};

function getInitials(name: string | null | undefined) {
  return (name || 'User')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function roleClass(role: UserRole) {
  if (role === 'super_admin' || role === 'admin') return 'people-role-management';
  if (role === 'qtl') return 'people-role-lead';
  if (role === 'qc') return 'people-role-qc';
  return 'people-role-tutor';
}

export function AccessPage() {
  const { profile: currentProfile } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invite, setInvite] = useState<InviteForm>(emptyInvite);
  const [showInvite, setShowInvite] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
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

  const filteredProfiles = useMemo(() => {
    const term = search.trim().toLowerCase();
    return profiles.filter((item) => {
      const matchesSearch = !term || [item.full_name, item.email, roleLabels[item.role]]
        .some((value) => value?.toLowerCase().includes(term));
      const matchesRole = roleFilter === 'all' || item.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [profiles, roleFilter, search]);

  const activeCount = profiles.filter((item) => item.is_active).length;
  const managementCount = profiles.filter((item) => ['super_admin', 'admin', 'qtl'].includes(item.role)).length;
  const qualityCount = profiles.filter((item) => item.role === 'qc').length;

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
    <div className="people-page">
      <header className="people-header">
        <div>
          <span className="people-kicker">Team administration</span>
          <h1>People & Access</h1>
          <p>Create team accounts, assign the right role, and keep workspace access under control.</p>
        </div>
        <button className="people-primary-button" type="button" onClick={() => setShowInvite((value) => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {showInvite ? 'Close form' : 'Add person'}
        </button>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="people-summary-grid" aria-label="Account summary">
        <article>
          <span className="people-summary-icon people-summary-blue"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87" /></svg></span>
          <div><small>Total people</small><strong>{profiles.length}</strong></div>
        </article>
        <article>
          <span className="people-summary-icon people-summary-green"><svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-6" /></svg></span>
          <div><small>Active accounts</small><strong>{activeCount}</strong></div>
        </article>
        <article>
          <span className="people-summary-icon people-summary-violet"><svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7zM9 12l2 2 4-5" /></svg></span>
          <div><small>Management & leads</small><strong>{managementCount}</strong></div>
        </article>
        <article>
          <span className="people-summary-icon people-summary-orange"><svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg></span>
          <div><small>Quality Control</small><strong>{qualityCount}</strong></div>
        </article>
      </section>

      {showInvite && (
        <form className="people-invite-card" onSubmit={inviteAccount}>
          <div className="people-form-heading">
            <div>
              <span className="people-kicker">New workspace account</span>
              <h2>Invite a team member</h2>
              <p>They will receive an email to set their password securely.</p>
            </div>
            <button className="people-icon-button" type="button" aria-label="Close form" onClick={() => { setInvite(emptyInvite); setShowInvite(false); }}>
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className="people-form-grid">
            <label>Full name<input value={invite.fullName} onChange={(event) => setInvite({ ...invite, fullName: event.target.value })} placeholder="Team member name" required /></label>
            <label>Email address<input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} placeholder="name@ischooltech.com" required /></label>
            <label>Access role<select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as InviteForm['role'] })}><option value="admin">Management</option><option value="qtl">Quality Team Lead</option><option value="qc">Quality Control</option></select></label>
          </div>
          <div className="people-form-actions">
            <button className="people-secondary-button" type="button" onClick={() => { setInvite(emptyInvite); setShowInvite(false); }}>Cancel</button>
            <button className="people-primary-button" type="submit" disabled={saving}>{saving ? 'Sending invitation…' : 'Send invitation'}</button>
          </div>
        </form>
      )}

      <section className="people-role-grid">
        <article className="people-role-card">
          <span className="people-role-icon people-role-icon-blue"><svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7zM9 12l2 2 4-5" /></svg></span>
          <div><strong>Management</strong><p>Full operational visibility across analytics, tutors, reviews, and objections.</p></div>
        </article>
        <article className="people-role-card">
          <span className="people-role-icon people-role-icon-orange"><svg viewBox="0 0 24 24"><path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5h6M9 12h6M9 16h4" /></svg></span>
          <div><strong>Quality Control</strong><p>Creates evaluations and works on relevant reviews and objections.</p></div>
        </article>
      </section>

      <section className="people-directory-card">
        <div className="people-directory-header">
          <div>
            <span className="people-kicker">Workspace directory</span>
            <h2>Team members</h2>
            <p>{filteredProfiles.length} of {profiles.length} people shown</p>
          </div>
          <div className="people-filters">
            <label className="people-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email or role" />
            </label>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)} aria-label="Filter by role">
              <option value="all">All roles</option>
              <option value="admin">Management</option>
              <option value="qtl">Quality Team Lead</option>
              <option value="qc">Quality Control</option>
              <option value="tutor">Tutor</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="people-empty-state">Loading people…</div>
        ) : filteredProfiles.length === 0 ? (
          <div className="people-empty-state"><strong>No people found</strong><span>Try changing the search or role filter.</span></div>
        ) : (
          <div className="people-table-wrap">
            <table className="people-table">
              <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Access</th></tr></thead>
              <tbody>
                {filteredProfiles.map((item) => {
                  const isSelf = item.id === currentProfile?.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="people-person-cell">
                          <span className={`people-avatar ${roleClass(item.role)}`}>{getInitials(item.full_name)}</span>
                          <div><strong>{item.full_name || 'Unnamed account'}</strong><small>{item.email || 'No email available'}</small></div>
                        </div>
                      </td>
                      <td>
                        {isSelf || item.role === 'super_admin' ? (
                          <span className={`people-role-pill ${roleClass(item.role)}`}>{roleLabels[item.role]}</span>
                        ) : (
                          <select className="people-table-select" value={item.role} onChange={(event) => void updateProfile(item.id, { role: event.target.value as UserRole })}>
                            <option value="admin">Management</option>
                            <option value="qtl">Quality Team Lead</option>
                            <option value="qc">Quality Control</option>
                            <option value="tutor">Tutor</option>
                          </select>
                        )}
                      </td>
                      <td><span className={`people-status ${item.is_active ? 'people-status-active' : 'people-status-inactive'}`}><i />{item.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td>{isSelf || item.role === 'super_admin' ? <span className="people-protected">Protected account</span> : <button className="people-table-action" type="button" onClick={() => void updateProfile(item.id, { is_active: !item.is_active })}>{item.is_active ? 'Deactivate' : 'Activate'}</button>}</td>
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
