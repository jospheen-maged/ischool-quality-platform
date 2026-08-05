-- Dynamic evaluation model: Teaching 70%, Compliance 20%, Project 10%.
-- Safe to run once on the live Supabase project.

begin;

create table if not exists public.quality_model_settings (
  id boolean primary key default true check (id = true),
  teaching_weight numeric(6,2) not null default 70 check (teaching_weight between 0 and 100),
  compliance_weight numeric(6,2) not null default 20 check (compliance_weight between 0 and 100),
  project_weight numeric(6,2) not null default 10 check (project_weight between 0 and 100),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (teaching_weight + compliance_weight + project_weight = 100)
);

insert into public.quality_model_settings (id, teaching_weight, compliance_weight, project_weight)
values (true, 70, 20, 10)
on conflict (id) do nothing;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute procedure public.set_updated_at();

drop trigger if exists quality_model_settings_set_updated_at on public.quality_model_settings;
create trigger quality_model_settings_set_updated_at
before update on public.quality_model_settings
for each row execute procedure public.set_updated_at();

alter table public.reviews
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists project_score numeric(6,2) check (project_score is null or project_score between 1 and 5),
  add column if not exists project_weight_snapshot numeric(6,2) check (project_weight_snapshot is null or project_weight_snapshot between 0 and 100),
  add column if not exists teaching_percentage numeric(6,2) check (teaching_percentage is null or teaching_percentage between 0 and 100),
  add column if not exists compliance_percentage numeric(6,2) check (compliance_percentage is null or compliance_percentage between 0 and 100),
  add column if not exists project_percentage numeric(6,2) check (project_percentage is null or project_percentage between 0 and 100);

alter table public.reviews alter column session_date drop not null;
alter table public.reviews alter column session_type drop not null;
alter table public.reviews drop constraint if exists reviews_session_type_check;
alter table public.reviews add constraint reviews_session_type_check
  check (session_type is null or session_type in ('group', 'one_to_one'));

alter table public.review_scores
  add column if not exists weight_snapshot numeric(6,2)
  check (weight_snapshot is null or weight_snapshot between 0 and 100);

-- Preserve the historical score basis before changing the live metric weights.
update public.review_scores rs
set weight_snapshot = case
  when c.criterion_type = 'rating' then c.weight_percentage
  else 0
end
from public.evaluation_criteria c
where rs.criterion_id = c.id
  and rs.weight_snapshot is null;

-- Keep the proposal's relative metric mix while scaling Teaching Quality to 70%.
update public.evaluation_criteria set weight_percentage = 17.50 where code = 'TQ-01';
update public.evaluation_criteria set weight_percentage = 14.00 where code = 'TQ-02';
update public.evaluation_criteria set weight_percentage = 10.50 where code = 'TQ-03';
update public.evaluation_criteria set weight_percentage = 10.50 where code = 'TQ-04';
update public.evaluation_criteria set weight_percentage = 10.50 where code = 'TQ-05';
update public.evaluation_criteria set weight_percentage = 7.00 where code = 'TQ-06';

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
  v_project_score numeric(6,2);
  v_project_snapshot numeric(6,2);
  v_total_earned numeric(10,4);
  v_total_weight numeric(10,4);
  v_total_percentage numeric(6,2);
begin
  select
    coalesce(sum((rs.numeric_score / 5.0) * coalesce(rs.weight_snapshot, c.weight_percentage)) filter (
      where c.criterion_type = 'rating'
        and rs.is_observed
        and rs.numeric_score is not null
    ), 0),
    coalesce(sum(coalesce(rs.weight_snapshot, c.weight_percentage)) filter (
      where c.criterion_type = 'rating'
        and rs.is_observed
        and rs.numeric_score is not null
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

  select project_score, project_weight_snapshot
  into v_project_score, v_project_snapshot
  from public.reviews
  where id = p_review_id;

  if v_project_score is not null and coalesce(v_project_snapshot, 0) > 0 then
    v_project_weight := v_project_snapshot;
    v_project_earned := (v_project_score / 5.0) * v_project_weight;
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
    project_percentage = case when v_project_weight > 0 then round((v_project_earned / v_project_weight) * 100, 2) else null end
  where id = p_review_id;
end;
$$;

-- Keep the existing trigger name, but calculate the new composite score.
create or replace function public.recalculate_teaching_score()
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

create or replace function public.recalculate_review_project_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_review_total(new.id);
  return new;
end;
$$;

drop trigger if exists reviews_recalculate_project_score on public.reviews;
create trigger reviews_recalculate_project_score
after update of project_score, project_weight_snapshot on public.reviews
for each row execute procedure public.recalculate_review_project_score();

alter table public.quality_model_settings enable row level security;
alter table public.projects enable row level security;

drop policy if exists "authenticated read model settings" on public.quality_model_settings;
create policy "authenticated read model settings"
on public.quality_model_settings for select to authenticated
using (true);

drop policy if exists "management update model settings" on public.quality_model_settings;
create policy "management update model settings"
on public.quality_model_settings for update to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

drop policy if exists "authenticated read active projects" on public.projects;
create policy "authenticated read active projects"
on public.projects for select to authenticated
using (is_active or public.is_admin_like());

drop policy if exists "management manage projects" on public.projects;
create policy "management manage projects"
on public.projects for all to authenticated
using (public.is_admin_like())
with check (public.is_admin_like());

grant select, update on public.quality_model_settings to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant execute on function public.recalculate_review_total(uuid) to authenticated;

commit;
