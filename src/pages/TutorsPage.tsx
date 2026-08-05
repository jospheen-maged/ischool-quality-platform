import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type Lookup = { id: string; name: string };
type TutorRecord = {
  id: string;
  user_id: string | null;
  employee_code: string;
  full_name: string;
  email: string | null;
  team_id: string | null;
  branch_id: string | null;
  is_active: boolean;
  team: { name: string } | null;
  branch: { name: string } | null;
};

type TutorForm = {
  employeeCode: string;
  fullName: string;
  email: string;
  teamName: string;
  branchName: string;
  sendLoginInvite: boolean;
};

const emptyForm: TutorForm = {
  employeeCode: '',
  fullName: '',
  email: '',
  teamName: '',
  branchName: '',
  sendLoginInvite: false,
};

function tutorInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

export function TutorsPage() {
  const [tutors, setTutors] = useState<TutorRecord[]>([]);
  const [teams, setTeams] = useState<Lookup[]>([]);
  const [branches, setBranches] = useState<Lookup[]>([]);
  const [form, setForm] = useState<TutorForm>(emptyForm);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invitingTutorId, setInvitingTutorId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadData() {
    setLoading(true);
    setError('');
    const [tutorsResult, teamsResult, branchesResult] = await Promise.all([
      supabase
        .from('tutors')
        .select('id, user_id, employee_code, full_name, email, team_id, branch_id, is_active, team:teams(name), branch:branches(name)')
        .order('full_name'),
      supabase.from('teams').select('id, name').order('name'),
      supabase.from('branches').select('id, name').order('name'),
    ]);

    const firstError = tutorsResult.error || teamsResult.error || branchesResult.error;
    if (firstError) setError(firstError.message);
    else {
      setTutors((tutorsResult.data ?? []) as unknown as TutorRecord[]);
      setTeams((teamsResult.data ?? []) as Lookup[]);
      setBranches((branchesResult.data ?? []) as Lookup[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  const filteredTutors = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tutors;
    return tutors.filter((tutor) => [tutor.full_name, tutor.employee_code, tutor.email, tutor.team?.name, tutor.branch?.name]
      .some((value) => value?.toLowerCase().includes(term)));
  }, [search, tutors]);

  async function resolveLookup(table: 'teams' | 'branches', name: string, current: Lookup[]) {
    const cleanName = name.trim();
    if (!cleanName) return null;
    const existing = current.find((item) => item.name.toLowerCase() === cleanName.toLowerCase());
    if (existing) return existing.id;

    const { data, error: insertError } = await supabase.from(table).insert({ name: cleanName }).select('id, name').single();
    if (insertError) throw insertError;
    const created = data as Lookup;
    if (table === 'teams') setTeams((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name)));
    if (table === 'branches') setBranches((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created.id;
  }

  async function sendTutorInvitation(tutor: Pick<TutorRecord, 'id' | 'full_name' | 'email'>) {
    if (!tutor.email) throw new Error('Add an email address before sending login access.');

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
        fullName: tutor.full_name,
        email: tutor.email,
        role: 'tutor',
        tutorId: tutor.id,
      }),
    });

    const result = await response.json() as { message?: string; error?: string; userId?: string };
    if (!response.ok) throw new Error(result.error || 'Unable to send the tutor invitation.');
    return result;
  }

  async function inviteTutor(tutor: TutorRecord) {
    setInvitingTutorId(tutor.id);
    setError('');
    setSuccess('');
    try {
      const result = await sendTutorInvitation(tutor);
      setTutors((items) => items.map((item) => item.id === tutor.id ? { ...item, user_id: result.userId || item.user_id } : item));
      setSuccess(result.message || 'Tutor login invitation sent.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send the tutor invitation.');
    } finally {
      setInvitingTutorId(null);
    }
  }

  async function addTutor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      if (form.sendLoginInvite && !form.email.trim()) {
        throw new Error('Email is required when sending a login invitation.');
      }

      const teamId = await resolveLookup('teams', form.teamName, teams);
      const branchId = await resolveLookup('branches', form.branchName, branches);
      const { data: created, error: insertError } = await supabase.from('tutors').insert({
        employee_code: form.employeeCode.trim(),
        full_name: form.fullName.trim(),
        email: form.email.trim() || null,
        team_id: teamId,
        branch_id: branchId,
        is_active: true,
      }).select('id, full_name, email').single();
      if (insertError) throw insertError;

      let notice = 'Tutor added successfully and is now available in New Evaluation.';
      if (form.sendLoginInvite && created) {
        const inviteResult = await sendTutorInvitation({
          id: created.id,
          full_name: created.full_name,
          email: created.email,
        });
        notice = inviteResult.message || 'Tutor added and login invitation sent.';
      }

      setForm(emptyForm);
      setShowForm(false);
      setSuccess(notice);
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add tutor.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleTutor(tutor: TutorRecord) {
    setError('');
    setSuccess('');
    const { error: updateError } = await supabase.from('tutors').update({ is_active: !tutor.is_active }).eq('id', tutor.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setTutors((items) => items.map((item) => item.id === tutor.id ? { ...item, is_active: !item.is_active } : item));
    setSuccess(`${tutor.full_name} is now ${tutor.is_active ? 'inactive' : 'active'}.`);
  }

  const activeTutors = tutors.filter((tutor) => tutor.is_active).length;
  const linkedAccounts = tutors.filter((tutor) => tutor.user_id).length;

  return (
    <div className="people-page">
      <header className="people-header">
        <div>
          <span className="people-kicker">Tutor directory</span>
          <h1>Tutors</h1>
          <p>Add tutors, send login invitations, and manage who can access published reviews and submit objections.</p>
        </div>
        <button className="people-primary-button" type="button" onClick={() => setShowForm((value) => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {showForm ? 'Close form' : 'Add tutor'}
        </button>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="people-summary-grid" aria-label="Tutor summary">
        <article><span className="people-summary-icon people-summary-blue"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8" /></svg></span><div><small>Total tutors</small><strong>{tutors.length}</strong></div></article>
        <article><span className="people-summary-icon people-summary-green"><svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-4-9 3 3 5-6" /></svg></span><div><small>Active tutors</small><strong>{activeTutors}</strong></div></article>
        <article><span className="people-summary-icon people-summary-violet"><svg viewBox="0 0 24 24"><path d="M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z" /></svg></span><div><small>Login accounts</small><strong>{linkedAccounts}</strong></div></article>
        <article><span className="people-summary-icon people-summary-orange"><svg viewBox="0 0 24 24"><path d="M3 21V8l9-5 9 5v13M8 21v-6h8v6" /></svg></span><div><small>Schools / branches</small><strong>{branches.length}</strong></div></article>
      </section>

      {showForm && (
        <form className="people-invite-card" onSubmit={addTutor}>
          <div className="people-form-heading">
            <div><span className="people-kicker">New tutor record</span><h2>Add tutor details</h2><p>The tutor can receive login access immediately or later from the directory.</p></div>
            <button className="people-icon-button" type="button" aria-label="Close form" onClick={() => { setForm(emptyForm); setShowForm(false); }}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          </div>
          <div className="tutor-form-grid">
            <label>Employee / Tutor ID<input value={form.employeeCode} onChange={(event) => setForm({ ...form, employeeCode: event.target.value })} placeholder="T-17746" required /></label>
            <label>Full name<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="Tutor full name" required /></label>
            <label>Email address<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@ischooltech.com" /></label>
            <label>Team<input list="team-options" value={form.teamName} onChange={(event) => setForm({ ...form, teamName: event.target.value })} placeholder="B2B Offline" /></label>
            <label>School / Branch<input list="branch-options" value={form.branchName} onChange={(event) => setForm({ ...form, branchName: event.target.value })} placeholder="School or branch name" /></label>
          </div>
          <label className="tutor-login-checkbox">
            <input type="checkbox" checked={form.sendLoginInvite} onChange={(event) => setForm({ ...form, sendLoginInvite: event.target.checked })} />
            <span><strong>Send login invitation now</strong><small>The tutor will set a password, see published reviews only, and submit objections.</small></span>
          </label>
          <datalist id="team-options">{teams.map((team) => <option key={team.id} value={team.name} />)}</datalist>
          <datalist id="branch-options">{branches.map((branch) => <option key={branch.id} value={branch.name} />)}</datalist>
          <div className="people-form-actions"><button className="people-secondary-button" type="button" onClick={() => { setForm(emptyForm); setShowForm(false); }}>Cancel</button><button className="people-primary-button" type="submit" disabled={saving}>{saving ? 'Saving tutor…' : 'Add tutor'}</button></div>
        </form>
      )}

      <section className="people-directory-card">
        <div className="people-directory-header">
          <div><span className="people-kicker">Tutor records</span><h2>All tutors</h2><p>{filteredTutors.length} of {tutors.length} tutors shown</p></div>
          <div className="people-filters"><label className="people-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, ID, team or school" /></label></div>
        </div>

        {loading ? <div className="people-empty-state">Loading tutors…</div> : filteredTutors.length === 0 ? <div className="people-empty-state"><strong>No tutors found</strong><span>Add the first tutor or change the search.</span></div> : (
          <div className="people-table-wrap">
            <table className="people-table tutor-table tutor-access-table">
              <thead><tr><th>Tutor</th><th>ID</th><th>Team</th><th>School / Branch</th><th>Tutor status</th><th>Login access</th><th>Actions</th></tr></thead>
              <tbody>{filteredTutors.map((tutor) => (
                <tr key={tutor.id}>
                  <td><div className="people-person-cell"><span className="people-avatar people-role-tutor">{tutorInitials(tutor.full_name)}</span><div><strong>{tutor.full_name}</strong><small>{tutor.email || 'No email added'}</small></div></div></td>
                  <td><span className="tutor-code">{tutor.employee_code}</span></td>
                  <td>{tutor.team?.name || '—'}</td>
                  <td>{tutor.branch?.name || '—'}</td>
                  <td><span className={`people-status ${tutor.is_active ? 'people-status-active' : 'people-status-inactive'}`}><i />{tutor.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>{tutor.user_id ? <span className="tutor-login-status is-linked"><i />Login linked</span> : <span className="tutor-login-status"><i />Not invited</span>}</td>
                  <td><div className="tutor-row-actions">{!tutor.user_id && <button className="people-table-action tutor-invite-action" type="button" disabled={invitingTutorId === tutor.id || !tutor.is_active} onClick={() => void inviteTutor(tutor)}>{invitingTutorId === tutor.id ? 'Sending…' : 'Invite login'}</button>}<button className="people-table-action" type="button" onClick={() => void toggleTutor(tutor)}>{tutor.is_active ? 'Deactivate' : 'Activate'}</button></div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
