begin;

create table if not exists public.project_evaluation_audits (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id),
  evaluator_id uuid not null references public.profiles(id),
  org_id uuid references public.projects(id),
  cycle_id uuid references public.evaluation_cycles(id),
  student_name text,
  student_id text,
  project_name text,
  project_reference text,
  tutor_score numeric(5,2) check (tutor_score is null or (tutor_score >= 0 and tutor_score <= 100)),
  tutor_feedback text,
  evaluation_reference text,
  audit_score numeric(5,2) check (audit_score is null or (audit_score >= 0 and audit_score <= 100)),
  verdict text check (verdict is null or verdict in ('accurate', 'mostly_accurate', 'needs_calibration', 'unreliable')),
  status text not null default 'draft' check (status in ('draft', 'completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_evaluation_audit_scores (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.project_evaluation_audits(id) on delete cascade,
  metric_id uuid not null references public.project_evaluation_metrics(id),
  numeric_score numeric(3,1) not null check (numeric_score >= 1 and numeric_score <= 5),
  evidence text,
  weight_snapshot numeric(6,2) not null,
  created_at timestamptz not null default now(),
  unique (audit_id, metric_id)
);

create index if not exists project_evaluation_audits_tutor_idx on public.project_evaluation_audits(tutor_id);
create index if not exists project_evaluation_audits_cycle_idx on public.project_evaluation_audits(cycle_id);
create index if not exists project_evaluation_audits_created_idx on public.project_evaluation_audits(created_at desc);
create index if not exists project_evaluation_audit_scores_audit_idx on public.project_evaluation_audit_scores(audit_id);

alter table public.project_evaluation_audits enable row level security;
alter table public.project_evaluation_audit_scores enable row level security;

drop trigger if exists project_evaluation_audits_set_updated_at on public.project_evaluation_audits;
create trigger project_evaluation_audits_set_updated_at
before update on public.project_evaluation_audits
for each row execute function public.set_updated_at();

drop policy if exists "staff view project evaluation audits" on public.project_evaluation_audits;
create policy "staff view project evaluation audits"
on public.project_evaluation_audits for select to authenticated
using (public.current_role() in ('super_admin', 'admin', 'qtl', 'qc') and public.has_permission('view_reviews'));

drop policy if exists "staff create project evaluation audits" on public.project_evaluation_audits;
create policy "staff create project evaluation audits"
on public.project_evaluation_audits for insert to authenticated
with check (public.current_role() in ('super_admin', 'admin', 'qtl', 'qc') and public.has_permission('create_evaluation') and evaluator_id = auth.uid());

drop policy if exists "staff update project evaluation audits" on public.project_evaluation_audits;
create policy "staff update project evaluation audits"
on public.project_evaluation_audits for update to authenticated
using (
  public.current_role() = 'super_admin'
  or (public.current_role() in ('admin', 'qtl') and public.has_permission('edit_reviews'))
  or (public.current_role() = 'qc' and evaluator_id = auth.uid() and public.has_permission('create_evaluation'))
)
with check (
  public.current_role() = 'super_admin'
  or (public.current_role() in ('admin', 'qtl') and public.has_permission('edit_reviews'))
  or (public.current_role() = 'qc' and evaluator_id = auth.uid() and public.has_permission('create_evaluation'))
);

drop policy if exists "staff delete project evaluation audits" on public.project_evaluation_audits;
create policy "staff delete project evaluation audits"
on public.project_evaluation_audits for delete to authenticated
using (
  public.current_role() = 'super_admin'
  or (public.current_role() in ('admin', 'qtl') and public.has_permission('delete_reviews'))
  or (public.current_role() = 'qc' and evaluator_id = auth.uid() and public.has_permission('delete_reviews'))
);

drop policy if exists "staff view project evaluation audit scores" on public.project_evaluation_audit_scores;
create policy "staff view project evaluation audit scores"
on public.project_evaluation_audit_scores for select to authenticated
using (
  exists (
    select 1 from public.project_evaluation_audits a
    where a.id = audit_id
      and public.current_role() in ('super_admin', 'admin', 'qtl', 'qc')
      and public.has_permission('view_reviews')
  )
);

drop policy if exists "staff create project evaluation audit scores" on public.project_evaluation_audit_scores;
create policy "staff create project evaluation audit scores"
on public.project_evaluation_audit_scores for insert to authenticated
with check (
  exists (
    select 1 from public.project_evaluation_audits a
    where a.id = audit_id
      and a.evaluator_id = auth.uid()
      and public.current_role() in ('super_admin', 'admin', 'qtl', 'qc')
      and public.has_permission('create_evaluation')
  )
  or public.current_role() = 'super_admin'
  or (public.current_role() in ('admin', 'qtl') and public.has_permission('edit_reviews'))
);

drop policy if exists "staff update project evaluation audit scores" on public.project_evaluation_audit_scores;
create policy "staff update project evaluation audit scores"
on public.project_evaluation_audit_scores for update to authenticated
using (
  exists (
    select 1 from public.project_evaluation_audits a
    where a.id = audit_id
      and (
        public.current_role() = 'super_admin'
        or (public.current_role() in ('admin', 'qtl') and public.has_permission('edit_reviews'))
        or (public.current_role() = 'qc' and a.evaluator_id = auth.uid() and public.has_permission('create_evaluation'))
      )
  )
)
with check (
  exists (
    select 1 from public.project_evaluation_audits a
    where a.id = audit_id
      and (
        public.current_role() = 'super_admin'
        or (public.current_role() in ('admin', 'qtl') and public.has_permission('edit_reviews'))
        or (public.current_role() = 'qc' and a.evaluator_id = auth.uid() and public.has_permission('create_evaluation'))
      )
  )
);

drop policy if exists "staff delete project evaluation audit scores" on public.project_evaluation_audit_scores;
create policy "staff delete project evaluation audit scores"
on public.project_evaluation_audit_scores for delete to authenticated
using (
  exists (
    select 1 from public.project_evaluation_audits a
    where a.id = audit_id
      and (
        public.current_role() = 'super_admin'
        or (public.current_role() in ('admin', 'qtl') and public.has_permission('edit_reviews'))
        or (public.current_role() = 'qc' and a.evaluator_id = auth.uid() and public.has_permission('create_evaluation'))
      )
  )
);

commit;