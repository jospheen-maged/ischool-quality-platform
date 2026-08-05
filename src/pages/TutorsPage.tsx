import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type Lookup = { id: string; name: string };
type TutorRecord = {
  id: string;
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
};

const emptyForm: TutorForm = { employeeCode: '', fullName: '', email: '', teamName: '', branchName: '' };

export function TutorsPage() {
  const [tutors, setTutors] = useState<TutorRecord[]>([]);
  const [teams, setTeams] = useState<Lookup[]>([]);
  const [branches, setBranches] = useState<Lookup[]>([]);
  const [form, setForm] = useState<TutorForm>(emptyForm);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadData() {
    setLoading(true);
    setError('');
    const [tutorsResult, teamsResult, branchesResult] = await Promise.all([
      supabase
        .from('tutors')
        .select('id, employee_code, full_name, email, team_id, branch_id, is_active, team:teams(name), branch:branches(name)')
        .order('full_name'),
      supabase.from('teams').select('id, name').order('name'),
      supabase.from('branches').select('id, name').order('name'),
    ]);

    const firstError = tutorsResult.error || teamsResult.error || branchesResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
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

    const { data, error: insertError } = await supabase
      .from(table)
      .insert({ name: cleanName })
      .select('id, name')
      .single();
    if (insertError) throw insertError;
    const created = data as Lookup;
    if (table === 'teams') setTeams((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name)));
    if (table === 'branches') setBranches((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created.id;
  }

  async function addTutor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const teamId = await resolveLookup('teams', form.teamName, teams);
      const branchId = await resolveLookup('branches', form.branchName, branches);
      const { error: insertError } = await supabase.from('tutors').insert({
        employee_code: form.employeeCode.trim(),
        full_name: form.fullName.trim(),
        email: form.email.trim() || null,
        team_id: teamId,
        branch_id: branchId,
        is_active: true,
      });
      if (insertError) throw insertError;
      setForm(emptyForm);
      setShowForm(false);
      setSuccess('Tutor added successfully and is now available in New Evaluation.');
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add tutor.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleTutor(tutor: TutorRecord) {
    setError('');
    const { error: updateError } = await supabase
      .from('tutors')
      .update({ is_active: !tutor.is_active })
      .eq('id', tutor.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setTutors((items) => items.map((item) => item.id === tutor.id ? { ...item, is_active: !item.is_active } : item));
  }

  return (
    <div className="page-stack admin-page elegant-directory-page">
      <header className="admin-page-header elegant-directory-header">
        <div>
          <span className="elegant-page-kicker">Tutor directory</span>
          <h1>Tutors</h1>
          <p>Add tutors, teams, and school branches directly from the workspace. Active tutors appear automatically in New Evaluation.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setShowForm((value) => !value)}>
          {showForm ? 'Close' : 'Add tutor'}
        </button>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {showForm && (
        <form className="panel admin-form-card elegant-form-card" onSubmit={addTutor}>
          <div className="admin-form-heading">
            <div><span className="elegant-page-kicker">New tutor</span><h2>Add tutor details</h2></div>
            <span>New team and school names are created automatically.</span>
          </div>
          <div className="admin-form-grid">
            <label>Employee / Tutor ID<input value={form.employeeCode} onChange={(event) => setForm({ ...form, employeeCode: event.target.value })} placeholder="T-17746" required /></label>
            <label>Full name<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="Tutor full name" required /></label>
            <label>Email address<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@ischooltech.com" /></label>
            <label>Team<input list="team-options" value={form.teamName} onChange={(event) => setForm({ ...form, teamName: event.target.value })} placeholder="B2B Offline" /></label>
            <label>School / Branch<input list="branch-options" value={form.branchName} onChange={(event) => setForm({ ...form, branchName: event.target.value })} placeholder="School or branch name" /></label>
          </div>
          <datalist id="team-options">{teams.map((team) => <option key={team.id} value={team.name} />)}</datalist>
          <datalist id="branch-options">{branches.map((branch) => <option key={branch.id} value={branch.name} />)}</datalist>
          <div className="admin-form-actions">
            <button className="button elegant-secondary-button" type="button" onClick={() => { setForm(emptyForm); setShowForm(false); }}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Adding tutor…' : 'Add tutor'}</button>
          </div>
        </form>
      )}

      <section className="panel directory-panel elegant-directory-panel">
        <div className="directory-toolbar">
          <div><strong>{tutors.length}</strong><span>Total tutors</span></div>
          <div><strong>{tutors.filter((tutor) => tutor.is_active).length}</strong><span>Active</span></div>
          <label className="directory-search"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, ID, team or school" /></label>
        </div>

        {loading ? (
          <div className="empty-state">Loading tutors…</div>
        ) : filteredTutors.length === 0 ? (
          <div className="empty-state"><strong>No tutors found</strong><p>Add the first tutor or change the search term.</p></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Tutor</th><th>ID</th><th>Team</th><th>School / Branch</th><th>Status</th><th /></tr></thead>
              <tbody>
                {filteredTutors.map((tutor) => (
                  <tr key={tutor.id}>
                    <td><strong>{tutor.full_name}</strong><small>{tutor.email || 'No email added'}</small></td>
                    <td>{tutor.employee_code}</td>
                    <td>{tutor.team?.name || '—'}</td>
                    <td>{tutor.branch?.name || '—'}</td>
                    <td><span className={`account-status ${tutor.is_active ? 'is-active' : 'is-inactive'}`}>{tutor.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td><button className="table-action" type="button" onClick={() => void toggleTutor(tutor)}>{tutor.is_active ? 'Deactivate' : 'Activate'}</button></td>
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
