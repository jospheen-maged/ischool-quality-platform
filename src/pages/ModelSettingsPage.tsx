import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import type { EvaluationCriterion } from '../types';
import '../evaluation-model-v2.css';

type ModelSettings = {
  id: boolean;
  teaching_weight: number;
  compliance_weight: number;
  project_weight: number;
  final_teaching_weight: number;
  final_compliance_weight: number;
  final_project_weight: number;
};
type EditableCriterion = EvaluationCriterion & { is_active: boolean; section: { title: string } | null };
type Section = { id: string; title: string };
type Org = { id: string; name: string; description: string | null; sort_order: number; is_active: boolean };
type Cycle = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'active' | 'closed';
  is_default: boolean;
  sort_order: number;
};
type ProjectMetric = {
  id: string;
  scope: 'normal_session' | 'session_12';
  code: string;
  title: string;
  description: string | null;
  weight_percentage: number;
  anchor_1: string | null;
  anchor_3: string | null;
  anchor_5: string | null;
  sort_order: number;
  is_active: boolean;
};

const defaultSettings: ModelSettings = {
  id: true,
  teaching_weight: 70,
  compliance_weight: 20,
  project_weight: 10,
  final_teaching_weight: 60,
  final_compliance_weight: 20,
  final_project_weight: 20,
};

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function createCode(prefix: string) {
  return `${prefix}-${Date.now().toString().slice(-7)}`;
}

function sumActive(items: Array<{ is_active: boolean; weight_percentage: number }>) {
  return items.filter((item) => item.is_active).reduce((sum, item) => sum + Number(item.weight_percentage), 0);
}

export function ModelSettingsPage() {
  const [settings, setSettings] = useState<ModelSettings>(defaultSettings);
  const [criteria, setCriteria] = useState<EditableCriterion[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [projectMetrics, setProjectMetrics] = useState<ProjectMetric[]>([]);
  const [newOrg, setNewOrg] = useState({ name: '', description: '' });
  const [newCycle, setNewCycle] = useState({ name: '', start_date: '', end_date: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadSettings() {
    setLoading(true);
    setError('');
    const [settingsResult, criteriaResult, sectionsResult, orgsResult, cyclesResult, projectMetricsResult] = await Promise.all([
      supabase
        .from('quality_model_settings')
        .select('id, teaching_weight, compliance_weight, project_weight, final_teaching_weight, final_compliance_weight, final_project_weight')
        .eq('id', true)
        .single(),
      supabase
        .from('evaluation_criteria')
        .select('id, section_id, code, title, description, max_score, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order, criterion_type, is_active, section:evaluation_sections(title)')
        .order('sort_order'),
      supabase.from('evaluation_sections').select('id, title').order('sort_order'),
      supabase.from('projects').select('id, name, description, sort_order, is_active').order('sort_order').order('name'),
      supabase.from('evaluation_cycles').select('id, name, start_date, end_date, status, is_default, sort_order').order('start_date', { ascending: false }),
      supabase
        .from('project_evaluation_metrics')
        .select('id, scope, code, title, description, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order, is_active')
        .order('scope')
        .order('sort_order'),
    ]);

    const firstError = settingsResult.error
      || criteriaResult.error
      || sectionsResult.error
      || orgsResult.error
      || cyclesResult.error
      || projectMetricsResult.error;
    if (firstError) setError(firstError.message);
    else {
      setSettings(settingsResult.data as ModelSettings);
      setCriteria((criteriaResult.data ?? []) as unknown as EditableCriterion[]);
      setSections((sectionsResult.data ?? []) as Section[]);
      setOrgs((orgsResult.data ?? []) as Org[]);
      setCycles((cyclesResult.data ?? []) as Cycle[]);
      setProjectMetrics((projectMetricsResult.data ?? []) as ProjectMetric[]);
    }
    setLoading(false);
  }

  useEffect(() => { void loadSettings(); }, []);

  const teachingCriteria = useMemo(() => criteria.filter((criterion) => criterion.criterion_type === 'rating'), [criteria]);
  const complianceCriteria = useMemo(() => criteria.filter((criterion) => criterion.criterion_type === 'compliance'), [criteria]);
  const normalProjectMetrics = useMemo(() => projectMetrics.filter((metric) => metric.scope === 'normal_session'), [projectMetrics]);
  const finalProjectMetrics = useMemo(() => projectMetrics.filter((metric) => metric.scope === 'session_12'), [projectMetrics]);
  const activeTeachingWeight = sumActive(teachingCriteria);
  const activeNormalProjectWeight = sumActive(normalProjectMetrics);
  const activeFinalProjectWeight = sumActive(finalProjectMetrics);
  const normalTotal = Number(settings.teaching_weight) + Number(settings.compliance_weight) + Number(settings.project_weight);
  const finalTotal = Number(settings.final_teaching_weight) + Number(settings.final_compliance_weight) + Number(settings.final_project_weight);

  function updateCriterion(id: string, patch: Partial<EditableCriterion>) {
    setCriteria((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updateProjectMetric(id: string, patch: Partial<ProjectMetric>) {
    setProjectMetrics((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updateOrg(id: string, patch: Partial<Org>) {
    setOrgs((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updateCycle(id: string, patch: Partial<Cycle>) {
    setCycles((items) => items.map((item) => {
      if (patch.is_default && item.id !== id) return { ...item, is_default: false };
      return item.id === id ? { ...item, ...patch } : item;
    }));
  }

  async function saveAll() {
    setError('');
    setSuccess('');

    if (Math.abs(normalTotal - 100) > 0.001) return setError(`Normal Session weights must total 100%. Current total: ${normalTotal}%.`);
    if (Math.abs(finalTotal - 100) > 0.001) return setError(`Session 12 weights must total 100%. Current total: ${finalTotal}%.`);
    if (Math.abs(activeTeachingWeight - Number(settings.teaching_weight)) > 0.001) return setError(`Active Teaching metrics must total ${settings.teaching_weight}%. Current total: ${activeTeachingWeight}%.`);
    if (Math.abs(activeNormalProjectWeight - 100) > 0.001) return setError(`Active Normal Session project-evaluation metrics must total 100%. Current total: ${activeNormalProjectWeight}%.`);
    if (Math.abs(activeFinalProjectWeight - 100) > 0.001) return setError(`Active Session 12 final-project metrics must total 100%. Current total: ${activeFinalProjectWeight}%.`);
    if (criteria.some((criterion) => !criterion.title.trim()) || projectMetrics.some((metric) => !metric.title.trim())) return setError('Every metric must have a title.');
    if (cycles.some((cycle) => !cycle.name.trim() || !cycle.start_date || !cycle.end_date || cycle.end_date < cycle.start_date)) return setError('Every cycle needs a valid name, start date, and end date.');

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error: settingsError } = await supabase
        .from('quality_model_settings')
        .update({ ...settings, updated_by: userData.user?.id ?? null })
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

      for (const metric of projectMetrics) {
        const { error: metricError } = await supabase
          .from('project_evaluation_metrics')
          .update({
            title: metric.title.trim(),
            description: metric.description?.trim() || null,
            weight_percentage: Number(metric.weight_percentage),
            anchor_1: metric.anchor_1?.trim() || null,
            anchor_3: metric.anchor_3?.trim() || null,
            anchor_5: metric.anchor_5?.trim() || null,
            sort_order: metric.sort_order,
            is_active: metric.is_active,
          })
          .eq('id', metric.id);
        if (metricError) throw metricError;
      }

      for (const org of orgs) {
        const { error: orgError } = await supabase
          .from('projects')
          .update({ name: org.name.trim(), description: org.description?.trim() || null, sort_order: org.sort_order, is_active: org.is_active })
          .eq('id', org.id);
        if (orgError) throw orgError;
      }

      for (const cycle of cycles) {
        const { error: cycleError } = await supabase
          .from('evaluation_cycles')
          .update({
            name: cycle.name.trim(),
            start_date: cycle.start_date,
            end_date: cycle.end_date,
            status: cycle.status,
            is_default: cycle.is_default,
            sort_order: cycle.sort_order,
          })
          .eq('id', cycle.id);
        if (cycleError) throw cycleError;
      }

      setSuccess('Evaluation model saved. New reviews will use the selected session type, cycle, and Section 3 model.');
      await loadSettings();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save model settings.');
    } finally {
      setSaving(false);
    }
  }

  async function addCriterion(type: 'rating' | 'compliance') {
    setError('');
    const section = sections.find((item) => type === 'rating' ? item.title.toLowerCase().includes('teaching') : item.title.toLowerCase().includes('compliance'));
    if (!section) return setError(`The ${type} section could not be found.`);
    const sameType = criteria.filter((criterion) => criterion.criterion_type === type);
    const { error: insertError } = await supabase.from('evaluation_criteria').insert({
      section_id: section.id,
      code: createCode(type === 'rating' ? 'TQ' : 'COMP'),
      title: type === 'rating' ? 'New teaching metric' : 'New compliance item',
      criterion_type: type,
      max_score: type === 'rating' ? 5 : 0,
      weight_percentage: 0,
      sort_order: Math.max(0, ...sameType.map((item) => item.sort_order)) + 1,
      is_active: true,
    });
    if (insertError) setError(insertError.message); else await loadSettings();
  }

  async function addProjectMetric(scope: 'normal_session' | 'session_12') {
    const sameScope = projectMetrics.filter((metric) => metric.scope === scope);
    const { error: insertError } = await supabase.from('project_evaluation_metrics').insert({
      scope,
      code: createCode(scope === 'normal_session' ? 'PEQ' : 'FP'),
      title: scope === 'normal_session' ? 'New project-evaluation metric' : 'New final-project metric',
      weight_percentage: 0,
      sort_order: Math.max(0, ...sameScope.map((item) => item.sort_order)) + 1,
      is_active: true,
    });
    if (insertError) setError(insertError.message); else await loadSettings();
  }

  async function addOrg(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newOrg.name.trim()) return;
    const { error: insertError } = await supabase.from('projects').insert({
      name: newOrg.name.trim(),
      description: newOrg.description.trim() || null,
      sort_order: Math.max(0, ...orgs.map((item) => item.sort_order)) + 1,
      is_active: true,
    });
    if (insertError) setError(insertError.message);
    else { setNewOrg({ name: '', description: '' }); setSuccess('Org. added.'); await loadSettings(); }
  }

  async function addCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newCycle.name.trim() || !newCycle.start_date || !newCycle.end_date) return;
    const { error: insertError } = await supabase.from('evaluation_cycles').insert({
      ...newCycle,
      status: 'active',
      is_default: cycles.length === 0,
      sort_order: Math.max(0, ...cycles.map((item) => item.sort_order)) + 1,
    });
    if (insertError) setError(insertError.message);
    else { setNewCycle({ name: '', start_date: '', end_date: '' }); setSuccess('Evaluation cycle added.'); await loadSettings(); }
  }

  function renderProjectMetricEditor(title: string, subtitle: string, scope: 'normal_session' | 'session_12', items: ProjectMetric[]) {
    const total = sumActive(items);
    return (
      <section className="panel form-section">
        <div className="panel-heading model-settings-section-heading">
          <div><p className="eyebrow">Section 3 internal mix · {total}%</p><h2>{title}</h2><p>{subtitle}</p></div>
          <button className="button button-secondary" type="button" onClick={() => void addProjectMetric(scope)}>Add metric</button>
        </div>
        <div className="model-editor-list">
          {items.map((metric, index) => (
            <article className={`model-editor-card ${metric.is_active ? '' : 'inactive'}`} key={metric.id}>
              <div className="model-editor-topline"><span className="criterion-code">{metric.code}</span><label className="model-active-toggle"><input type="checkbox" checked={metric.is_active} onChange={(event) => updateProjectMetric(metric.id, { is_active: event.target.checked })} />Active</label></div>
              <div className="model-editor-grid">
                <label className="model-title-field">Metric title<input value={metric.title} onChange={(event) => updateProjectMetric(metric.id, { title: event.target.value })} /></label>
                <label>Internal weight %<input type="number" min="0" max="100" step="0.5" value={metric.weight_percentage} onChange={(event) => updateProjectMetric(metric.id, { weight_percentage: numberValue(event.target.value) })} /></label>
                <label>Order<input type="number" min="1" value={metric.sort_order || index + 1} onChange={(event) => updateProjectMetric(metric.id, { sort_order: numberValue(event.target.value) })} /></label>
                <label className="full-width">Description<input value={metric.description ?? ''} onChange={(event) => updateProjectMetric(metric.id, { description: event.target.value })} /></label>
                <label>Anchor 1<textarea rows={2} value={metric.anchor_1 ?? ''} onChange={(event) => updateProjectMetric(metric.id, { anchor_1: event.target.value })} /></label>
                <label>Anchor 3<textarea rows={2} value={metric.anchor_3 ?? ''} onChange={(event) => updateProjectMetric(metric.id, { anchor_3: event.target.value })} /></label>
                <label>Anchor 5<textarea rows={2} value={metric.anchor_5 ?? ''} onChange={(event) => updateProjectMetric(metric.id, { anchor_5: event.target.value })} /></label>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (loading) return <div className="screen-center">Loading model settings…</div>;

  return (
    <div className="page-stack model-settings-page model-settings-v2">
      <header className="page-header model-settings-header">
        <div><p className="eyebrow">Management workspace</p><h1>Evaluation Model Settings</h1><p>Manage session models, Teaching, Section 3, Compliance, Orgs., and named evaluation cycles.</p></div>
        <button className="button button-primary" type="button" disabled={saving} onClick={() => void saveAll()}>{saving ? 'Saving…' : 'Save all changes'}</button>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">Score models</p><h2>Weights by evaluation type</h2><p>Teaching metrics use the same rubric, but Session 12 scales Teaching to 60%.</p></div></div>
        <div className="session-weight-models">
          <article><div className="session-model-heading"><strong>Normal Session</strong><span className={Math.abs(normalTotal - 100) < 0.001 ? 'valid' : 'invalid'}>{normalTotal}%</span></div><div className="model-weight-grid"><label><span>Teaching</span><input type="number" value={settings.teaching_weight} onChange={(event) => setSettings({ ...settings, teaching_weight: numberValue(event.target.value) })} /></label><label><span>Project Evaluation</span><input type="number" value={settings.project_weight} onChange={(event) => setSettings({ ...settings, project_weight: numberValue(event.target.value) })} /></label><label><span>Compliance</span><input type="number" value={settings.compliance_weight} onChange={(event) => setSettings({ ...settings, compliance_weight: numberValue(event.target.value) })} /></label></div></article>
          <article><div className="session-model-heading"><strong>Session 12 – Final Project</strong><span className={Math.abs(finalTotal - 100) < 0.001 ? 'valid' : 'invalid'}>{finalTotal}%</span></div><div className="model-weight-grid"><label><span>Teaching</span><input type="number" value={settings.final_teaching_weight} onChange={(event) => setSettings({ ...settings, final_teaching_weight: numberValue(event.target.value) })} /></label><label><span>Final Project</span><input type="number" value={settings.final_project_weight} onChange={(event) => setSettings({ ...settings, final_project_weight: numberValue(event.target.value) })} /></label><label><span>Compliance</span><input type="number" value={settings.final_compliance_weight} onChange={(event) => setSettings({ ...settings, final_compliance_weight: numberValue(event.target.value) })} /></label></div></article>
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading model-settings-section-heading"><div><p className="eyebrow">Teaching · {activeTeachingWeight}% of {settings.teaching_weight}%</p><h2>Teaching metrics</h2><p>Session 12 uses the same metrics scaled proportionally to its Teaching weight.</p></div><button className="button button-secondary" type="button" onClick={() => void addCriterion('rating')}>Add metric</button></div>
        <div className="model-editor-list">{teachingCriteria.map((criterion, index) => <article className={`model-editor-card ${criterion.is_active ? '' : 'inactive'}`} key={criterion.id}><div className="model-editor-topline"><span className="criterion-code">{criterion.code}</span><label className="model-active-toggle"><input type="checkbox" checked={criterion.is_active} onChange={(event) => updateCriterion(criterion.id, { is_active: event.target.checked })} />Active</label></div><div className="model-editor-grid"><label className="model-title-field">Metric title<input value={criterion.title} onChange={(event) => updateCriterion(criterion.id, { title: event.target.value })} /></label><label>Weight %<input type="number" value={criterion.weight_percentage} onChange={(event) => updateCriterion(criterion.id, { weight_percentage: numberValue(event.target.value) })} /></label><label>Order<input type="number" value={criterion.sort_order || index + 1} onChange={(event) => updateCriterion(criterion.id, { sort_order: numberValue(event.target.value) })} /></label><label className="full-width">Description<input value={criterion.description ?? ''} onChange={(event) => updateCriterion(criterion.id, { description: event.target.value })} /></label><label>Anchor 1<textarea rows={2} value={criterion.anchor_1 ?? ''} onChange={(event) => updateCriterion(criterion.id, { anchor_1: event.target.value })} /></label><label>Anchor 3<textarea rows={2} value={criterion.anchor_3 ?? ''} onChange={(event) => updateCriterion(criterion.id, { anchor_3: event.target.value })} /></label><label>Anchor 5<textarea rows={2} value={criterion.anchor_5 ?? ''} onChange={(event) => updateCriterion(criterion.id, { anchor_5: event.target.value })} /></label></div></article>)}</div>
      </section>

      {renderProjectMetricEditor('Normal Session · Project Evaluation Quality', 'Audit the fairness, evidence, clarity, next step, and recognition of student ownership in the tutor evaluation.', 'normal_session', normalProjectMetrics)}
      {renderProjectMetricEditor('Session 12 · Final Project Evaluation', 'Evaluate the student final outcome, technical quality, ownership, showcase, and tutor final evaluation.', 'session_12', finalProjectMetrics)}

      <section className="panel form-section"><div className="panel-heading model-settings-section-heading"><div><p className="eyebrow">Compliance · {settings.compliance_weight}% / {settings.final_compliance_weight}%</p><h2>Compliance items</h2><p>Active items share the selected model Compliance weight equally.</p></div><button className="button button-secondary" type="button" onClick={() => void addCriterion('compliance')}>Add item</button></div><div className="model-simple-list">{complianceCriteria.map((criterion, index) => <article className={criterion.is_active ? '' : 'inactive'} key={criterion.id}><span className="criterion-code">{criterion.code}</span><label>Item title<input value={criterion.title} onChange={(event) => updateCriterion(criterion.id, { title: event.target.value })} /></label><label>Description<input value={criterion.description ?? ''} onChange={(event) => updateCriterion(criterion.id, { description: event.target.value })} /></label><label>Order<input type="number" value={criterion.sort_order || index + 1} onChange={(event) => updateCriterion(criterion.id, { sort_order: numberValue(event.target.value) })} /></label><label className="model-active-toggle"><input type="checkbox" checked={criterion.is_active} onChange={(event) => updateCriterion(criterion.id, { is_active: event.target.checked })} />Active</label></article>)}</div></section>

      <section className="panel form-section"><div className="panel-heading"><div><p className="eyebrow">Org. directory</p><h2>Organizations</h2><p>QCs select the Org. during an evaluation. This replaces the old Project directory label.</p></div></div><form className="model-project-add" onSubmit={addOrg}><label>Org. name<input value={newOrg.name} onChange={(event) => setNewOrg({ ...newOrg, name: event.target.value })} required /></label><label>Description<input value={newOrg.description} onChange={(event) => setNewOrg({ ...newOrg, description: event.target.value })} /></label><button className="button button-primary" type="submit">Add Org.</button></form><div className="model-simple-list model-project-list">{orgs.map((org, index) => <article className={org.is_active ? '' : 'inactive'} key={org.id}><span className="model-project-number">{String(index + 1).padStart(2, '0')}</span><label>Org. name<input value={org.name} onChange={(event) => updateOrg(org.id, { name: event.target.value })} /></label><label>Description<input value={org.description ?? ''} onChange={(event) => updateOrg(org.id, { description: event.target.value })} /></label><label>Order<input type="number" value={org.sort_order || index + 1} onChange={(event) => updateOrg(org.id, { sort_order: numberValue(event.target.value) })} /></label><label className="model-active-toggle"><input type="checkbox" checked={org.is_active} onChange={(event) => updateOrg(org.id, { is_active: event.target.checked })} />Active</label></article>)}</div></section>

      <section className="panel form-section"><div className="panel-heading"><div><p className="eyebrow">Analytics periods</p><h2>Evaluation Cycles</h2><p>Reviews are linked to a named cycle. Session date automatically selects the matching cycle.</p></div></div><form className="cycle-add-form" onSubmit={addCycle}><label>Cycle name<input value={newCycle.name} onChange={(event) => setNewCycle({ ...newCycle, name: event.target.value })} placeholder="August Cycle" required /></label><label>Start date<input type="date" value={newCycle.start_date} onChange={(event) => setNewCycle({ ...newCycle, start_date: event.target.value })} required /></label><label>End date<input type="date" value={newCycle.end_date} onChange={(event) => setNewCycle({ ...newCycle, end_date: event.target.value })} required /></label><button className="button button-primary" type="submit">Add cycle</button></form><div className="cycle-editor-list">{cycles.map((cycle, index) => <article key={cycle.id} className={cycle.status === 'closed' ? 'inactive' : ''}><label>Cycle name<input value={cycle.name} onChange={(event) => updateCycle(cycle.id, { name: event.target.value })} /></label><label>Start<input type="date" value={cycle.start_date} onChange={(event) => updateCycle(cycle.id, { start_date: event.target.value })} /></label><label>End<input type="date" value={cycle.end_date} onChange={(event) => updateCycle(cycle.id, { end_date: event.target.value })} /></label><label>Status<select value={cycle.status} onChange={(event) => updateCycle(cycle.id, { status: event.target.value as Cycle['status'] })}><option value="active">Active</option><option value="closed">Closed</option></select></label><label>Order<input type="number" value={cycle.sort_order || index + 1} onChange={(event) => updateCycle(cycle.id, { sort_order: numberValue(event.target.value) })} /></label><label className="model-active-toggle"><input type="radio" name="default-cycle" checked={cycle.is_default} onChange={() => updateCycle(cycle.id, { is_default: true })} />Default cycle</label></article>)}</div></section>
    </div>
  );
}
