import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import type { EvaluationCriterion } from '../types';

type ModelSettings = {
  id: boolean;
  teaching_weight: number;
  compliance_weight: number;
  project_weight: number;
};

type EditableCriterion = EvaluationCriterion & {
  is_active: boolean;
  section: { title: string } | null;
};

type Section = { id: string; title: string };
type Project = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

const defaultSettings: ModelSettings = {
  id: true,
  teaching_weight: 70,
  compliance_weight: 20,
  project_weight: 10,
};

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createCode(prefix: string) {
  return `${prefix}-${Date.now().toString().slice(-7)}`;
}

export function ModelSettingsPage() {
  const [settings, setSettings] = useState<ModelSettings>(defaultSettings);
  const [criteria, setCriteria] = useState<EditableCriterion[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProject, setNewProject] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadSettings() {
    setLoading(true);
    setError('');
    const [settingsResult, criteriaResult, sectionsResult, projectsResult] = await Promise.all([
      supabase.from('quality_model_settings').select('id, teaching_weight, compliance_weight, project_weight').eq('id', true).single(),
      supabase
        .from('evaluation_criteria')
        .select('id, section_id, code, title, description, max_score, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order, criterion_type, is_active, section:evaluation_sections(title)')
        .order('sort_order'),
      supabase.from('evaluation_sections').select('id, title').order('sort_order'),
      supabase.from('projects').select('id, name, description, sort_order, is_active').order('sort_order').order('name'),
    ]);

    const firstError = settingsResult.error || criteriaResult.error || sectionsResult.error || projectsResult.error;
    if (firstError) setError(firstError.message);
    else {
      setSettings(settingsResult.data as ModelSettings);
      setCriteria((criteriaResult.data ?? []) as unknown as EditableCriterion[]);
      setSections((sectionsResult.data ?? []) as Section[]);
      setProjects((projectsResult.data ?? []) as Project[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  const teachingCriteria = useMemo(
    () => criteria.filter((criterion) => criterion.criterion_type === 'rating'),
    [criteria],
  );
  const complianceCriteria = useMemo(
    () => criteria.filter((criterion) => criterion.criterion_type === 'compliance'),
    [criteria],
  );
  const activeTeachingWeight = teachingCriteria
    .filter((criterion) => criterion.is_active)
    .reduce((sum, criterion) => sum + Number(criterion.weight_percentage), 0);
  const totalCategoryWeight = Number(settings.teaching_weight) + Number(settings.compliance_weight) + Number(settings.project_weight);

  function updateCriterion(id: string, patch: Partial<EditableCriterion>) {
    setCriteria((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function saveAll() {
    setError('');
    setSuccess('');

    if (Math.abs(totalCategoryWeight - 100) > 0.001) {
      setError(`Teaching, Compliance, and Project must total 100%. Current total: ${totalCategoryWeight}%.`);
      return;
    }
    if (Math.abs(activeTeachingWeight - Number(settings.teaching_weight)) > 0.001) {
      setError(`Active teaching metrics must total ${settings.teaching_weight}%. Current total: ${activeTeachingWeight}%.`);
      return;
    }
    if (criteria.some((criterion) => !criterion.title.trim())) {
      setError('Every active or inactive criterion must have a title.');
      return;
    }

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: settingsError } = await supabase
        .from('quality_model_settings')
        .update({
          teaching_weight: settings.teaching_weight,
          compliance_weight: settings.compliance_weight,
          project_weight: settings.project_weight,
          updated_by: userData.user?.id ?? null,
        })
        .eq('id', true);
      if (settingsError) throw settingsError;

      for (const criterion of criteria) {
        const { error: criterionError } = await supabase
          .from('evaluation_criteria')
          .update({
            title: criterion.title.trim(),
            description: criterion.description?.trim() || null,
            weight_percentage: criterion.criterion_type === 'rating' ? Number(criterion.weight_percentage) : 0,
            anchor_1: criterion.criterion_type === 'rating' ? criterion.anchor_1?.trim() || null : null,
            anchor_3: criterion.criterion_type === 'rating' ? criterion.anchor_3?.trim() || null : null,
            anchor_5: criterion.criterion_type === 'rating' ? criterion.anchor_5?.trim() || null : null,
            sort_order: criterion.sort_order,
            is_active: criterion.is_active,
          })
          .eq('id', criterion.id);
        if (criterionError) throw criterionError;
      }

      for (const project of projects) {
        const { error: projectError } = await supabase
          .from('projects')
          .update({
            name: project.name.trim(),
            description: project.description?.trim() || null,
            sort_order: project.sort_order,
            is_active: project.is_active,
          })
          .eq('id', project.id);
        if (projectError) throw projectError;
      }

      setSuccess('Evaluation model saved. New evaluations will use these settings.');
      await loadSettings();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save model settings.');
    } finally {
      setSaving(false);
    }
  }

  async function addCriterion(type: 'rating' | 'compliance') {
    setError('');
    setSuccess('');
    const section = sections.find((item) => type === 'rating'
      ? item.title.toLowerCase().includes('teaching')
      : item.title.toLowerCase().includes('compliance'));
    if (!section) {
      setError(`The ${type} section could not be found.`);
      return;
    }

    const sameType = criteria.filter((criterion) => criterion.criterion_type === type);
    const { error: insertError } = await supabase.from('evaluation_criteria').insert({
      section_id: section.id,
      code: createCode(type === 'rating' ? 'TQ' : 'COMP'),
      title: type === 'rating' ? 'New teaching metric' : 'New compliance item',
      description: null,
      criterion_type: type,
      max_score: type === 'rating' ? 5 : 0,
      weight_percentage: 0,
      anchor_1: null,
      anchor_3: null,
      anchor_5: null,
      sort_order: Math.max(0, ...sameType.map((item) => item.sort_order)) + 1,
      is_active: true,
    });
    if (insertError) setError(insertError.message);
    else await loadSettings();
  }

  async function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!newProject.name.trim()) return;

    const { error: insertError } = await supabase.from('projects').insert({
      name: newProject.name.trim(),
      description: newProject.description.trim() || null,
      sort_order: Math.max(0, ...projects.map((item) => item.sort_order)) + 1,
      is_active: true,
    });
    if (insertError) setError(insertError.message);
    else {
      setNewProject({ name: '', description: '' });
      setSuccess('Project added.');
      await loadSettings();
    }
  }

  if (loading) return <div className="screen-center">Loading model settings…</div>;

  return (
    <div className="page-stack model-settings-page">
      <header className="page-header model-settings-header">
        <div>
          <p className="eyebrow">Management workspace</p>
          <h1>Evaluation Model Settings</h1>
          <p>Change category weights, teaching metrics, compliance items, and the project list without editing code.</p>
        </div>
        <button className="button button-primary" type="button" disabled={saving} onClick={() => void saveAll()}>
          {saving ? 'Saving…' : 'Save all changes'}
        </button>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="panel form-section">
        <div className="panel-heading">
          <div><p className="eyebrow">Overall score</p><h2>Category weights</h2></div>
          <span className={`model-total-chip ${Math.abs(totalCategoryWeight - 100) < 0.001 ? 'valid' : 'invalid'}`}>{totalCategoryWeight}% total</span>
        </div>
        <div className="model-weight-grid">
          <label><span>Teaching metrics</span><input type="number" min="0" max="100" step="0.5" value={settings.teaching_weight} onChange={(event) => setSettings({ ...settings, teaching_weight: numberValue(event.target.value) })} /><small>Active teaching metric weights must match this total.</small></label>
          <label><span>Compliance</span><input type="number" min="0" max="100" step="0.5" value={settings.compliance_weight} onChange={(event) => setSettings({ ...settings, compliance_weight: numberValue(event.target.value) })} /><small>Shared equally across assessed compliance items.</small></label>
          <label><span>Project</span><input type="number" min="0" max="100" step="0.5" value={settings.project_weight} onChange={(event) => setSettings({ ...settings, project_weight: numberValue(event.target.value) })} /><small>Applied only when a project score is added.</small></label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading model-settings-section-heading">
          <div><p className="eyebrow">Teaching · {activeTeachingWeight}% of {settings.teaching_weight}%</p><h2>Teaching metrics</h2><p>Edit names, descriptions, anchors, and contribution weights.</p></div>
          <button className="button button-secondary" type="button" onClick={() => void addCriterion('rating')}>Add metric</button>
        </div>
        <div className="model-editor-list">
          {teachingCriteria.map((criterion, index) => (
            <article className={`model-editor-card ${criterion.is_active ? '' : 'inactive'}`} key={criterion.id}>
              <div className="model-editor-topline">
                <span className="criterion-code">{criterion.code}</span>
                <label className="model-active-toggle"><input type="checkbox" checked={criterion.is_active} onChange={(event) => updateCriterion(criterion.id, { is_active: event.target.checked })} />Active</label>
              </div>
              <div className="model-editor-grid">
                <label className="model-title-field">Metric title<input value={criterion.title} onChange={(event) => updateCriterion(criterion.id, { title: event.target.value })} /></label>
                <label>Weight %<input type="number" min="0" max="100" step="0.5" value={criterion.weight_percentage} onChange={(event) => updateCriterion(criterion.id, { weight_percentage: numberValue(event.target.value) })} /></label>
                <label>Order<input type="number" min="1" value={criterion.sort_order || index + 1} onChange={(event) => updateCriterion(criterion.id, { sort_order: numberValue(event.target.value) })} /></label>
                <label className="full-width">Description<input value={criterion.description ?? ''} onChange={(event) => updateCriterion(criterion.id, { description: event.target.value })} /></label>
                <label>Anchor 1<textarea rows={2} value={criterion.anchor_1 ?? ''} onChange={(event) => updateCriterion(criterion.id, { anchor_1: event.target.value })} /></label>
                <label>Anchor 3<textarea rows={2} value={criterion.anchor_3 ?? ''} onChange={(event) => updateCriterion(criterion.id, { anchor_3: event.target.value })} /></label>
                <label>Anchor 5<textarea rows={2} value={criterion.anchor_5 ?? ''} onChange={(event) => updateCriterion(criterion.id, { anchor_5: event.target.value })} /></label>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading model-settings-section-heading">
          <div><p className="eyebrow">Compliance · {settings.compliance_weight}%</p><h2>Compliance items</h2><p>Active items share the compliance weight equally in each new evaluation.</p></div>
          <button className="button button-secondary" type="button" onClick={() => void addCriterion('compliance')}>Add item</button>
        </div>
        <div className="model-simple-list">
          {complianceCriteria.map((criterion, index) => (
            <article className={criterion.is_active ? '' : 'inactive'} key={criterion.id}>
              <span className="criterion-code">{criterion.code}</span>
              <label>Item title<input value={criterion.title} onChange={(event) => updateCriterion(criterion.id, { title: event.target.value })} /></label>
              <label>Description<input value={criterion.description ?? ''} onChange={(event) => updateCriterion(criterion.id, { description: event.target.value })} /></label>
              <label>Order<input type="number" min="1" value={criterion.sort_order || index + 1} onChange={(event) => updateCriterion(criterion.id, { sort_order: numberValue(event.target.value) })} /></label>
              <label className="model-active-toggle"><input type="checkbox" checked={criterion.is_active} onChange={(event) => updateCriterion(criterion.id, { is_active: event.target.checked })} />Active</label>
            </article>
          ))}
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Project directory · {settings.project_weight}%</p><h2>Projects</h2><p>QCs select from this list during an evaluation.</p></div></div>
        <form className="model-project-add" onSubmit={addProject}>
          <label>Project name<input value={newProject.name} onChange={(event) => setNewProject({ ...newProject, name: event.target.value })} placeholder="e.g. Conditional Statement Project" required /></label>
          <label>Description<input value={newProject.description} onChange={(event) => setNewProject({ ...newProject, description: event.target.value })} placeholder="Optional guidance" /></label>
          <button className="button button-primary" type="submit">Add project</button>
        </form>
        <div className="model-simple-list model-project-list">
          {projects.length === 0 && <div className="empty-state">No projects added yet.</div>}
          {projects.map((project, index) => (
            <article className={project.is_active ? '' : 'inactive'} key={project.id}>
              <span className="model-project-number">{String(index + 1).padStart(2, '0')}</span>
              <label>Project name<input value={project.name} onChange={(event) => setProjects((items) => items.map((item) => item.id === project.id ? { ...item, name: event.target.value } : item))} /></label>
              <label>Description<input value={project.description ?? ''} onChange={(event) => setProjects((items) => items.map((item) => item.id === project.id ? { ...item, description: event.target.value } : item))} /></label>
              <label>Order<input type="number" min="1" value={project.sort_order || index + 1} onChange={(event) => setProjects((items) => items.map((item) => item.id === project.id ? { ...item, sort_order: numberValue(event.target.value) } : item))} /></label>
              <label className="model-active-toggle"><input type="checkbox" checked={project.is_active} onChange={(event) => setProjects((items) => items.map((item) => item.id === project.id ? { ...item, is_active: event.target.checked } : item))} />Active</label>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
