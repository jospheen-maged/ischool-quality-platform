import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import '../final-project-audit.css';

type TutorOption = { id: string; employee_code: string; full_name: string };
type OrgOption = { id: string; name: string };
type CycleOption = { id: string; name: string; start_date: string; end_date: string; is_default: boolean; status: string };
type ChecklistCategory = 'required_features' | 'expected_functionality' | 'submission_completeness';
type ItemResult = 'done' | 'partial' | 'missing' | 'not_applicable';
type VersionStatus = 'confirmed' | 'unable_to_confirm' | 'incorrect_tutor_version';
type RequirementCoverage = '' | 'full' | 'partial' | 'insufficient';
type FeedbackAccuracy = '' | 'accurate' | 'partially_accurate' | 'inaccurate' | 'no_feedback';

type ChecklistItem = {
  localId: string;
  category: ChecklistCategory;
  requirement: string;
  result: ItemResult;
  notes: string;
};

type RecentAudit = {
  id: string;
  student_name: string;
  project_name: string;
  tutor_score: number | null;
  qc_project_score: number | null;
  score_variance: number | null;
  evaluation_audit_score: number | null;
  evaluation_verdict: string | null;
  status: string;
  created_at: string;
  tutor: { full_name: string; employee_code: string } | null;
  org: { name: string } | null;
  cycle: { name: string } | null;
};

const categoryConfig: Array<{ key: ChecklistCategory; title: string; weight: number; hint: string }> = [
  {
    key: 'required_features',
    title: 'Required Features Completion',
    weight: 50,
    hint: 'List the exact required features from the project brief. Do not judge coding style.',
  },
  {
    key: 'expected_functionality',
    title: 'Expected Functionality',
    weight: 30,
    hint: 'List only testable expected behaviours or outputs from the project requirements.',
  },
  {
    key: 'submission_completeness',
    title: 'Submission Completeness',
    weight: 20,
    hint: 'List the required files, screens, components, or submission parts that must be present.',
  },
];

const resultFactor: Record<ItemResult, number | null> = {
  done: 1,
  partial: 0.5,
  missing: 0,
  not_applicable: null,
};

const emptyMeta = {
  tutorId: '',
  orgId: '',
  cycleId: '',
  studentName: '',
  studentId: '',
  courseTrack: '',
  ageLevel: '',
  projectName: '',
  studentProjectUrl: '',
  tutorScore: '',
  tutorFeedback: '',
  versionStatus: 'unable_to_confirm' as VersionStatus,
  ownershipEvidence: '',
  ownershipReference: '',
  requirementCoverage: '' as RequirementCoverage,
  feedbackAccuracy: '' as FeedbackAccuracy,
};

const emptyChecks = {
  specific: false,
  exactArea: false,
  nextStep: false,
  consistent: false,
};

function makeItem(category: ChecklistCategory): ChecklistItem {
  return {
    localId: `${category}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    category,
    requirement: '',
    result: 'missing',
    notes: '',
  };
}

function verdictLabel(value: string | null) {
  if (!value) return '—';
  if (value === 'accurate') return 'Accurate';
  if (value === 'mostly_accurate') return 'Mostly Accurate';
  if (value === 'needs_calibration') return 'Needs Calibration';
  return 'Unreliable';
}

export function FinalProjectAuditPage() {
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [meta, setMeta] = useState(emptyMeta);
  const [feedbackChecks, setFeedbackChecks] = useState(emptyChecks);
  const [items, setItems] = useState<ChecklistItem[]>(categoryConfig.map((category) => makeItem(category.key)));
  const [recentAudits, setRecentAudits] = useState<RecentAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadPage() {
    setLoading(true);
    setError('');
    const [tutorsResult, orgsResult, cyclesResult, auditsResult] = await Promise.all([
      supabase.from('tutors').select('id, employee_code, full_name').eq('is_active', true).order('full_name'),
      supabase.from('projects').select('id, name').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('evaluation_cycles').select('id, name, start_date, end_date, is_default, status').order('start_date', { ascending: false }),
      supabase
        .from('final_project_audits')
        .select('id, student_name, project_name, tutor_score, qc_project_score, score_variance, evaluation_audit_score, evaluation_verdict, status, created_at, tutor:tutors(full_name, employee_code), org:projects(name), cycle:evaluation_cycles(name)')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const firstError = tutorsResult.error || orgsResult.error || cyclesResult.error || auditsResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      const loadedCycles = (cyclesResult.data ?? []) as CycleOption[];
      setTutors((tutorsResult.data ?? []) as TutorOption[]);
      setOrgs((orgsResult.data ?? []) as OrgOption[]);
      setCycles(loadedCycles);
      setRecentAudits((auditsResult.data ?? []) as unknown as RecentAudit[]);
      const defaultCycle = loadedCycles.find((cycle) => cycle.is_default) ?? loadedCycles.find((cycle) => cycle.status === 'active');
      if (defaultCycle) setMeta((current) => ({ ...current, cycleId: current.cycleId || defaultCycle.id }));
    }
    setLoading(false);
  }

  useEffect(() => { void loadPage(); }, []);

  const categoryScores = useMemo(() => {
    const scores: Partial<Record<ChecklistCategory, number>> = {};
    for (const category of categoryConfig) {
      const categoryItems = items.filter((item) => item.category === category.key && item.requirement.trim());
      const applicable = categoryItems.filter((item) => resultFactor[item.result] !== null);
      if (!applicable.length) continue;
      const average = applicable.reduce((sum, item) => sum + (resultFactor[item.result] ?? 0), 0) / applicable.length;
      scores[category.key] = Math.round(average * 100);
    }
    return scores;
  }, [items]);

  const qcProjectScore = useMemo(() => {
    const hasAllCategories = categoryConfig.every((category) => categoryScores[category.key] !== undefined);
    if (!hasAllCategories) return null;
    return Math.round(categoryConfig.reduce((sum, category) => {
      return sum + ((categoryScores[category.key] ?? 0) * category.weight) / 100;
    }, 0));
  }, [categoryScores]);

  const tutorScoreNumber = meta.tutorScore === '' ? null : Number(meta.tutorScore);
  const variance = tutorScoreNumber === null || qcProjectScore === null ? null : Math.round((tutorScoreNumber - qcProjectScore) * 100) / 100;
  const absoluteVariance = variance === null ? null : Math.abs(variance);
  const alignmentScore = absoluteVariance === null ? null : absoluteVariance <= 5 ? 100 : absoluteVariance <= 10 ? 75 : absoluteVariance <= 20 ? 50 : 0;
  const coverageScore = meta.requirementCoverage === 'full' ? 100 : meta.requirementCoverage === 'partial' ? 50 : meta.requirementCoverage === 'insufficient' ? 0 : null;
  const accuracyScore = meta.feedbackAccuracy === 'accurate' ? 100 : meta.feedbackAccuracy === 'partially_accurate' ? 50 : ['inaccurate', 'no_feedback'].includes(meta.feedbackAccuracy) ? 0 : null;
  const feedbackSpecificityScore = Math.round((Object.values(feedbackChecks).filter(Boolean).length / 4) * 100);
  const auditScore = alignmentScore === null || coverageScore === null || accuracyScore === null
    ? null
    : Math.round((alignmentScore * 0.4) + (coverageScore * 0.25) + (accuracyScore * 0.2) + (feedbackSpecificityScore * 0.15));
  const verdict = auditScore === null ? null : auditScore >= 90 ? 'accurate' : auditScore >= 75 ? 'mostly_accurate' : auditScore >= 60 ? 'needs_calibration' : 'unreliable';

  function addItem(category: ChecklistCategory) {
    setItems((current) => [...current, makeItem(category)]);
  }

  function updateItem(localId: string, patch: Partial<ChecklistItem>) {
    setItems((current) => current.map((item) => item.localId === localId ? { ...item, ...patch } : item));
  }

  function removeItem(localId: string) {
    setItems((current) => current.filter((item) => item.localId !== localId));
  }

  function resetForm() {
    const defaultCycle = cycles.find((cycle) => cycle.is_default) ?? cycles.find((cycle) => cycle.status === 'active');
    setMeta({ ...emptyMeta, cycleId: defaultCycle?.id ?? '' });
    setFeedbackChecks(emptyChecks);
    setItems(categoryConfig.map((category) => makeItem(category.key)));
  }

  async function saveAudit(finalize: boolean) {
    setError('');
    setSuccess('');

    if (!meta.tutorId || !meta.studentName.trim() || !meta.projectName.trim()) {
      setError('Tutor, Student Name, and Project Name are required.');
      return;
    }

    if (finalize) {
      if (meta.versionStatus !== 'confirmed') {
        setError('Student Version must be Confirmed before completing the Final Project Audit.');
        return;
      }
      if (!meta.studentProjectUrl.trim()) {
        setError('Student Project link is required before completing the audit.');
        return;
      }
      const missingCategory = categoryConfig.find((category) => !items.some((item) => item.category === category.key && item.requirement.trim()));
      if (missingCategory) {
        setError(`Add at least one checklist requirement under ${missingCategory.title}.`);
        return;
      }
      if (qcProjectScore === null || tutorScoreNumber === null || Number.isNaN(tutorScoreNumber) || tutorScoreNumber < 0 || tutorScoreNumber > 100) {
        setError('Complete the project checklist and enter the Tutor score from 0 to 100.');
        return;
      }
      if (!meta.requirementCoverage || !meta.feedbackAccuracy || auditScore === null || !verdict) {
        setError('Complete the Tutor Evaluation Audit before submitting.');
        return;
      }
    }

    setSaving(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError ?? new Error('No authenticated user.');

      const status = finalize ? 'completed' : meta.versionStatus === 'confirmed' ? 'draft' : 'needs_verification';
      const { data: audit, error: auditError } = await supabase
        .from('final_project_audits')
        .insert({
          tutor_id: meta.tutorId,
          evaluator_id: userData.user.id,
          org_id: meta.orgId || null,
          cycle_id: meta.cycleId || null,
          student_name: meta.studentName.trim(),
          student_id: meta.studentId.trim() || null,
          course_track: meta.courseTrack.trim() || null,
          age_level: meta.ageLevel.trim() || null,
          project_name: meta.projectName.trim(),
          student_project_url: meta.studentProjectUrl.trim() || null,
          tutor_score: tutorScoreNumber,
          tutor_feedback: meta.tutorFeedback.trim() || null,
          version_status: meta.versionStatus,
          ownership_evidence: meta.ownershipEvidence.trim() || null,
          ownership_reference: meta.ownershipReference.trim() || null,
          requirement_coverage: meta.requirementCoverage || null,
          feedback_accuracy: meta.feedbackAccuracy || null,
          feedback_check_specific: feedbackChecks.specific,
          feedback_check_exact_area: feedbackChecks.exactArea,
          feedback_check_next_step: feedbackChecks.nextStep,
          feedback_check_consistent: feedbackChecks.consistent,
          qc_project_score: qcProjectScore,
          score_variance: variance,
          evaluation_audit_score: auditScore,
          evaluation_verdict: verdict,
          status,
        })
        .select('id')
        .single();
      if (auditError) throw auditError;

      const rows = items
        .filter((item) => item.requirement.trim())
        .map((item, index) => ({
          audit_id: audit.id,
          category: item.category,
          requirement_text: item.requirement.trim(),
          result: item.result,
          notes: item.notes.trim() || null,
          sort_order: index + 1,
        }));

      if (rows.length) {
        const { error: itemsError } = await supabase.from('final_project_audit_items').insert(rows);
        if (itemsError) throw itemsError;
      }

      setSuccess(finalize ? 'Final Project Audit completed.' : 'Final Project Audit saved as draft.');
      resetForm();
      await loadPage();
    } catch (caught) {
      const message = caught && typeof caught === 'object' && 'message' in caught ? String((caught as { message: unknown }).message) : 'Unable to save the Final Project Audit.';
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="screen-center">Loading Final Project Audit…</div>;

  return (
    <div className="page-stack final-project-audit-page">
      <header className="page-header final-project-audit-header">
        <div>
          <p className="eyebrow">Standalone quality audit</p>
          <h1>Final Project Audit</h1>
          <p>Evaluate the student project itself, then audit whether the Tutor score and feedback were accurate and fair. No full-session review is required.</p>
        </div>
        <div className="project-audit-score-card">
          <small>QC Project Score</small>
          <strong>{qcProjectScore === null ? '—' : `${qcProjectScore}%`}</strong>
          <span>{variance === null ? 'Add Tutor score to compare' : `Tutor variance ${variance > 0 ? '+' : ''}${variance}%`}</span>
        </div>
      </header>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">1 · Project information</p><h2>Student submission</h2><p>The uploaded artifact is the source of truth for the project assessment.</p></div></div>
        <div className="form-grid">
          <label>Tutor *<select value={meta.tutorId} onChange={(event) => setMeta({ ...meta, tutorId: event.target.value })}><option value="">Select tutor</option>{tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.employee_code} — {tutor.full_name}</option>)}</select></label>
          <label>Org.<select value={meta.orgId} onChange={(event) => setMeta({ ...meta, orgId: event.target.value })}><option value="">No Org.</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          <label>Evaluation Cycle<select value={meta.cycleId} onChange={(event) => setMeta({ ...meta, cycleId: event.target.value })}><option value="">No cycle</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name}</option>)}</select></label>
          <label>Student Name *<input value={meta.studentName} onChange={(event) => setMeta({ ...meta, studentName: event.target.value })} /></label>
          <label>Student ID<input value={meta.studentId} onChange={(event) => setMeta({ ...meta, studentId: event.target.value })} /></label>
          <label>Course / Track<input value={meta.courseTrack} onChange={(event) => setMeta({ ...meta, courseTrack: event.target.value })} /></label>
          <label>Age / Level<input value={meta.ageLevel} onChange={(event) => setMeta({ ...meta, ageLevel: event.target.value })} /></label>
          <label>Project Name *<input value={meta.projectName} onChange={(event) => setMeta({ ...meta, projectName: event.target.value })} /></label>
          <label className="full-width">Student Final Project Link<input type="url" placeholder="https://…" value={meta.studentProjectUrl} onChange={(event) => setMeta({ ...meta, studentProjectUrl: event.target.value })} /></label>
        </div>
      </section>

      <section className="panel form-section version-gate-section">
        <div className="panel-heading"><div><p className="eyebrow">2 · Verification gate</p><h2>Student Version Verification</h2><p>This does not add points. It only confirms that the audited file is the student's final version rather than the Tutor version.</p></div></div>
        <div className="version-status-grid">
          {([
            ['confirmed', 'Confirmed', 'Evidence supports that this is the student final version.'],
            ['unable_to_confirm', 'Unable to Confirm', 'Save the audit, but do not issue a final project score yet.'],
            ['incorrect_tutor_version', 'Tutor / Incorrect Version', 'Do not complete the audit using this file.'],
          ] as Array<[VersionStatus, string, string]>).map(([value, title, description]) => (
            <button type="button" key={value} className={meta.versionStatus === value ? 'selected' : ''} onClick={() => setMeta({ ...meta, versionStatus: value })}>
              <strong>{title}</strong><span>{description}</span>
            </button>
          ))}
        </div>
        <div className="form-grid project-audit-evidence-grid">
          <label className="full-width">Ownership Evidence<textarea rows={2} value={meta.ownershipEvidence} onChange={(event) => setMeta({ ...meta, ownershipEvidence: event.target.value })} placeholder="Example: student submission history, file/version evidence, or a short session timestamp confirming ownership." /></label>
          <label className="full-width">Evidence Reference / Timestamp<input value={meta.ownershipReference} onChange={(event) => setMeta({ ...meta, ownershipReference: event.target.value })} placeholder="Optional link, file reference, or timestamp" /></label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">3 · Objective project assessment</p><h2>Project Requirements Checklist</h2><p>Each line must be a specific requirement or testable expected output. Done = 100%, Partial = 50%, Missing = 0%. N/A is excluded.</p></div></div>
        <div className="project-checklist-groups">
          {categoryConfig.map((category) => (
            <article className="project-checklist-group" key={category.key}>
              <div className="project-checklist-heading">
                <div><span>{category.weight}%</span><h3>{category.title}</h3><p>{category.hint}</p></div>
                <strong>{categoryScores[category.key] === undefined ? '—' : `${categoryScores[category.key]}%`}</strong>
              </div>
              <div className="project-checklist-items">
                {items.filter((item) => item.category === category.key).map((item) => (
                  <div className="project-checklist-row" key={item.localId}>
                    <label>Requirement<input value={item.requirement} onChange={(event) => updateItem(item.localId, { requirement: event.target.value })} placeholder="Exact requirement from the project brief" /></label>
                    <label>Result<select value={item.result} onChange={(event) => updateItem(item.localId, { result: event.target.value as ItemResult })}><option value="done">Done</option><option value="partial">Partial</option><option value="missing">Missing</option><option value="not_applicable">N/A</option></select></label>
                    <label>Evidence / Note<input value={item.notes} onChange={(event) => updateItem(item.localId, { notes: event.target.value })} placeholder="Short evidence" /></label>
                    <button type="button" className="project-row-remove" onClick={() => removeItem(item.localId)} aria-label="Remove requirement">×</button>
                  </div>
                ))}
              </div>
              <button type="button" className="button button-secondary project-add-requirement" onClick={() => addItem(category.key)}>+ Add requirement</button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">4 · Tutor evaluation</p><h2>What did the Tutor score and write?</h2><p>The QC Project Score above is independent. The fields below are used only to audit the Tutor evaluation.</p></div></div>
        <div className="form-grid">
          <label>Tutor Project Score %<input type="number" min="0" max="100" step="0.1" value={meta.tutorScore} onChange={(event) => setMeta({ ...meta, tutorScore: event.target.value })} /></label>
          <label>Current Variance<input readOnly value={variance === null ? '' : `${variance > 0 ? '+' : ''}${variance}%`} placeholder="Calculated automatically" /></label>
          <label className="full-width">Tutor Feedback<textarea rows={4} value={meta.tutorFeedback} onChange={(event) => setMeta({ ...meta, tutorFeedback: event.target.value })} /></label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="panel-heading"><div><p className="eyebrow">5 · Tutor evaluation audit</p><h2>Was the Tutor evaluation accurate and useful?</h2><p>The audit score is calculated from four objective checks.</p></div></div>
        <div className="tutor-audit-metrics">
          <article>
            <div><span>40%</span><h3>Score Alignment with Actual Project</h3><p>Calculated automatically from Tutor score vs QC Project Score.</p></div>
            <strong>{alignmentScore === null ? '—' : `${alignmentScore}%`}</strong>
          </article>
          <article>
            <div><span>25%</span><h3>Requirement Coverage</h3><p>Did the Tutor evaluation cover the required project requirements?</p></div>
            <select value={meta.requirementCoverage} onChange={(event) => setMeta({ ...meta, requirementCoverage: event.target.value as RequirementCoverage })}><option value="">Select</option><option value="full">Full coverage</option><option value="partial">Partial coverage</option><option value="insufficient">Insufficient coverage</option></select>
          </article>
          <article>
            <div><span>20%</span><h3>Feedback Accuracy</h3><p>Is the Tutor feedback factually consistent with what is actually present or missing in the project?</p></div>
            <select value={meta.feedbackAccuracy} onChange={(event) => setMeta({ ...meta, feedbackAccuracy: event.target.value as FeedbackAccuracy })}><option value="">Select</option><option value="accurate">Accurate</option><option value="partially_accurate">Partially accurate</option><option value="inaccurate">Inaccurate</option><option value="no_feedback">No feedback provided</option></select>
          </article>
          <article className="feedback-specificity-audit">
            <div><span>15%</span><h3>Feedback Specificity & Next-Step Guidance</h3><p>Each Yes is one objective check. This is not a writing-style judgment.</p></div>
            <div className="feedback-checks">
              <label><input type="checkbox" checked={feedbackChecks.specific} onChange={(event) => setFeedbackChecks({ ...feedbackChecks, specific: event.target.checked })} />Feedback is tied to a real project requirement/result.</label>
              <label><input type="checkbox" checked={feedbackChecks.exactArea} onChange={(event) => setFeedbackChecks({ ...feedbackChecks, exactArea: event.target.checked })} />It identifies the exact area, not generic wording such as “Good job”.</label>
              <label><input type="checkbox" checked={feedbackChecks.nextStep} onChange={(event) => setFeedbackChecks({ ...feedbackChecks, nextStep: event.target.checked })} />When an issue exists, it states what needs to change next.</label>
              <label><input type="checkbox" checked={feedbackChecks.consistent} onChange={(event) => setFeedbackChecks({ ...feedbackChecks, consistent: event.target.checked })} />Feedback is consistent with the project condition and Tutor score.</label>
            </div>
            <strong>{feedbackSpecificityScore}%</strong>
          </article>
        </div>
      </section>

      <section className="project-audit-summary">
        <article><small>QC Project Score</small><strong>{qcProjectScore === null ? '—' : `${qcProjectScore}%`}</strong></article>
        <article><small>Tutor Score</small><strong>{tutorScoreNumber === null ? '—' : `${tutorScoreNumber}%`}</strong></article>
        <article><small>Variance</small><strong>{variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance}%`}</strong><span>{variance === null ? '' : variance > 5 ? 'Tutor score higher than QC' : variance < -5 ? 'Tutor score lower than QC' : 'Aligned'}</span></article>
        <article><small>Tutor Evaluation Quality</small><strong>{auditScore === null ? '—' : `${auditScore}%`}</strong><span>{verdictLabel(verdict)}</span></article>
      </section>

      <div className="form-actions project-audit-actions">
        <button className="button button-secondary" type="button" disabled={saving} onClick={() => void saveAudit(false)}>{saving ? 'Saving…' : 'Save Draft'}</button>
        <button className="button button-primary" type="button" disabled={saving || meta.versionStatus !== 'confirmed'} onClick={() => void saveAudit(true)}>{saving ? 'Saving…' : 'Complete Final Project Audit'}</button>
      </div>

      <section className="panel table-panel project-audit-history">
        <div className="panel-heading"><div><p className="eyebrow">Audit history</p><h2>Recent Final Project Audits</h2><p>Latest standalone project evaluations and Tutor evaluation audit results.</p></div></div>
        {recentAudits.length === 0 ? <div className="empty-state">No Final Project Audits yet.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Student / Project</th><th>Tutor</th><th>Org. / Cycle</th><th>QC Project</th><th>Tutor Score</th><th>Variance</th><th>Evaluation Audit</th><th>Status</th></tr></thead><tbody>{recentAudits.map((audit) => <tr key={audit.id}>
            <td><strong>{audit.student_name}</strong><span className="table-subtext">{audit.project_name}</span></td>
            <td>{audit.tutor ? `${audit.tutor.employee_code} — ${audit.tutor.full_name}` : '—'}</td>
            <td>{audit.org?.name || '—'}<span className="table-subtext">{audit.cycle?.name || 'No cycle'}</span></td>
            <td>{audit.qc_project_score === null ? '—' : `${audit.qc_project_score}%`}</td>
            <td>{audit.tutor_score === null ? '—' : `${audit.tutor_score}%`}</td>
            <td>{audit.score_variance === null ? '—' : `${audit.score_variance > 0 ? '+' : ''}${audit.score_variance}%`}</td>
            <td><strong>{audit.evaluation_audit_score === null ? '—' : `${audit.evaluation_audit_score}%`}</strong><span className="table-subtext">{verdictLabel(audit.evaluation_verdict)}</span></td>
            <td><span className={`status-badge status-${audit.status}`}>{audit.status.replaceAll('_', ' ')}</span></td>
          </tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
