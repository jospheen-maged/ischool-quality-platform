-- iSchool Quality Platform: initial database schema
-- Aligned with the July 2026 Onsite School Quality Evaluation proposal.
-- Run once in a new Supabase project from SQL Editor.

begin;

create extension if not exists pgcrypto;

create type public.user_role as enum ('super_admin', 'admin', 'qtl', 'qc', 'tutor');
create type public.review_status as enum ('draft', 'submitted', 'returned', 'awaiting_approval', 'published', 'closed', 'reopened');
create type public.criterion_type as enum ('rating', 'compliance');
create type public.compliance_result as enum (
  'clear',
  'coaching_note',
  'yellow_flag',
  'red_flag',
  'external_cause',
  'not_applicable'
);
create type public.compliance_status as enum ('clear', 'coaching_note', 'yellow_flag', 'red_flag');
create type public.flag_level as enum ('yellow', 'red');
create type public.observation_scope as enum ('full_session', 'partial_session');
create type public.learning_outcome_status as enum ('achieved', 'partially_achieved', 'not_achieved', 'not_observed');
create type public.follow_up_status as enum ('none', 'routine', 'required', 'urgent');
create type public.objection_status as enum ('submitted', 'under_review', 'evidence_required', 'awaiting_qtl', 'decision_issued', 'closed');
create type public.objection_target as enum ('flag', 'criterion_score', 'feedback', 'calculation', 'complete_review');
create type public.objection_decision as enum ('accepted', 'partially_accepted', 'rejected', 'more_evidence_required', 'outside_scope');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  role public.user_role not null default 'tutor',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.tutors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  employee_code text not null unique,
  full_name text not null,
  email text,
  team_id uuid references public.teams(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column tutor_id uuid unique references public.tutors(id) on delete set null;

create table public.evaluation_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null default 1,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, version)
);

create table public.evaluation_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.evaluation_templates(id) on delete cascade,
  title text not null,
  description text,
  sort_order integer not null default 0,
  is_scored boolean not null default true,
  created_at timestamptz not null default now(),
  unique (template_id, title)
);

create table public.evaluation_criteria (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.evaluation_sections(id) on delete cascade,
  code text not null unique,
  title text not null,
  description text,
  criterion_type public.criterion_type not null,
  max_score numeric(6,2) not null default 0 check (max_score >= 0),
  weight_percentage numeric(6,2) not null default 0 check (weight_percentage between 0 and 100),
  anchor_1 text,
  anchor_3 text,
  anchor_5 text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id) on delete restrict,
  evaluator_id uuid not null references public.profiles(id) on delete restrict,
  template_id uuid references public.evaluation_templates(id) on delete restrict
    default '00000000-0000-0000-0000-000000000001',
  session_date date not null,
  school_branch text,
  course_track text,
  session_topic text,
  session_type text not null check (session_type in ('group', 'one_to_one')),
  external_session_id text,
  recording_url text,

  students_present integer check (students_present is null or students_present >= 0),
  age_level text,
  observation_scope public.observation_scope not null default 'full_session',
  observation_minutes integer check (observation_minutes is null or observation_minutes > 0),
  environment_readiness text,
  intended_learning_outcome text,
  external_school_cause text,
  context_details text,

  learning_outcome_status public.learning_outcome_status not null default 'not_observed',
  follow_up_status public.follow_up_status not null default 'none',
  compliance_status public.compliance_status not null default 'clear',

  status public.review_status not null default 'draft',
  total_score numeric(8,2),
  maximum_score numeric(8,2),
  observed_weight numeric(8,2),
  score_percentage numeric(6,2) check (score_percentage between 0 and 100),
  submitted_at timestamptz,
  published_at timestamptz,
  published_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reviews_tutor_idx on public.reviews(tutor_id, session_date desc);
create index reviews_evaluator_idx on public.reviews(evaluator_id, created_at desc);
create index reviews_status_idx on public.reviews(status);
create index reviews_branch_idx on public.reviews(school_branch);

create table public.review_scores (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  criterion_id uuid not null references public.evaluation_criteria(id) on delete restrict,

  numeric_score numeric(6,2),
  is_observed boolean not null default true,

  compliance_result public.compliance_result,
  is_applicable boolean,
  is_external boolean not null default false,
  external_details text,
  severity_reason text,
  is_repeated boolean not null default false,

  timestamp_seconds integer check (timestamp_seconds is null or timestamp_seconds >= 0),
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, criterion_id),

  check (
    (
      compliance_result is null
      and is_applicable is null
      and (
        (is_observed = true and numeric_score between 1 and 5)
        or (is_observed = false and numeric_score is null)
      )
    )
    or
    (
      numeric_score is null
      and compliance_result is not null
      and is_applicable is not null
    )
  )
);

create table public.review_feedback (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.reviews(id) on delete cascade,
  observed_strength text,
  development_priority text,
  student_impact text,
  required_action text,
  follow_up_plan text,
  internal_notes text,
  follow_up_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_flags (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  tutor_id uuid not null references public.tutors(id) on delete restrict,
  criterion_id uuid not null references public.evaluation_criteria(id) on delete restrict,
  source_score_id uuid references public.review_scores(id) on delete set null,
  level public.flag_level not null,
  is_repeated boolean not null default false,
  is_active boolean not null default true,
  severity_reason text,
  removal_reason text,
  removal_approved_by uuid references public.profiles(id) on delete set null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, criterion_id)
);

create index review_flags_tutor_idx on public.review_flags(tutor_id, is_active, created_at desc);

create table public.objections (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  tutor_id uuid not null references public.tutors(id) on delete restrict,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  assigned_reviewer_id uuid references public.profiles(id) on delete set null,
  object_type public.objection_target not null,
  target_score_id uuid references public.review_scores(id) on delete set null,
  target_flag_id uuid references public.review_flags(id) on delete set null,
  target_feedback_field text,
  reason_code text not null,
  explanation text not null check (char_length(trim(explanation)) >= 10),
  requested_outcome text,
  status public.objection_status not null default 'submitted',
  decision public.objection_decision,
  decision_notes text,
  score_changed boolean not null default false,
  flag_changed boolean not null default false,
  qtl_approved_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  decision_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index objections_status_idx on public.objections(status, created_at desc);
create index objections_reviewer_idx on public.objections(assigned_reviewer_id, status);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  review_id uuid references public.reviews(id) on delete cascade,
  objection_id uuid references public.objections(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  created_at timestamptz not null default now(),
  check ((review_id is not null)::integer + (objection_id is not null)::integer = 1)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_record_idx on public.audit_logs(table_name, record_id, created_at desc);

-- Authentication/profile helpers
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.email,
    'tutor'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_tutor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tutor_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() in ('super_admin', 'admin', 'qtl', 'qc'), false);
$$;

create or replace function public.is_admin_like()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() in ('super_admin', 'admin', 'qtl'), false);
$$;

create or replace function public.can_view_review(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reviews r
    where r.id = p_review_id
      and (
        public.is_admin_like()
        or r.evaluator_id = auth.uid()
        or (r.status = 'published' and r.tutor_id = public.current_tutor_id())
        or exists (
          select 1
          from public.objections o
          where o.review_id = r.id and o.assigned_reviewer_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_edit_review(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reviews r
    where r.id = p_review_id
      and (
        public.is_admin_like()
        or (
          r.evaluator_id = auth.uid()
          and r.status in ('draft', 'submitted', 'returned', 'reopened')
        )
      )
  );
$$;

-- Common updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger tutors_set_updated_at before update on public.tutors for each row execute procedure public.set_updated_at();
create trigger reviews_set_updated_at before update on public.reviews for each row execute procedure public.set_updated_at();
create trigger review_scores_set_updated_at before update on public.review_scores for each row execute procedure public.set_updated_at();
create trigger review_feedback_set_updated_at before update on public.review_feedback for each row execute procedure public.set_updated_at();
create trigger review_flags_set_updated_at before update on public.review_flags for each row execute procedure public.set_updated_at();
create trigger objections_set_updated_at before update on public.objections for each row execute procedure public.set_updated_at();

-- Mark recurrence for follow-up priority only. Recurrence never changes severity automatically.
create or replace function public.mark_repeated_compliance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor_id uuid;
begin
  if new.compliance_result is null then
    new.is_repeated := false;
    return new;
  end if;

  select tutor_id into v_tutor_id
  from public.reviews
  where id = new.review_id;

  select exists (
    select 1
    from public.review_scores prior_score
    join public.reviews prior_review on prior_review.id = prior_score.review_id
    where prior_review.tutor_id = v_tutor_id
      and prior_score.criterion_id = new.criterion_id
      and prior_score.review_id <> new.review_id
      and prior_score.compliance_result in ('coaching_note', 'yellow_flag', 'red_flag')
  )
  into new.is_repeated;

  return new;
end;
$$;

create trigger review_scores_mark_repeated
before insert or update of compliance_result, criterion_id, review_id
on public.review_scores
for each row execute procedure public.mark_repeated_compliance();

-- Weighted teaching score. Unobserved dimensions are excluded and never guessed.
create or replace function public.recalculate_teaching_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id uuid;
  v_earned numeric(8,2);
  v_observed_weight numeric(8,2);
  v_percentage numeric(6,2);
begin
  v_review_id := case when tg_op = 'DELETE' then old.review_id else new.review_id end;

  select
    coalesce(sum((rs.numeric_score / 5.0) * c.weight_percentage) filter (
      where c.criterion_type = 'rating' and rs.is_observed and rs.numeric_score is not null
    ), 0),
    coalesce(sum(c.weight_percentage) filter (
      where c.criterion_type = 'rating' and rs.is_observed and rs.numeric_score is not null
    ), 0)
  into v_earned, v_observed_weight
  from public.review_scores rs
  join public.evaluation_criteria c on c.id = rs.criterion_id
  where rs.review_id = v_review_id;

  v_percentage := case
    when v_observed_weight > 0 then round((v_earned / v_observed_weight) * 100, 2)
    else null
  end;

  update public.reviews
  set
    total_score = round(v_earned, 2),
    maximum_score = round(v_observed_weight, 2),
    observed_weight = round(v_observed_weight, 2),
    score_percentage = v_percentage
  where id = v_review_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger review_scores_recalculate_teaching
after insert or update or delete on public.review_scores
for each row execute procedure public.recalculate_teaching_score();

-- Synchronise chosen compliance severity and active flags.
create or replace function public.sync_compliance_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id uuid;
  v_criterion_id uuid;
  v_tutor_id uuid;
  v_status public.compliance_status;
begin
  v_review_id := case when tg_op = 'DELETE' then old.review_id else new.review_id end;
  v_criterion_id := case when tg_op = 'DELETE' then old.criterion_id else new.criterion_id end;

  select tutor_id into v_tutor_id
  from public.reviews
  where id = v_review_id;

  if tg_op = 'DELETE' then
    update public.review_flags
    set is_active = false, updated_at = now()
    where review_id = v_review_id and criterion_id = v_criterion_id;
  elsif new.compliance_result = 'yellow_flag' then
    insert into public.review_flags (
      review_id, tutor_id, criterion_id, source_score_id, level,
      is_repeated, is_active, severity_reason
    )
    values (
      v_review_id, v_tutor_id, v_criterion_id, new.id, 'yellow',
      new.is_repeated, true, new.severity_reason
    )
    on conflict (review_id, criterion_id)
    do update set
      source_score_id = excluded.source_score_id,
      level = excluded.level,
      is_repeated = excluded.is_repeated,
      is_active = true,
      severity_reason = excluded.severity_reason,
      removal_reason = null,
      removal_approved_by = null,
      removed_at = null,
      updated_at = now();
  elsif new.compliance_result = 'red_flag' then
    insert into public.review_flags (
      review_id, tutor_id, criterion_id, source_score_id, level,
      is_repeated, is_active, severity_reason
    )
    values (
      v_review_id, v_tutor_id, v_criterion_id, new.id, 'red',
      new.is_repeated, true, new.severity_reason
    )
    on conflict (review_id, criterion_id)
    do update set
      source_score_id = excluded.source_score_id,
      level = excluded.level,
      is_repeated = excluded.is_repeated,
      is_active = true,
      severity_reason = excluded.severity_reason,
      removal_reason = null,
      removal_approved_by = null,
      removed_at = null,
      updated_at = now();
  else
    update public.review_flags
    set is_active = false, updated_at = now()
    where review_id = v_review_id and criterion_id = v_criterion_id;
  end if;

  select case
    when exists (
      select 1 from public.review_scores
      where review_id = v_review_id and compliance_result = 'red_flag'
    ) then 'red_flag'::public.compliance_status
    when exists (
      select 1 from public.review_scores
      where review_id = v_review_id and compliance_result = 'yellow_flag'
    ) then 'yellow_flag'::public.compliance_status
    when exists (
      select 1 from public.review_scores
      where review_id = v_review_id and compliance_result = 'coaching_note'
    ) then 'coaching_note'::public.compliance_status
    else 'clear'::public.compliance_status
  end
  into v_status;

  update public.reviews
  set compliance_status = v_status
  where id = v_review_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger review_scores_sync_compliance
after insert or update or delete on public.review_scores
for each row execute procedure public.sync_compliance_outcome();

-- Immutable change history for critical workflow tables.
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id uuid;
begin
  v_record_id := case when tg_op = 'DELETE' then old.id else new.id end;

  insert into public.audit_logs (
    actor_id, table_name, record_id, action, old_data, new_data
  )
  values (
    auth.uid(),
    tg_table_name,
    v_record_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger audit_reviews after insert or update or delete on public.reviews for each row execute procedure public.write_audit_log();
create trigger audit_review_scores after insert or update or delete on public.review_scores for each row execute procedure public.write_audit_log();
create trigger audit_review_feedback after insert or update or delete on public.review_feedback for each row execute procedure public.write_audit_log();
create trigger audit_review_flags after insert or update or delete on public.review_flags for each row execute procedure public.write_audit_log();
create trigger audit_objections after insert or update or delete on public.objections for each row execute procedure public.write_audit_log();

-- Seed the July 2026 onsite quality model.
insert into public.evaluation_templates (
  id, name, version, description, is_active
)
values (
  '00000000-0000-0000-0000-000000000001',
  'iSchool Onsite School Quality Evaluation',
  2,
  'Unscored context, six weighted teaching-quality dimensions, separate compliance severity, and one priority development action.',
  true
);

insert into public.evaluation_sections (
  id, template_id, title, description, sort_order, is_scored
)
values
(
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Teaching Quality',
  'Six weighted dimensions that measure visible student learning and tutor practice.',
  1,
  true
),
(
  '00000000-0000-0000-0001-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'iSchool Rules and Guidelines Compliance',
  'Compliance is classified separately after applicability, external cause, impact, and seriousness are considered.',
  2,
  false
);

insert into public.evaluation_criteria (
  section_id, code, title, description, criterion_type, max_score,
  weight_percentage, anchor_1, anchor_3, anchor_5, sort_order
)
values
(
  '00000000-0000-0000-0001-000000000001',
  'TQ-01',
  'Learning Outcome & Technical Accuracy',
  'End-of-session evidence and technical correctness.',
  'rating',
  5,
  25,
  'The intended learning outcome is not demonstrated, or technical errors remain unresolved.',
  'Most students demonstrate the intended outcome with generally correct technical work.',
  'Every observed student demonstrates the outcome independently and the technical work is accurate.',
  1
),
(
  '00000000-0000-0000-0001-000000000001',
  'TQ-02',
  'Active Learning & Practical Application',
  'Hands-on work, testing, discussion, and student ownership.',
  'rating',
  5,
  20,
  'Students are mainly passive and have little opportunity to practise or test ideas.',
  'Students complete meaningful practical work with appropriate tutor guidance.',
  'Students actively build, test, discuss, and make decisions with strong ownership.',
  2
),
(
  '00000000-0000-0000-0001-000000000001',
  'TQ-03',
  'Engagement & Inclusion',
  'Balanced participation and differentiated support.',
  'rating',
  5,
  15,
  'Participation is uneven and some students receive limited attention or support.',
  'Most students participate and support is adjusted for common differences in need.',
  'Every student is actively included, challenged, and supported according to need.',
  3
),
(
  '00000000-0000-0000-0001-000000000001',
  'TQ-04',
  'Explanation & Questioning',
  'Clarity, reasoning questions, and adaptation.',
  'rating',
  5,
  15,
  'Explanations are unclear or mainly procedural, with little checking or reasoning.',
  'Explanations are clear and include useful questions that reveal understanding.',
  'Explanations and questioning continuously adapt to student thinking and deepen reasoning.',
  4
),
(
  '00000000-0000-0000-0001-000000000001',
  'TQ-05',
  'Progress Monitoring & Feedback',
  'Screen checks, misconception diagnosis, and actionable feedback.',
  'rating',
  5,
  15,
  'Rarely checks student work; errors remain unnoticed.',
  'Checks most students and gives useful corrective feedback.',
  'Continuously monitors every student and gives immediate, actionable feedback.',
  5
),
(
  '00000000-0000-0000-0001-000000000001',
  'TQ-06',
  'Classroom & Time Management',
  'Behaviour, pacing, transitions, and protected learning time.',
  'rating',
  5,
  10,
  'Behaviour, pacing, or transitions significantly reduce learning time.',
  'The class is respectful and the session generally moves at an effective pace.',
  'Behaviour, pacing, and transitions are consistently managed to maximise learning time.',
  6
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-01',
  'Dress Code',
  'Instructor wears proper, professional attire.',
  'compliance',
  0, 0, null, null, null, 1
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-02',
  'Overall Attitude',
  'Instructor maintains a professional and appropriate attitude with students and venue staff.',
  'compliance',
  0, 0, null, null, null, 2
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-03',
  'Punctuality',
  'Instructor starts within the approved tolerance after external school causes are excluded.',
  'compliance',
  0, 0, null, null, null, 3
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-04',
  'Session Sequence',
  'Instructor follows the designated learning flow and required session components.',
  'compliance',
  0, 0, null, null, null, 4
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-05',
  'Correct Lesson',
  'Instructor teaches the correct lesson according to the curriculum schedule.',
  'compliance',
  0, 0, null, null, null, 5
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-06',
  'Assigned Language',
  'Instructor uses the assigned language and appropriate terminology.',
  'compliance',
  0, 0, null, null, null, 6
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-07',
  'Laptop Prepared',
  'Instructor laptop is charged, updated, and ready before the session.',
  'compliance',
  0, 0, null, null, null, 7
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-08',
  'Slides Prepared',
  'Required presentation materials are open and ready before the session.',
  'compliance',
  0, 0, null, null, null, 8
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-09',
  'Instructor Readiness',
  'Instructor demonstrates preparation and mastery of the session topic.',
  'compliance',
  0, 0, null, null, null, 9
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-10',
  'Homework Checking',
  'Instructor checks previously assigned student work when applicable.',
  'compliance',
  0, 0, null, null, null, 10
),
(
  '00000000-0000-0000-0001-000000000002',
  'COMP-11',
  'Homework Assignment',
  'Instructor clearly assigns the required follow-up work when applicable.',
  'compliance',
  0, 0, null, null, null, 11
);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.branches enable row level security;
alter table public.tutors enable row level security;
alter table public.evaluation_templates enable row level security;
alter table public.evaluation_sections enable row level security;
alter table public.evaluation_criteria enable row level security;
alter table public.reviews enable row level security;
alter table public.review_scores enable row level security;
alter table public.review_feedback enable row level security;
alter table public.review_flags enable row level security;
alter table public.objections enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_logs enable row level security;

create policy "users read own profile and staff read profiles"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_staff());

create policy "admins manage profiles"
on public.profiles for all to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy "authenticated users read active teams"
on public.teams for select to authenticated
using (is_active or public.is_admin_like());

create policy "admins manage teams"
on public.teams for all to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy "authenticated users read active branches"
on public.branches for select to authenticated
using (is_active or public.is_admin_like());

create policy "admins manage branches"
on public.branches for all to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy "staff read tutors and tutors read self"
on public.tutors for select to authenticated
using (public.is_staff() or user_id = auth.uid());

create policy "admins manage tutors"
on public.tutors for all to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy "authenticated users read active templates"
on public.evaluation_templates for select to authenticated
using (is_active or public.is_admin_like());

create policy "admins manage templates"
on public.evaluation_templates for all to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy "authenticated users read sections"
on public.evaluation_sections for select to authenticated
using (true);

create policy "admins manage sections"
on public.evaluation_sections for all to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy "authenticated users read active criteria"
on public.evaluation_criteria for select to authenticated
using (is_active or public.is_admin_like());

create policy "admins manage criteria"
on public.evaluation_criteria for all to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy "role scoped review visibility"
on public.reviews for select to authenticated
using (public.can_view_review(id));

create policy "quality staff create reviews"
on public.reviews for insert to authenticated
with check (
  public.current_role() in ('super_admin', 'admin', 'qtl', 'qc')
  and evaluator_id = auth.uid()
);

create policy "review owner or admin updates editable reviews"
on public.reviews for update to authenticated
using (public.can_edit_review(id))
with check (public.can_edit_review(id));

create policy "admins delete reviews"
on public.reviews for delete to authenticated
using (public.is_admin_like());

create policy "scores follow review visibility"
on public.review_scores for select to authenticated
using (public.can_view_review(review_id));

create policy "scores follow review editing"
on public.review_scores for insert to authenticated
with check (public.can_edit_review(review_id));

create policy "scores follow review editing update"
on public.review_scores for update to authenticated
using (public.can_edit_review(review_id))
with check (public.can_edit_review(review_id));

create policy "scores follow review editing delete"
on public.review_scores for delete to authenticated
using (public.can_edit_review(review_id));

create policy "feedback follows review visibility"
on public.review_feedback for select to authenticated
using (public.can_view_review(review_id));

create policy "feedback follows review editing"
on public.review_feedback for insert to authenticated
with check (public.can_edit_review(review_id));

create policy "feedback follows review editing update"
on public.review_feedback for update to authenticated
using (public.can_edit_review(review_id))
with check (public.can_edit_review(review_id));

create policy "flags follow review visibility"
on public.review_flags for select to authenticated
using (public.can_view_review(review_id));

create policy "admins manage flags"
on public.review_flags for update to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy "role scoped objection visibility"
on public.objections for select to authenticated
using (
  public.is_admin_like()
  or tutor_id = public.current_tutor_id()
  or assigned_reviewer_id = auth.uid()
  or (
    public.current_role() = 'qc'
    and assigned_reviewer_id is null
    and exists (
      select 1
      from public.reviews r
      where r.id = review_id and r.evaluator_id <> auth.uid()
    )
  )
);

create policy "tutors submit objections to own published reviews"
on public.objections for insert to authenticated
with check (
  tutor_id = public.current_tutor_id()
  and submitted_by = auth.uid()
  and exists (
    select 1
    from public.reviews r
    where r.id = review_id
      and r.tutor_id = public.current_tutor_id()
      and r.status = 'published'
  )
);

create policy "assigned quality staff update objections"
on public.objections for update to authenticated
using (
  public.is_admin_like()
  or assigned_reviewer_id = auth.uid()
  or (
    public.current_role() = 'qc'
    and assigned_reviewer_id is null
    and exists (
      select 1
      from public.reviews r
      where r.id = review_id and r.evaluator_id <> auth.uid()
    )
  )
)
with check (
  public.is_admin_like()
  or assigned_reviewer_id = auth.uid()
);

create policy "attachments follow linked records"
on public.attachments for select to authenticated
using (
  public.is_admin_like()
  or uploaded_by = auth.uid()
  or (review_id is not null and public.can_view_review(review_id))
  or (
    objection_id is not null
    and exists (
      select 1
      from public.objections o
      where o.id = objection_id
        and (
          o.tutor_id = public.current_tutor_id()
          or o.assigned_reviewer_id = auth.uid()
        )
    )
  )
);

create policy "authenticated users add own attachments"
on public.attachments for insert to authenticated
with check (uploaded_by = auth.uid());

create policy "admins and uploaders delete attachments"
on public.attachments for delete to authenticated
using (public.is_admin_like() or uploaded_by = auth.uid());

create policy "admins and qtl read audit logs"
on public.audit_logs for select to authenticated
using (public.is_admin_like());

-- Analytics views use the caller's RLS permissions.
create view public.analytics_overview
with (security_invoker = true)
as
select
  (select count(*)::integer from public.reviews) as total_reviews,
  (select count(*)::integer from public.reviews where status = 'published') as published_reviews,
  (select round(avg(score_percentage), 2) from public.reviews where score_percentage is not null) as average_teaching_score,
  (
    select round(
      100.0 * count(*) filter (where learning_outcome_status = 'achieved')
      / nullif(count(*) filter (where learning_outcome_status <> 'not_observed'), 0),
      2
    )
    from public.reviews
  ) as outcomes_fully_achieved_percentage,
  (
    select count(*)::integer
    from public.reviews
    where follow_up_status in ('required', 'urgent')
  ) as follow_ups_required,
  (
    select count(*)::integer
    from public.review_flags
    where is_active and level = 'yellow'
  ) as active_yellow_flags,
  (
    select count(*)::integer
    from public.review_flags
    where is_active and level = 'red'
  ) as active_red_flags,
  (
    select count(*)::integer
    from public.review_scores
    where compliance_result = 'external_cause'
  ) as external_causes_recorded,
  (
    select count(*)::integer
    from public.objections
    where status in ('submitted', 'under_review', 'evidence_required', 'awaiting_qtl')
  ) as open_objections;

create view public.analytics_dimensions
with (security_invoker = true)
as
select
  c.code as criterion_code,
  c.title as dimension_title,
  c.weight_percentage,
  round(avg(rs.numeric_score), 2) as average_rating,
  round(avg((rs.numeric_score / 5.0) * 100), 2) as average_percentage,
  count(rs.id)::integer as response_count
from public.evaluation_criteria c
join public.review_scores rs on rs.criterion_id = c.id
join public.reviews r on r.id = rs.review_id
where c.criterion_type = 'rating'
  and rs.is_observed
  and rs.numeric_score is not null
  and r.status in ('submitted', 'awaiting_approval', 'published', 'closed')
group by c.code, c.title, c.weight_percentage;

create view public.analytics_compliance_mix
with (security_invoker = true)
as
select
  rs.compliance_result,
  count(*)::integer as result_count
from public.review_scores rs
join public.evaluation_criteria c on c.id = rs.criterion_id
where c.criterion_type = 'compliance'
group by rs.compliance_result;

-- Private evidence bucket. File paths must start with the uploader's user id.
insert into storage.buckets (id, name, public, file_size_limit)
values ('quality-evidence', 'quality-evidence', false, 20971520)
on conflict (id) do nothing;

create policy "users upload evidence to own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'quality-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "uploader and staff read evidence"
on storage.objects for select to authenticated
using (
  bucket_id = 'quality-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_staff()
  )
);

create policy "uploader and admins delete evidence"
on storage.objects for delete to authenticated
using (
  bucket_id = 'quality-evidence'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin_like()
  )
);

-- Explicit grants; RLS remains the authorization layer.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.analytics_overview, public.analytics_dimensions, public.analytics_compliance_mix to authenticated;
grant usage, select on all sequences in schema public to authenticated;

commit;
