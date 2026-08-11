import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../project-evaluation-audit.css';

type TutorOption = { id: string; employee_code: string; full_name: string };
type OrgOption = { id: string; name: string };
type CycleOption = { id: string; name: string; start_date: string; end_date: string; is_default: boolean; status: string };
type AuditMetric = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  weight_percentage: number;
  anchor_1: string | null;
  anchor_3: string | null;
  anchor_5: string | null;
  sort_order: number;
};
type MetricAnswer = { score?: number; evidence: string };
type RecentAudit = {
  id: string;
  student_name: string | null;
  project_name: string | null;
  tutor_score: number | null;
  audit_score: number | null;
  verdict: string | null;
  status: string;
  created_at: string;
  tutor: { full_name: string; employee_code: string } | null;
  org: { name: string } | null;
  cycle: { name: string } | null;
};

const emptyMeta = {
  tutorId: '',
  orgId: '',
  cycleId: '',
  studentName: '',
  studentId: '',
  projectName: '',
  projectReference: '',
  tutorScore: '',
  tutorFeedback: '',
  evaluationReference: '',
};

function verdictLabel(value: string | null) {
  if (!value) return '—';
  if (value === 'accurate') return 'Accurate';
  if (value === 'mostly_accurate') return 'Mostly Accurate';
  if (value === 'needs_calibration') return 'Needs Calibration';
  return 'Unreliable';
}

export function ProjectEvaluationAuditPage() {
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [metrics, setMetrics] = useState<AuditMetric[]>([]);
  const [answers, setAnswers] = useState<Record<string, MetricAnswer>>({});
  const [meta, setMeta] = useState(emptyMeta);
  const [recentAudits, setRecentAudits] = useState<RecentAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadPage() {
    setLoading(true);
    setError('');
    const [tutorsResult, orgsResult, cyclesResult, metricsResult, auditsResult] = await Promise.all([
      supabase.from('tutors').select('id, employee_code, full_name').eq('is_active', true).order('full_name'),
      supabase.from('projects').select('id, name').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('evaluation_cycles').select('id, name, start_date, end_date, is_default, status').order('start_date', { ascending: false }),
      supabase
        .from('project_evaluation_metrics')
        .select('id, code, title, description, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order')
        .eq('scope', 'normal_session')
        .eq('is_active', true)
        .order('sort_order'),
      supabase
        .from('project_evaluation_audits')
        .select('id, student_name, project_name, tutor_score, audit_score, verdict, status, created_at, tutor:tutors(full_name, employee_code), org:projects(name), cycle:evaluation_cycles(name)')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const firstError = tutorsResult.error || orgsResult.error || cyclesResult.error || metricsResult.error || auditsResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      const loadedCycles = (cyclesResult.data ?? []) as CycleOption[];
      setTutors((tutorsResult.data ?? []) as TutorOption[]);
      setOrgs((orgsResult.data ?? []) as OrgOption[]);
      setCycles(loadedCycles);
      setMetrics((metricsResult.data ?? []) as AuditMetric[]);
      setRecentAudits((auditsResult.data ?? []) as unknown as RecentAudit[]);
      const defaultCycle = loadedCycles.find((cycle) => cycle.is_default) ?? loadedCycles.find((cycle) => cycle.status === 'active');
      if (defaultCycle) setMeta((current) => ({ ...current, cycleId: current.cycleId || defaultCycle.id }));
    }
    setLoading(false);
  }

  useEffect(() => { void loadPage(); }, []);

  const completedMetrics = metrics.filter((metric) => Boolean(answers[metric.id]?.score));
  const auditScore = useMemo(() => {
    if (!metrics.length || completedMetrics.length !== metrics.length) return null;
    const totalWeight = metrics.reduce((sum, metric) => sum + Number(metric.weight_percentage), 0);
    if (!totalWeight) return null;
    const weighted = metrics.reduce((sum, metric) => {
      const score = answers[metric.id]?.score ?? 0;
      return sum + (score / 5) * Number(metric.weight_percentage);
    }, 0);
    return Math.round((weighted / totalWeight) * 100);
  }, [answers, completedMetrics.length, metrics]);

  const verdict = auditScore === null
    ? null
    : auditScore >= 90
      ? 'accurate'
      : auditScore >= 75
        ? 'mostly_accurate'
        : auditScore >= 60
          ? 'needs_calibration'
          : 'unreliable';

  function updateAnswer(metricId: string, patch: Partial<MetricAnswer>) {
    setAnswers((current) => ({
      ...current,
      [metricId]: { score: current[metricId]?.score, evidence: current[metricId]?.evidence ?? '', ...patch },
    }));
  }

  function resetForm() {
    const defaultCycle = cycles.find((cycle) => cycle.is_default) ?? cycles.find((cycle) => cycle.status === 'active');
    setMeta({ ...emptyMeta, cycleId: defaultCycle?.id ?? '' });
    setAnswers({});
  }

  async function saveAudit(finalize: boolean) {
    setError('');
    setSuccess('');

    if (!meta.tutorId) {
      setError('Tutor is required.');
      return;
    }

    if (finalize) {
      if (!meta.projectName.trim()) {
        setError('Project / assignment name is required before completing the audit.');
        return;
      }
      if (completedMetrics.length !== metrics.length || auditScore === null || !verdict) {
        setError('Score every Project Evaluation metric before completing the audit.');
        return;
      }
      const missingEvidence = metrics.find((metric) => !answers[metric.id]?.evidence.trim());
      if (missingEvidence) {
        setError(`Add evidence for ${missingEvidence.title}.`);
        return;
      }
    }

    const tutorScore = meta.tutorScore === '' ? null : Number(meta.tutorScore);
    if (tutorScore !== null && (Number.isNaN(tutorScore) || tutorScore < 0 || tutorScore > 100)) {
      setError('Tutor score must be between 0 and 100.');
      return;
    }

    setSaving(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError ?? new Error('No authenticated user.');

      const { data: audit, error: auditError } = await supabase
        .from('project_evaluation_audits')
        .insert({
          tutor_id: meta.tutorId,
          evaluator_id: userData.user.id,
          org_id: meta.orgId || null,
          cycle_id: meta.cycleId || null,
          student_name: meta.studentName.trim() || null,
          student_id: meta.studentId.trim() || null,
          project_name: meta.projectName.trim() || null,
          project_reference: meta.projectReference.trim() || null,
          tutor_score: tutorScore,
          tutor_feedback: meta.tutorFeedback.trim() || null,
          evaluation_reference: meta.evaluationReference.trim() || null,
          audit_score: auditScore,
          verdict,
          status: finalize ? 'completed' : 'draft',
          completed_at: finalize ? new Date().toISOString() : null,
        })
        .select('id')
        .single();
      if (auditError) throw auditError;

      const rows = metrics
        .filter((metric) => answers[metric.id]?.score)
        .map((metric) => ({
          audit_id: audit.id,
          metric_id: metric.id,
          numeric_score: answers[metric.id]?.score,
          evidence: answers[metric.id]?.evidence.trim() || null,
          weight_snapshot: Number(metric.weight_percentage),
        }));

      if (rows.length) {
        const { error: scoresError } = await supabase.from('project_evaluation_audit_scores').insert(rows);
        if (scoresError) throw scoresError;
      }

      setSuccess(finalize ? 'Project Evaluation Audit completed.' : 'Project Evaluation Audit saved as draft.');
      resetForm();
      await loadPage();
    } catch (caught) {
      const message = caught && typeof caught === 'object' && 'message' in caught
        ? String((caught as { message: unknown }).message)
        : 'Unable to save the Project Evaluation Audit.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="screen-center">Loading Project Evaluation Audit…</div>;

  return (
    <div className="page-stack project-evaluation-audit-page">
      <header className="page-header project-evaluation-audit-header">
        <div>
          <p className="eyebrow">Standalone quality audit</p>
          <h1>Project Evaluation Audit</h1>
          <p>Audit the Tutor's project evaluation independently. No session observation is required.</p>
        </div>
        <div className="project-evaluation-score-card">
          <small>Tutor Evaluation Quality</small>
          <strong>{auditScore === null ? '—' : `${auditScore}%`}</strong>
          <span>{verdict ? verdictLabel(verdict) : `${completedMetrics.length}/${metrics.length} metrics scored`}</span>
        </div>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">1 · Evaluation context</p><h2>Project & Tutor evaluation</h2><p>Use the student project and the Tutor's submitted evaluation as evidence.</p></div></div>
        <div className="form-grid project-audit-context-grid">
          <label>Tutor *<select value={meta.tutorId} onChange={(event) => setMeta({ ...meta, tutorId: event.target.value })}><option value="">Select tutor</option>{tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.employee_code} — {tutor.full_name}</option>)}</select></label>
          <label>Org.<select value={meta.orgId} onChange={(event) => setMeta({ ...meta, orgId: event.target.value })}><option value="">No Org.</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          <label>Evaluation cycle<select value={meta.cycleId} onChange={(event) => setMeta({ ...meta, cycleId: event.target.value })}><option value="">No cycle</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
          <label>Project / assignment name<input value={meta.projectName} onChange={(event) => setMeta({ ...meta, projectName: event.target.value })} /></label>
          <label>Student name<input value={meta.studentName} onChange={(event) => setMeta({ ...meta, studentName: event.target.value })} /></label>
          <label>Student ID<input value={meta.studentId} onChange={(event) => setMeta({ ...meta, studentId: event.target.value })} /></label>
          <label>Student project / evidence link<input value={meta.projectReference} onChange={(event) => setMeta({ ...meta, projectReference: event.target.value })} placeholder="Link or reference" /></label>
          <label>Tutor score %<input type="number" min="0" max="100" step="0.01" value={meta.tutorScore} onChange={(event) => setMeta({ ...meta, tutorScore: event.target.value })} /></label>
          <label className="full-width">Tutor feedback<textarea rows={3} value={meta.tutorFeedback} onChange={(event) => setMeta({ ...meta, tutorFeedback: event.target.value })} /></label>
          <label className="full-width">Tutor evaluation reference<textarea rows={2} value={meta.evaluationReference} onChange={(event) => setMeta({ ...meta, evaluationReference: event.target.value })} placeholder="Evaluation link, screenshot reference, notes, or source." /></label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading project-audit-heading"><div><p className="eyebrow">2 · Tutor Evaluation Audit</p><h2>Evaluation quality metrics</h2><p>Rate the Tutor's evaluation—not the student's coding style.</p></div><span className="section-progress">{completedMetrics.length}/{metrics.length} scored</span></div>
        <div className="project-audit-metrics">
          {metrics.map((metric) => {
            const answer = answers[metric.id] ?? { evidence: '' };
            return (
              <article className="project-audit-metric" key={metric.id}>
                <div className="project-audit-metric-copy">
                  <div><span className="criterion-code">{metric.code}</span><strong>{metric.title}</strong></div>
                  <span className="project-audit-weight">{metric.weight_percentage}%</span>
                  {metric.description && <p>{metric.description}</p>}
                </div>
                <fieldset className="rating-control project-audit-rating">
                  <legend>Score</legend>
                  {[1, 2, 3, 4, 5].map((score) => <label key={score} className={answer.score === score ? 'selected' : ''}><input type="radio" name={`project-audit-${metric.id}`} checked={answer.score === score} onChange={() => updateAnswer(metric.id, { score })} /><span>{score}</span></label>)}
                </fieldset>
                <details className="rating-guide project-audit-guide"><summary>Rating guide</summary><div className="rating-guide-grid"><div><strong>1 · Not Demonstrated</strong><p>{metric.anchor_1}</p></div><div><strong>3 · Partially Demonstrated</strong><p>{metric.anchor_3}</p></div><div><strong>5 · Fully Demonstrated</strong><p>{metric.anchor_5}</p></div></div></details>
                <label className="project-audit-evidence">Audit evidence<textarea rows={2} value={answer.evidence} onChange={(event) => updateAnswer(metric.id, { evidence: event.target.value })} placeholder="What in the project / Tutor evaluation supports this score?" /></label>
              </article>
            );
          })}
          {metrics.length === 0 && <div className="empty-state">No active Project Evaluation metrics are configured in Model Settings.</div>}
        </div>
      </section>

      <section className="project-audit-result-strip">
        <div><small>Audit score</small><strong>{auditScore === null ? '—' : `${auditScore}%`}</strong></div>
        <div><small>Verdict</small><strong>{verdictLabel(verdict)}</strong></div>
        <div><small>Tutor score</small><strong>{meta.tutorScore === '' ? '—' : `${meta.tutorScore}%`}</strong></div>
      </section>

      <div className="form-actions project-audit-actions">
        <button className="button button-secondary" type="button" disabled={saving} onClick={() => void saveAudit(false)}>{saving ? 'Saving…' : 'Save draft'}</button>
        <button className="button button-primary" type="button" disabled={saving} onClick={() => void saveAudit(true)}>{saving ? 'Saving…' : 'Complete audit'}</button>
      </div>

      <section className="panel table-panel project-audit-history">
        <div className="panel-heading"><div><p className="eyebrow">Recent audits</p><h2>Project Evaluation Audit history</h2></div></div>
        {recentAudits.length === 0 ? <div className="empty-state">No standalone Project Evaluation audits yet.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Tutor</th><th>Student / Project</th><th>Org / Cycle</th><th>Tutor score</th><th>Audit score</th><th>Verdict</th><th>Status</th></tr></thead><tbody>{recentAudits.map((audit) => <tr key={audit.id}><td><strong>{audit.tutor?.employee_code ?? '—'}</strong><span className="table-subtext">{audit.tutor?.full_name ?? 'Unknown tutor'}</span></td><td><strong>{audit.project_name || 'Project not named'}</strong><span className="table-subtext">{audit.student_name || 'Student not entered'}</span></td><td>{audit.org?.name || '—'}<span className="table-subtext">{audit.cycle?.name || 'No cycle'}</span></td><td>{audit.tutor_score === null ? '—' : `${audit.tutor_score}%`}</td><td><strong>{audit.audit_score === null ? '—' : `${audit.audit_score}%`}</strong></td><td>{verdictLabel(audit.verdict)}</td><td><span className={`status-badge status-${audit.status}`}>{audit.status}</span></td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
