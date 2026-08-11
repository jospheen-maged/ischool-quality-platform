-- Standalone Final Project Evaluation Audit.
-- Final projects are audited independently from session observation.
-- QC evaluates objective project requirements, then audits the Tutor evaluation.
-- This migration also fixes Section 3 insert permissions for newly-created normal evaluations.

begin;

-- Fix the New Evaluation regression introduced by granular Edit Review permissions.
create or replace function public.can_create_review_children(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.reviews r
    where r.id = p_review_id
      and r.evaluator_id = auth.uid()
      and public.current_role() in ('super_admin', 'admin', 'qtl', 'qc')
      and public.has_permission('create_evaluation')
  ), false);
$$;

grant execute on function public.can_create_review_children(uuid) to authenticated;

drop policy if exists "quality staff insert project evaluations" on public.review_project_evaluations;
create policy "quality staff insert project evaluations"
on public.review_project_evaluations
for insert
to authenticated
with check (
  public.can_create_review_children(review_id)
  or public.can_edit_review(review_id)
);

create table if not exists public.final_project_audits (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id),
  evaluator_id uuid not null references public.profiles(id),
  org_id uuid references public.projects(id),
  cycle_id uuid references public.evaluation_cycles(id),
  student_name text not null,
  student_id text,
  course_track text,
  age_level text,
  project_name text not null,
  student_project_url text,
  tutor_score numeric(5,2) check (tutor_score is null or (tutor_score >= 0 and tutor_score <= 100)),
  tutor_feedback text,
  version_status text not null default 'unable_to_confirm'
    check (version_status in ('confirmed', 'unable_to_confirm', 'incorrect_tutor_version')),
  ownership_evidence text,
  ownership_reference text,
  requirement_coverage text
    check (requirement_coverage is null or requirement_coverage in ('full', 'partial', 'insufficient')),
  feedback_accuracy text
    check (feedback_accuracy is null or feedback_accuracy in ('accurate', 'partially_accurate', 'inaccurate', 'no_feedback')),
  feedback_check_specific boolean not null default false,
  feedback_check_exact_area boolean not null default false,
  feedback_check_next_step boolean not null default false,
  feedback_check_consistent boolean not null default false,
  qc_project_score numeric(5,2) check (qc_project_score is null or (qc_project_score >= 0 and qc_project_score <= 100)),
  score_variance numeric(6,2),
  evaluation_audit_score numeric(5,2) check (evaluation_audit_score is null or (evaluation_audit_score >= 0 and evaluation_audit_score <= 100)),
  evaluation_verdict text
    check (evaluation_verdict is null or evaluation_verdict in ('accurate', 'mostly_accurate', 'needs_calibration', 'unreliable')),
  status text not null default 'draft'
    check (status in ('draft', 'needs_verification', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.final_project_audit_items (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.final_project_audits(id) on delete cascade,
  category text not null
    check (category in ('required_features', 'expected_functionality', 'submission_completeness')),
  requirement_text text not null,
  result text not null default 'missing'
    check (result in ('done', 'partial', 'missing', 'not_applicable')),
  notes text,
  sort_order integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists final_project_audits_tutor_idx on public.final_project_audits(tutor_id);
create index if not exists final_project_audits_cycle_idx on public.final_project_audits(cycle_id);
create index if not exists final_project_audits_org_idx on public.final_project_audits(org_id);
create index if not exists final_project_audits_created_idx on public.final_project_audits(created_at desc);
create index if not exists final_project_audit_items_audit_idx on public.final_project_audit_items(audit_id);

alter table public.final_project_audits enable row level security;
alter table public.final_project_audit_items enable row level security;

drop policy if exists "staff view final project audits" on public.final_project_audits;
create policy "staff view final project audits"
on public.final_project_audits
for select
to authenticated
using (
  public.current_role() in ('super_admin', 'admin', 'qtl', 'qc')
  and public.has_permission('view_reviews')
);

drop policy if exists "staff create final project audits" on public.final_project_audits;
create policy "staff create final project audits"
on public.final_project_audits
for insert
to authenticated
with check (
  public.current_role() in ('super_admin', 'admin', 'qtl', 'qc')
  and public.has_permission('create_evaluation')
  and evaluator_id = auth.uid()
);

drop policy if exists "staff update final project audits" on public.final_project_audits;
create policy "staff update final project audits"
on public.final_project_audits
for update
to authenticated
using (
  public.current_role() = 'super_admin'
  or (
    public.current_role() in ('admin', 'qtl')
    and public.has_permission('edit_reviews')
  )
  or (
    public.current_role() = 'qc'
    and evaluator_id = auth.uid()
    and public.has_permission('create_evaluation')
  )
)
with check (
  public.current_role() = 'super_admin'
  or (
    public.current_role() in ('admin', 'qtl')
    and public.has_permission('edit_reviews')
  )
  or (
    public.current_role() = 'qc'
    and evaluator_id = auth.uid()
    and public.has_permission('create_evaluation')
  )
);

drop policy if exists "staff delete final project audits" on public.final_project_audits;
create policy "staff delete final project audits"
on public.final_project_audits
for delete
to authenticated
using (
  public.current_role() = 'super_admin'
  or (
    public.current_role() in ('admin', 'qtl')
    and public.has_permission('delete_reviews')
  )
  or (
    public.current_role() = 'qc'
    and evaluator_id = auth.uid()
    and public.has_permission('delete_reviews')
  )
);

drop policy if exists "staff view final project audit items" on public.final_project_audit_items;
create policy "staff view final project audit items"
on public.final_project_audit_items
for select
to authenticated
using (
  exists (
    select 1
    from public.final_project_audits a
    where a.id = audit_id
      and public.current_role() in ('super_admin', 'admin', 'qtl', 'qc')
      and public.has_permission('view_reviews')
  )
);

drop policy if exists "staff create final project audit items" on public.final_project_audit_items;
create policy "staff create final project audit items"
on public.final_project_audit_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.final_project_audits a
    where a.id = audit_id
      and (
        (
          a.evaluator_id = auth.uid()
          and public.current_role() in ('super_admin', 'admin', 'qtl', 'qc')
          and public.has_permission('create_evaluation')
        )
        or public.current_role() = 'super_admin'
        or (
          public.current_role() in ('admin', 'qtl')
          and public.has_permission('edit_reviews')
        )
      )
  )
);

drop policy if exists "staff update final project audit items" on public.final_project_audit_items;
create policy "staff update final project audit items"
on public.final_project_audit_items
for update
to authenticated
using (
  exists (
    select 1
    from public.final_project_audits a
    where a.id = audit_id
      and (
        public.current_role() = 'super_admin'
        or (
          public.current_role() in ('admin', 'qtl')
          and public.has_permission('edit_reviews')
        )
        or (
          public.current_role() = 'qc'
          and a.evaluator_id = auth.uid()
          and public.has_permission('create_evaluation')
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.final_project_audits a
    where a.id = audit_id
      and (
        public.current_role() = 'super_admin'
        or (
          public.current_role() in ('admin', 'qtl')
          and public.has_permission('edit_reviews')
        )
        or (
          public.current_role() = 'qc'
          and a.evaluator_id = auth.uid()
          and public.has_permission('create_evaluation')
        )
      )
  )
);

drop policy if exists "staff delete final project audit items" on public.final_project_audit_items;
create policy "staff delete final project audit items"
on public.final_project_audit_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.final_project_audits a
    where a.id = audit_id
      and (
        public.current_role() = 'super_admin'
        or (
          public.current_role() in ('admin', 'qtl')
          and public.has_permission('edit_reviews')
        )
        or (
          public.current_role() = 'qc'
          and a.evaluator_id = auth.uid()
          and public.has_permission('create_evaluation')
        )
      )
  )
);

commit;
