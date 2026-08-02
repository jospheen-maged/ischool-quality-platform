-- iSchool Quality Platform: initial database schema
-- Apply with the Supabase CLI or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;

create type public.user_role as enum ('super_admin', 'admin', 'qtl', 'qc', 'tutor');
create type public.review_status as enum ('draft', 'submitted', 'returned', 'awaiting_approval', 'published', 'closed', 'reopened');
create type public.criterion_type as enum ('rating', 'compliance');
create type public.compliance_result as enum ('passed', 'violated', 'not_applicable');
create type public.flag_level as enum ('yellow', 'red');
create type public.objection_status as enum ('submitted', 'under_review', 'evidence_required', 'awaiting_qtl', 'decision_issued', 'closed');
create type public.objection_target as enum ('flag', 'criterion_score', 'comment', 'calculation', 'complete_review');
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
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutors(id) on delete restrict,
  evaluator_id uuid not null references public.profiles(id) on delete restrict,
  template_id uuid references public.evaluation_templates(id) on delete restrict default '00000000-0000-0000-0000-000000000001',
  session_date date not null,
  branch_name text,
  course_track text,
  session_topic text,
  session_type text not null check (session_type in ('group', 'one_to_one')),
  external_session_id text,
  recording_url text,
  status public.review_status not null default 'draft',
  total_score numeric(8,2),
  maximum_score numeric(8,2),
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

create table public.review_scores (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  criterion_id uuid not null references public.evaluation_criteria(id) on delete restrict,
  numeric_score numeric(6,2),
  compliance_result public.compliance_result,
  timestamp_seconds integer check (timestamp_seconds is null or timestamp_seconds >= 0),
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, criterion_id),
  check (
    (numeric_score is not null and compliance_result is null)
    or (numeric_score is null and compliance_result is not null)
  )
);

create table public.review_feedback (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.reviews(id) on delete cascade,
  strengths text,
  developmental_areas text,
  required_action text,
  coaching_focus text,
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
          select 1 from public.objections o
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
        or (r.evaluator_id = auth.uid() and r.status in ('draft', 'submitted', 'returned', 'reopened'))
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

-- Automatically generate Yellow/Red flags from violated compliance criteria.
create or replace function public.sync_compliance_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor_id uuid;
  v_has_history boolean;
begin
  select tutor_id into v_tutor_id from public.reviews where id = new.review_id;

  if new.compliance_result = 'violated' then
    select exists (
      select 1
      from public.review_flags rf
      where rf.tutor_id = v_tutor_id
        and rf.criterion_id = new.criterion_id
        and rf.review_id <> new.review_id
    ) into v_has_history;

    insert into public.review_flags (
      review_id, tutor_id, criterion_id, source_score_id, level, is_repeated, is_active
    ) values (
      new.review_id,
      v_tutor_id,
      new.criterion_id,
      new.id,
      case when v_has_history then 'red'::public.flag_level else 'yellow'::public.flag_level end,
      v_has_history,
      true
    )
    on conflict (review_id, criterion_id)
    do update set
      source_score_id = excluded.source_score_id,
      level = excluded.level,
      is_repeated = excluded.is_repeated,
      is_active = true,
      removal_reason = null,
      removal_approved_by = null,
      removed_at = null,
      updated_at = now();
  else
    update public.review_flags
    set is_active = false, updated_at = now()
    where review_id = new.review_id and criterion_id = new.criterion_id;
  end if;

  return new;
end;
$$;

create trigger review_scores_sync_flag
after insert or update of compliance_result on public.review_scores
for each row execute procedure public.sync_compliance_flag();

-- Immutable change history for critical workflow tables.
create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, table_name, record_id, action, old_data, new_data)
  values (
    auth.uid(),
    tg_table_name,
    coalesce(new.id, old.id),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_reviews after insert or update or delete on public.reviews for each row execute procedure public.write_audit_log();
create trigger audit_review_flags after insert or update or delete on public.review_flags for each row execute procedure public.write_audit_log();
create trigger audit_objections after insert or update or delete on public.objections for each row execute procedure public.write_audit_log();

-- Seed the uploaded onsite evaluation form.
insert into public.evaluation_templates (id, name, version, description, is_active)
values ('00000000-0000-0000-0000-000000000001', 'iSchool Onsite Session Evaluation', 1, 'ELEOT learning environments plus iSchool compliance criteria.', true);

insert into public.evaluation_sections (id, template_id, title, description, sort_order) values
('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', '1. Equitable Learning Environment', 'Equal opportunities and differentiated support for students.', 1),
('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', '2. High Expectations Environment', 'Challenge students and set a high standard for their work.', 2),
('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', '3. Supportive Learning Environment', 'A positive and safe environment for students to make mistakes.', 3),
('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', '4. Active Learning Environment', 'Students actively engage in hands-on learning.', 4),
('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', '5. Progress Monitoring and Feedback Environment', 'Checks for understanding and actionable feedback.', 5),
('00000000-0000-0000-0001-000000000006', '00000000-0000-0000-0000-000000000001', '6. Well-Managed Learning Environment', 'An organized, respectful, and focused classroom.', 6),
('00000000-0000-0000-0001-000000000007', '00000000-0000-0000-0000-000000000001', '7. Digital Learning Environment', 'Effective use of educational technology and troubleshooting.', 7),
('00000000-0000-0000-0001-000000000008', '00000000-0000-0000-0000-000000000001', 'iSchool Rules and Guidelines Compliance', 'A violation creates a Yellow Flag; a repeated violation escalates to Red.', 8);

insert into public.evaluation_criteria (section_id, code, title, description, criterion_type, max_score, sort_order) values
('00000000-0000-0000-0001-000000000001', 'ELEOT-01', 'Equal student engagement', 'Engages all students equally, regardless of background, gender, or skill level.', 'rating', 5, 1),
('00000000-0000-0000-0001-000000000001', 'ELEOT-02', 'Differentiated support', 'Provides differentiated support to students who are struggling with the material.', 'rating', 5, 2),
('00000000-0000-0000-0001-000000000002', 'ELEOT-03', 'Higher-order thinking', 'Asks higher-order thinking questions such as why code failed or how it can improve.', 'rating', 5, 1),
('00000000-0000-0000-0001-000000000002', 'ELEOT-04', 'High-quality student work', 'Encourages students to produce high-quality work rather than only finish the task.', 'rating', 5, 2),
('00000000-0000-0000-0001-000000000003', 'ELEOT-05', 'Positive and encouraging demeanor', 'Demonstrates a positive, approachable, and encouraging demeanor.', 'rating', 5, 1),
('00000000-0000-0000-0001-000000000003', 'ELEOT-06', 'Positive response to mistakes', 'Uses student mistakes as learning opportunities.', 'rating', 5, 2),
('00000000-0000-0000-0001-000000000004', 'ELEOT-07', 'Hands-on application', 'Facilitates hands-on activities, coding, and practical application.', 'rating', 5, 1),
('00000000-0000-0000-0001-000000000004', 'ELEOT-08', 'Student activity time', 'Ensures student talk and activity time outweighs instructor lecture time.', 'rating', 5, 2),
('00000000-0000-0000-0001-000000000005', 'ELEOT-09', 'Progress checks', 'Regularly checks student screens and progress during practical tasks.', 'rating', 5, 1),
('00000000-0000-0000-0001-000000000005', 'ELEOT-10', 'Specific immediate feedback', 'Provides specific, constructive, and immediate feedback.', 'rating', 5, 2),
('00000000-0000-0000-0001-000000000006', 'ELEOT-11', 'Behavior management', 'Manages student behavior effectively and maintains a respectful classroom culture.', 'rating', 5, 1),
('00000000-0000-0000-0001-000000000006', 'ELEOT-12', 'Smooth transitions', 'Transitions smoothly between activities without wasting session time.', 'rating', 5, 2),
('00000000-0000-0000-0001-000000000007', 'ELEOT-13', 'Effective technology use', 'Uses educational technology, software, and platforms effectively to enhance learning.', 'rating', 5, 1),
('00000000-0000-0000-0001-000000000007', 'ELEOT-14', 'Technical troubleshooting', 'Helps students troubleshoot technical issues efficiently without disrupting the class.', 'rating', 5, 2),
('00000000-0000-0000-0001-000000000008', 'COMP-01', 'Dress Code', 'Instructor wears proper, professional attire.', 'compliance', 0, 1),
('00000000-0000-0000-0001-000000000008', 'COMP-02', 'Overall Attitude', 'Instructor maintains a professional and appropriate attitude with students and venue staff.', 'compliance', 0, 2),
('00000000-0000-0000-0001-000000000008', 'COMP-03', 'Punctuality', 'Instructor starts the session exactly on time.', 'compliance', 0, 3),
('00000000-0000-0000-0001-000000000008', 'COMP-04', 'Session Sequence', 'Instructor follows the designated flow and sequence of the session.', 'compliance', 0, 4),
('00000000-0000-0000-0001-000000000008', 'COMP-05', 'Correct Lesson', 'Instructor explains the correct lesson according to the curriculum schedule.', 'compliance', 0, 5),
('00000000-0000-0000-0001-000000000008', 'COMP-06', 'Assigned Language', 'Instructor uses the correct assigned language and proper terminology.', 'compliance', 0, 6),
('00000000-0000-0000-0001-000000000008', 'COMP-07', 'Laptop Prepared', 'Instructor laptop is fully charged, updated, and ready before the session.', 'compliance', 0, 7),
('00000000-0000-0000-0001-000000000008', 'COMP-08', 'Slides Prepared', 'Presentation slides are open and ready before the session starts.', 'compliance', 0, 8),
('00000000-0000-0000-0001-000000000008', 'COMP-09', 'Instructor Readiness', 'Instructor studied the session and demonstrates mastery of the topic.', 'compliance', 0, 9),
('00000000-0000-0000-0001-000000000008', 'COMP-10', 'Homework Checking', 'Instructor checks students previously assigned homework or tasks.', 'compliance', 0, 10),
('00000000-0000-0000-0001-000000000008', 'COMP-11', 'Homework Assignment', 'Instructor ensures students receive required to-do homework by the end of the session.', 'compliance', 0, 11);

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

create policy "authenticated profiles are visible internally"
on public.profiles for select to authenticated
using (is_active or id = auth.uid());

create policy "admins manage profiles"
on public.profiles for all to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

create policy "authenticated users read active teams"
on public.teams for select to authenticated using (is_active or public.is_admin_like());
create policy "admins manage teams"
on public.teams for all to authenticated using (public.is_admin_like()) with check (public.is_admin_like());

create policy "authenticated users read active branches"
on public.branches for select to authenticated using (is_active or public.is_admin_like());
create policy "admins manage branches"
on public.branches for all to authenticated using (public.is_admin_like()) with check (public.is_admin_like());

create policy "staff read tutors and tutors read self"
on public.tutors for select to authenticated
using (public.is_staff() or user_id = auth.uid());
create policy "admins manage tutors"
on public.tutors for all to authenticated
using (public.is_admin_like()) with check (public.is_admin_like());

create policy "authenticated users read active templates"
on public.evaluation_templates for select to authenticated using (is_active or public.is_admin_like());
create policy "admins manage templates"
on public.evaluation_templates for all to authenticated using (public.is_admin_like()) with check (public.is_admin_like());

create policy "authenticated users read sections"
on public.evaluation_sections for select to authenticated using (true);
create policy "admins manage sections"
on public.evaluation_sections for all to authenticated using (public.is_admin_like()) with check (public.is_admin_like());

create policy "authenticated users read criteria"
on public.evaluation_criteria for select to authenticated using (is_active or public.is_admin_like());
create policy "admins manage criteria"
on public.evaluation_criteria for all to authenticated using (public.is_admin_like()) with check (public.is_admin_like());

create policy "role-scoped review visibility"
on public.reviews for select to authenticated
using (public.can_view_review(id));

create policy "quality staff create reviews"
on public.reviews for insert to authenticated
with check (public.current_role() in ('super_admin', 'admin', 'qtl', 'qc') and evaluator_id = auth.uid());

create policy "review owner or admin updates editable reviews"
on public.reviews for update to authenticated
using (public.can_edit_review(id))
with check (public.can_edit_review(id));

create policy "admins delete reviews"
on public.reviews for delete to authenticated using (public.is_admin_like());

create policy "scores follow review visibility"
on public.review_scores for select to authenticated using (public.can_view_review(review_id));
create policy "scores follow review editing"
on public.review_scores for insert to authenticated with check (public.can_edit_review(review_id));
create policy "scores follow review editing update"
on public.review_scores for update to authenticated using (public.can_edit_review(review_id)) with check (public.can_edit_review(review_id));
create policy "scores follow review editing delete"
on public.review_scores for delete to authenticated using (public.can_edit_review(review_id));

create policy "feedback follows review visibility"
on public.review_feedback for select to authenticated using (public.can_view_review(review_id));
create policy "feedback follows review editing"
on public.review_feedback for insert to authenticated with check (public.can_edit_review(review_id));
create policy "feedback follows review editing update"
on public.review_feedback for update to authenticated using (public.can_edit_review(review_id)) with check (public.can_edit_review(review_id));

create policy "flags follow review visibility"
on public.review_flags for select to authenticated using (public.can_view_review(review_id));
create policy "admins manage flags"
on public.review_flags for update to authenticated using (public.is_admin_like()) with check (public.is_admin_like());

create policy "role-scoped objection visibility"
on public.objections for select to authenticated
using (
  public.is_admin_like()
  or tutor_id = public.current_tutor_id()
  or assigned_reviewer_id = auth.uid()
  or (
    public.current_role() = 'qc'
    and assigned_reviewer_id is null
    and exists (select 1 from public.reviews r where r.id = review_id and r.evaluator_id <> auth.uid())
  )
);

create policy "tutors submit objections to own published reviews"
on public.objections for insert to authenticated
with check (
  tutor_id = public.current_tutor_id()
  and submitted_by = auth.uid()
  and exists (
    select 1 from public.reviews r
    where r.id = review_id and r.tutor_id = public.current_tutor_id() and r.status = 'published'
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
    and exists (select 1 from public.reviews r where r.id = review_id and r.evaluator_id <> auth.uid())
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
  or (objection_id is not null and exists (select 1 from public.objections o where o.id = objection_id and (o.tutor_id = public.current_tutor_id() or o.assigned_reviewer_id = auth.uid())))
);

create policy "authenticated users add own attachments"
on public.attachments for insert to authenticated
with check (uploaded_by = auth.uid());

create policy "admins and uploaders delete attachments"
on public.attachments for delete to authenticated
using (public.is_admin_like() or uploaded_by = auth.uid());

create policy "admins and qtl read audit logs"
on public.audit_logs for select to authenticated using (public.is_admin_like());

-- Analytics views use the caller's RLS permissions.
create view public.analytics_overview
with (security_invoker = true)
as
select
  (select count(*)::integer from public.reviews) as total_reviews,
  (select count(*)::integer from public.reviews where status = 'published') as published_reviews,
  (select round(avg(score_percentage), 2) from public.reviews where score_percentage is not null) as average_score_percentage,
  (select count(*)::integer from public.review_flags where is_active) as active_flags,
  (select count(*)::integer from public.objections where status in ('submitted', 'under_review', 'evidence_required', 'awaiting_qtl')) as open_objections;

create view public.analytics_criteria
with (security_invoker = true)
as
select
  c.code as criterion_code,
  c.title as criterion_title,
  round(avg(rs.numeric_score), 2) as average_score,
  count(rs.id)::integer as response_count
from public.evaluation_criteria c
join public.review_scores rs on rs.criterion_id = c.id
join public.reviews r on r.id = rs.review_id
where c.criterion_type = 'rating'
  and r.status in ('submitted', 'awaiting_approval', 'published', 'closed')
group by c.code, c.title;

-- Private evidence bucket. File paths should start with the uploader's user id.
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
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
);

create policy "uploader and admins delete evidence"
on storage.objects for delete to authenticated
using (
  bucket_id = 'quality-evidence'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin_like())
);

-- Explicit grants; RLS remains the authorization layer.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.analytics_overview, public.analytics_criteria to authenticated;
grant usage, select on all sequences in schema public to authenticated;
