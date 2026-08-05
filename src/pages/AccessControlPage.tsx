import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  getEffectivePermissions,
  permissionGroups,
  rolePermissionDefaults,
  type PermissionKey,
  type PermissionMap,
} from '../lib/permissions';
import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from '../types';
import '../access-control.css';

const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Management',
  qtl: 'Quality Team Lead',
  qc: 'Quality Control',
  tutor: 'Tutor',
};

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function roleTone(role: UserRole) {
  if (role === 'super_admin' || role === 'admin') return 'management';
  if (role === 'qtl') return 'lead';
  if (role === 'qc') return 'qc';
  return 'tutor';
}

function countEnabled(permissions: PermissionMap) {
  return Object.values(permissions).filter(Boolean).length;
}

export function AccessControlPage() {
  const { profile: currentProfile, refreshProfile } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PermissionMap | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadProfiles(preferredId?: string | null) {
    setLoading(true);
    setError('');
    const { data, error: queryError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, tutor_id, is_active, permissions')
      .order('full_name');

    if (queryError) {
      setError(queryError.message);
      setProfiles([]);
    } else {
      const nextProfiles = (data ?? []).map((item) => ({ ...item, permissions: item.permissions ?? {} })) as Profile[];
      setProfiles(nextProfiles);
      const desired = preferredId ?? selectedId ?? nextProfiles[0]?.id ?? null;
      const selected = nextProfiles.find((item) => item.id === desired) ?? nextProfiles[0] ?? null;
      setSelectedId(selected?.id ?? null);
      setDraft(selected ? getEffectivePermissions(selected) : null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadProfiles(currentProfile?.id);
  }, []);

  const filteredProfiles = useMemo(() => {
    const term = search.trim().toLowerCase();
    return profiles.filter((item) => {
      const matchesRole = roleFilter === 'all' || item.role === roleFilter;
      const matchesSearch = !term || [item.full_name, item.email, roleLabels[item.role]]
        .some((value) => value?.toLowerCase().includes(term));
      return matchesRole && matchesSearch;
    });
  }, [profiles, roleFilter, search]);

  const selectedProfile = useMemo(
    () => profiles.find((item) => item.id === selectedId) ?? null,
    [profiles, selectedId],
  );

  const overrideCount = useMemo(() => {
    if (!selectedProfile || !draft) return 0;
    const defaults = rolePermissionDefaults[selectedProfile.role];
    return (Object.keys(draft) as PermissionKey[]).filter((key) => draft[key] !== defaults[key]).length;
  }, [draft, selectedProfile]);

  function selectProfile(profile: Profile) {
    setSelectedId(profile.id);
    setDraft(getEffectivePermissions(profile));
    setError('');
    setNotice('');
  }

  function setPermission(key: PermissionKey, enabled: boolean) {
    if (!selectedProfile || !draft) return;
    if (selectedProfile.role === 'super_admin' && key === 'manage_access') return;
    setDraft({ ...draft, [key]: enabled });
    setNotice('');
  }

  function resetToRoleDefaults() {
    if (!selectedProfile) return;
    setDraft({ ...rolePermissionDefaults[selectedProfile.role] });
    setNotice('Role defaults restored locally. Save changes to apply them.');
  }

  async function savePermissions() {
    if (!selectedProfile || !draft) return;
    setSaving(true);
    setError('');
    setNotice('');

    const defaults = rolePermissionDefaults[selectedProfile.role];
    const overrides = Object.fromEntries(
      (Object.keys(draft) as PermissionKey[])
        .filter((key) => draft[key] !== defaults[key])
        .map((key) => [key, draft[key]]),
    );

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ permissions: overrides })
      .eq('id', selectedProfile.id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setProfiles((items) => items.map((item) => item.id === selectedProfile.id ? { ...item, permissions: overrides } : item));
      setNotice(`Access updated for ${selectedProfile.full_name}. Changes apply on their next page load.`);
      if (selectedProfile.id === currentProfile?.id) await refreshProfile();
    }
    setSaving(false);
  }

  const activeCount = profiles.filter((item) => item.is_active).length;
  const customCount = profiles.filter((item) => Object.keys(item.permissions ?? {}).length > 0).length;
  const publishCount = profiles.filter((item) => getEffectivePermissions(item).publish_reviews).length;

  return (
    <div className="access-control-page">
      <header className="access-control-header">
        <div>
          <span className="access-control-kicker">Workspace security</span>
          <h1>Access Control</h1>
          <p>Choose exactly which tabs and actions each person can use. Their role still controls which records they are allowed to see.</p>
        </div>
        <div className="access-control-security-note">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7zM9 12l2 2 4-5" /></svg>
          <div><strong>Super Admin only</strong><span>Permission changes are protected at database level.</span></div>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <section className="access-control-summary">
        <article><small>People</small><strong>{profiles.length}</strong><span>{activeCount} active accounts</span></article>
        <article><small>Custom access</small><strong>{customCount}</strong><span>People with overrides</span></article>
        <article><small>Can publish</small><strong>{publishCount}</strong><span>Including QC own reviews</span></article>
      </section>

      <section className="access-control-workspace">
        <aside className="access-people-panel">
          <div className="access-people-heading">
            <div><span className="access-control-kicker">People</span><h2>Select an account</h2></div>
            <span>{filteredProfiles.length}</span>
          </div>
          <div className="access-people-filters">
            <label className="access-search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" /></label>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)} aria-label="Filter accounts by role">
              <option value="all">All roles</option>
              <option value="super_admin">Super Admin</option>
              <option value="admin">Management</option>
              <option value="qtl">Quality Team Lead</option>
              <option value="qc">Quality Control</option>
              <option value="tutor">Tutor</option>
            </select>
          </div>

          <div className="access-people-list">
            {loading ? <div className="access-empty">Loading accounts…</div> : filteredProfiles.length === 0 ? <div className="access-empty">No matching accounts.</div> : filteredProfiles.map((item) => {
              const effective = getEffectivePermissions(item);
              const custom = Object.keys(item.permissions ?? {}).length;
              return (
                <button type="button" key={item.id} className={selectedId === item.id ? 'selected' : ''} onClick={() => selectProfile(item)}>
                  <span className={`access-avatar access-avatar-${roleTone(item.role)}`}>{initials(item.full_name)}</span>
                  <span className="access-person-copy"><strong>{item.full_name}</strong><small>{item.email || 'No email'} · {roleLabels[item.role]}</small></span>
                  <span className="access-person-meta"><strong>{countEnabled(effective)}</strong><small>{custom ? `${custom} custom` : 'default'}</small></span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="access-permissions-panel">
          {!selectedProfile || !draft ? <div className="access-empty large">Select a person to manage access.</div> : (
            <>
              <div className="access-selected-header">
                <div className="access-selected-person">
                  <span className={`access-avatar access-avatar-${roleTone(selectedProfile.role)}`}>{initials(selectedProfile.full_name)}</span>
                  <div><span className="access-control-kicker">Selected account</span><h2>{selectedProfile.full_name}</h2><p>{roleLabels[selectedProfile.role]} · {selectedProfile.email || 'No email'}</p></div>
                </div>
                <div className="access-selected-status">
                  <span className={overrideCount ? 'custom' : 'default'}>{overrideCount ? `${overrideCount} custom setting${overrideCount === 1 ? '' : 's'}` : 'Role defaults'}</span>
                  <button type="button" onClick={resetToRoleDefaults}>Reset to role defaults</button>
                </div>
              </div>

              <div className="access-permission-groups">
                {permissionGroups.map((group) => (
                  <section key={group.title} className="access-permission-group">
                    <div className="access-group-heading"><div><h3>{group.title}</h3><p>{group.description}</p></div></div>
                    <div className="access-toggle-grid">
                      {group.permissions.map((permission) => {
                        const locked = selectedProfile.role === 'super_admin' && permission.key === 'manage_access';
                        const enabled = draft[permission.key];
                        const differs = enabled !== rolePermissionDefaults[selectedProfile.role][permission.key];
                        return (
                          <label key={permission.key} className={`access-toggle-card ${enabled ? 'enabled' : ''} ${locked ? 'locked' : ''}`}>
                            <div><strong>{permission.label}</strong><p>{permission.description}</p>{differs && <small>Custom override</small>}</div>
                            <span className="access-switch"><input type="checkbox" checked={enabled} disabled={locked} onChange={(event) => setPermission(permission.key, event.target.checked)} /><i /></span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <div className="access-save-bar">
                <div><strong>{countEnabled(draft)} permissions enabled</strong><span>Changes affect tabs and actions after the user reloads the workspace.</span></div>
                <button type="button" disabled={saving} onClick={() => void savePermissions()}>{saving ? 'Saving access…' : 'Save access'}</button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
