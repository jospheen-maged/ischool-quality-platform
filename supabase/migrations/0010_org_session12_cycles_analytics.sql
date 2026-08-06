-- Organization, Session 12, configurable project-evaluation metrics, and named evaluation cycles.
-- Builds on migrations 0003-0009.

begin;

alter table public.quality_model_settings
  add column if not exists final_teaching_weight numeric(6,2) not null default 60 check (final_teaching_weight between 0 and 100),
  add column if not exists final_compliance_weight numeric(6,2) not null default 20 check (final_compliance_weight between 0 and 100),
  add column if not exists final_project_weight numeric(6,2) not null default 20 check (final_project_weight between 0 and 100);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quality_model_settings_final_total_check'
      and conrelid = 'public.quality_model_settings'::regclass
  ) then
    alter table public.quality_model_settings
      add constraint quality_model_settings_final_total_check
      check (final_teaching_weight + final_compliance_weight + final_project_weight = 100);
  end if;
end $$;

create table if not exists public.evaluation_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  is_default boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

drop trigger if exists evaluation_cycles_set_updated_at on public.evaluation_cycles;
create trigger evaluation_cycles_set_updated_at
before update on public.evaluation_cycles
for each row execute procedure public.set_updated_at();

create or replace function public.ensure_single_default_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default then
    update public.evaluation_cycles
    set is_default = false
    where id <> new.id and is_default = true;
  end if;
  return new;
end;
$$;

drop trigger if exists evaluation_cycles_single_default on public.evaluation_cycles;
create trigger evaluation_cycles_single_default
before insert or update of is_default on public.evaluation_cycles
for each row execute procedure public.ensure_single_default_cycle();

insert into public.evaluation_cycles (name, start_date, end_date, status, is_default, sort_order)
values ('August Cycle', '2026-07-26', '2026-08-25', 'active', true, 1)
on conflict (name) do nothing;

create table if not exists public.project_evaluation_metrics (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('normal_session', 'session_12')),
  code text not null,
  title text not null,
  description text,
  weight_percentage numeric(6,2) not null default 0 check (weight_percentage between 0 and 100),
  anchor_1 text,
  anchor_3 text,
  anchor_5 text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope, code)
);

drop trigger if exists project_evaluation_metrics_set_updated_at on public.project_evaluation_metrics;
create trigger project_evaluation_metrics_set_updated_at
before update on public.project_evaluation_metrics
for each row execute procedure public.set_updated_at();

insert into public.project_evaluation_metrics
(scope, code, title, description, weight_percentage, anchor_1, anchor_3, anchor_5, sort_order)
values
('normal_session', 'PEQ-01', 'Evaluation Accuracy & Fairness', 'The tutor score matches the student work and avoids inflation or unfair deductions.', 30,
 'The rating is unsupported or clearly unfair.', 'The rating is broadly reasonable with minor gaps.', 'The rating is accurate, balanced, and fully aligned to the student work.', 1),
('normal_session', 'PEQ-02', 'Evidence-Based Evaluation', 'The tutor bases the evaluation on visible project implementation and student performance.', 25,
 'The evaluation is based on a general impression only.', 'Some evidence is used but links are incomplete.', 'Every judgment is linked to clear project evidence.', 2),
('normal_session', 'PEQ-03', 'Feedback Clarity & Specificity', 'Positive and development feedback refers to real parts of the project.', 20,
 'Feedback is missing, generic, or only a star rating.', 'Feedback is understandable but partly generic.', 'Feedback is precise, balanced, and directly tied to project evidence.', 3),
('normal_session', 'PEQ-04', 'Actionable Next Step', 'The tutor gives a useful correction, practice step, or next action.', 15,
 'No useful next step is provided.', 'A next step is present but not specific enough.', 'The next step is specific, realistic, and easy for the student to act on.', 4),
('normal_session', 'PEQ-05', 'Student Ownership Recognition', 'The evaluation distinguishes student work from tutor-led or copied work.', 10,
 'Ownership is not considered.', 'Ownership is considered with limited evidence.', 'The evaluation accurately reflects what the student personally understood and completed.', 5),
('session_12', 'FP-01', 'Project Completion & Requirements', 'The final project covers the required brief, features, and expected deliverables.', 25,
 'Major requirements are missing.', 'Core requirements are present with visible gaps.', 'The project is complete and fully meets the expected requirements.', 1),
('session_12', 'FP-02', 'Functionality & Technical Accuracy', 'The final project works correctly and demonstrates accurate implementation.', 25,
 'The project is not functional or contains major technical errors.', 'The main functionality works with some errors or gaps.', 'The project works reliably and the technical implementation is accurate.', 2),
('session_12', 'FP-03', 'Student Ownership & Explanation', 'The student explains the work, answers questions, and demonstrates genuine understanding.', 20,
 'The student cannot explain the work or appears to have copied it.', 'The student explains the main idea but needs substantial prompting.', 'The student confidently explains decisions, logic, and personal contribution.', 3),
('session_12', 'FP-04', 'Presentation & Showcase Quality', 'The student presents the result clearly to the parent or audience.', 15,
 'The presentation is missing or unclear.', 'The presentation communicates the main outcome with some support.', 'The presentation is clear, structured, confident, and audience-friendly.', 4),
('session_12', 'FP-05', 'Tutor Final Evaluation & Feedback', 'The tutor gives a fair final score with evidence-based, clear feedback.', 15,
 'The final evaluation is missing, generic, or unsupported.', 'The evaluation is mostly fair but lacks some specificity.', 'The final evaluation is fair, evidence-based, specific, and motivating.', 5)
on conflict (scope, code) do nothing;

alter table public.reviews
  add column if not exists cycle_id uuid references public.evaluation_cycles(id) on delete set null,
  add column if not exists evaluation_mode text not null default 'normal_session'
    check (evaluation_mode in ('normal_session', 'session_12')),
  add column if not exists project_section_title text,
  add column if not exists project_section_weight_snapshot numeric(6,2)
    check (project_section_weight_snapshot is null or project_section_weight_snapshot between 0 and 100);

update public.reviews
set
  evaluation_mode = coalesce(evaluation_mode, 'normal_session'),
  project_section_title = coalesce(project_section_title, 'Project Evaluation Quality'),
  project_section_weight_snapshot = coalesce(project_section_weight_snapshot, project_weight_snapshot, 10)
where project_section_title is null or project_section_weight_snapshot is null;

update public.reviews r
set cycle_id = c.id
from public.evaluation_cycles c
where r.cycle_id is null
  and r.session_date between c.start_date and c.end_date;

create or replace function public.assign_review_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cycle_id is null then
    if new.session_date is not null then
      select id into new.cycle_id
      from public.evaluation_cycles
      where new.session_date between start_date and end_date
      order by is_default desc, sort_order desc, start_date desc
      limit 1;
    end if;

    if new.cycle_id is null then
      select id into new.cycle_id
      from public.evaluation_cycles
      where is_default = true
      order by updated_at desc
      limit 1;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_assign_cycle on public.reviews;
create trigger reviews_assign_cycle
before insert or update of session_date, cycle_id on public.reviews
for each row execute procedure public.assign_review_cycle();

create table if not exists public.review_project_evaluations (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  metric_id uuid not null references public.project_evaluation_metrics(id) on delete restrict,
  numeric_score numeric(6,2) check (numeric_score is null or numeric_score between 1 and 5),
  is_observed boolean not null default true,
  evidence text,
  timestamp_seconds integer check (timestamp_seconds is null or timestamp_seconds >= 0),
  weight_snapshot numeric(6,2) not null default 0 check (weight_snapshot between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, metric_id)
);

drop trigger if exists review_project_evaluations_set_updated_at on public.review_project_evaluations;
create trigger review_project_evaluations_set_updated_at
before update on public.review_project_evaluations
for each row execute procedure public.set_updated_at();

create or replace function public.recalculate_review_total(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teaching_earned numeric(10,4) := 0;
  v_teaching_weight numeric(10,4) := 0;
  v_compliance_earned numeric(10,4) := 0;
  v_compliance_weight numeric(10,4) := 0;
  v_project_earned numeric(10,4) := 0;
  v_project_weight numeric(10,4) := 0;
  v_legacy_project_score numeric(6,2);
  v_legacy_project_snapshot numeric(6,2);
  v_total_earned numeric(10,4);
  v_total_weight numeric(10,4);
  v_total_percentage numeric(6,2);
begin
  select
    coalesce(sum((rs.numeric_score / 5.0) * coalesce(rs.weight_snapshot, c.weight_percentage)) filter (
      where c.criterion_type = 'rating' and rs.is_observed and rs.numeric_score is not null
    ), 0),
    coalesce(sum(coalesce(rs.weight_snapshot, c.weight_percentage)) filter (
      where c.criterion_type = 'rating' and rs.is_observed and rs.numeric_score is not null
    ), 0),
    coalesce(sum(
      case rs.compliance_result
        when 'clear' then 1.00
        when 'coaching_note' then 0.75
        when 'yellow_flag' then 0.50
        when 'red_flag' then 0.00
        else 0.00
      end * coalesce(rs.weight_snapshot, 0)
    ) filter (
      where c.criterion_type = 'compliance'
        and rs.compliance_result in ('clear', 'coaching_note', 'yellow_flag', 'red_flag')
    ), 0),
    coalesce(sum(coalesce(rs.weight_snapshot, 0)) filter (
      where c.criterion_type = 'compliance'
        and rs.compliance_result in ('clear', 'coaching_note', 'yellow_flag', 'red_flag')
    ), 0)
  into v_teaching_earned, v_teaching_weight, v_compliance_earned, v_compliance_weight
  from public.review_scores rs
  join public.evaluation_criteria c on c.id = rs.criterion_id
  where rs.review_id = p_review_id;

  select
    coalesce(sum((rpe.numeric_score / 5.0) * rpe.weight_snapshot) filter (
      where rpe.is_observed and rpe.numeric_score is not null
    ), 0),
    coalesce(sum(rpe.weight_snapshot) filter (
      where rpe.is_observed and rpe.numeric_score is not null
    ), 0)
  into v_project_earned, v_project_weight
  from public.review_project_evaluations rpe
  where rpe.review_id = p_review_id;

  if v_project_weight = 0 then
    select project_score, coalesce(project_section_weight_snapshot, project_weight_snapshot)
    into v_legacy_project_score, v_legacy_project_snapshot
    from public.reviews
    where id = p_review_id;

    if v_legacy_project_score is not null and coalesce(v_legacy_project_snapshot, 0) > 0 then
      v_project_weight := v_legacy_project_snapshot;
      v_project_earned := (v_legacy_project_score / 5.0) * v_project_weight;
    end if;
  end if;

  v_total_earned := v_teaching_earned + v_compliance_earned + v_project_earned;
  v_total_weight := v_teaching_weight + v_compliance_weight + v_project_weight;
  v_total_percentage := case
    when v_total_weight > 0 then round((v_total_earned / v_total_weight) * 100, 2)
    else null
  end;

  update public.reviews
  set
    total_score = round(v_total_earned, 2),
    maximum_score = round(v_total_weight, 2),
    observed_weight = round(v_total_weight, 2),
    score_percentage = v_total_percentage,
    teaching_percentage = case when v_teaching_weight > 0 then round((v_teaching_earned / v_teaching_weight) * 100, 2) else null end,
    compliance_percentage = case when v_compliance_weight > 0 then round((v_compliance_earned / v_compliance_weight) * 100, 2) else null end,
    project_percentage = case when v_project_weight > 0 then round((v_project_earned / v_project_weight) * 100, 2) else null end,
    project_score = case when v_project_weight > 0 then round((v_project_earned / v_project_weight) * 5, 2) else project_score end
  where id = p_review_id;
end;
$$;

create or replace function public.recalculate_project_evaluation_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id uuid;
begin
  v_review_id := case when tg_op = 'DELETE' then old.review_id else new.review_id end;
  perform public.recalculate_review_total(v_review_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists review_project_evaluations_recalculate on public.review_project_evaluations;
create trigger review_project_evaluations_recalculate
after insert or update or delete on public.review_project_evaluations
for each row execute procedure public.recalculate_project_evaluation_score();

alter table public.evaluation_cycles enable row level security;
alter table public.project_evaluation_metrics enable row level security;
alter table public.review_project_evaluations enable row level security;

drop policy if exists "authenticated read cycles" on public.evaluation_cycles;
create policy "authenticated read cycles"
on public.evaluation_cycles for select to authenticated
using (true);

drop policy if exists "management manage cycles" on public.evaluation_cycles;
create policy "management manage cycles"
on public.evaluation_cycles for all to authenticated
using (public.current_role() in ('super_admin', 'admin', 'qtl'))
with check (public.current_role() in ('super_admin', 'admin', 'qtl'));

drop policy if exists "authenticated read project evaluation metrics" on public.project_evaluation_metrics;
create policy "authenticated read project evaluation metrics"
on public.project_evaluation_metrics for select to authenticated
using (is_active or public.current_role() in ('super_admin', 'admin', 'qtl'));

drop policy if exists "management manage project evaluation metrics" on public.project_evaluation_metrics;
create policy "management manage project evaluation metrics"
on public.project_evaluation_metrics for all to authenticated
using (public.current_role() in ('super_admin', 'admin', 'qtl'))
with check (public.current_role() in ('super_admin', 'admin', 'qtl'));

drop policy if exists "role scoped project evaluation visibility" on public.review_project_evaluations;
create policy "role scoped project evaluation visibility"
on public.review_project_evaluations for select to authenticated
using (
  exists (
    select 1 from public.reviews r
    where r.id = review_id
      and (
        public.current_role() in ('super_admin', 'admin', 'qtl', 'qc')
        or (r.tutor_id = public.current_tutor_id() and r.status = 'published')
      )
  )
);

drop policy if exists "quality staff insert project evaluations" on public.review_project_evaluations;
create policy "quality staff insert project evaluations"
on public.review_project_evaluations for insert to authenticated
with check (
  exists (
    select 1 from public.reviews r
    where r.id = review_id
      and (
        public.current_role() in ('super_admin', 'admin', 'qtl')
        or (public.current_role() = 'qc' and r.evaluator_id = auth.uid())
      )
  )
);

drop policy if exists "quality staff update project evaluations" on public.review_project_evaluations;
create policy "quality staff update project evaluations"
on public.review_project_evaluations for update to authenticated
using (
  exists (
    select 1 from public.reviews r
    where r.id = review_id
      and (
        public.current_role() in ('super_admin', 'admin', 'qtl')
        or (public.current_role() = 'qc' and r.evaluator_id = auth.uid())
      )
  )
)
with check (
  exists (
    select 1 from public.reviews r
    where r.id = review_id
      and (
        public.current_role() in ('super_admin', 'admin', 'qtl')
        or (public.current_role() = 'qc' and r.evaluator_id = auth.uid())
      )
  )
);

drop policy if exists "quality staff delete project evaluations" on public.review_project_evaluations;
create policy "quality staff delete project evaluations"
on public.review_project_evaluations for delete to authenticated
using (
  exists (
    select 1 from public.reviews r
    where r.id = review_id
      and (
        public.current_role() in ('super_admin', 'admin', 'qtl')
        or (public.current_role() = 'qc' and r.evaluator_id = auth.uid())
      )
  )
);

grant select, insert, update, delete on public.evaluation_cycles to authenticated;
grant select, insert, update, delete on public.project_evaluation_metrics to authenticated;
grant select, insert, update, delete on public.review_project_evaluations to authenticated;
grant execute on function public.recalculate_review_total(uuid) to authenticated;

commit;
