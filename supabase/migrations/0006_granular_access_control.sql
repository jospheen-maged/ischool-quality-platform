-- Granular workspace access controlled by the Super Admin.
-- Role defaults remain the baseline; profile.permissions stores only custom overrides.

begin;

alter table public.profiles
  add column if not exists permissions jsonb not null default '{}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_permissions_object_check;

alter table public.profiles
  add constraint profiles_permissions_object_check
  check (jsonb_typeof(permissions) = 'object');

create or replace function public.has_permission(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_permissions jsonb;
  v_default boolean := false;
begin
  select role, permissions
  into v_role, v_permissions
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found then
    return false;
  end if;

  if v_role = 'super_admin' then
    v_default := true;
  elsif v_role = 'admin' then
    v_default := p_permission in (
      'view_dashboard', 'create_evaluation', 'view_reviews', 'publish_reviews',
      'view_objections', 'review_objections', 'view_analytics', 'manage_tutors',
      'manage_model_settings', 'manage_people'
    );
  elsif v_role = 'qtl' then
    v_default := p_permission in (
      'view_dashboard', 'create_evaluation', 'view_reviews', 'publish_reviews',
      'view_objections', 'review_objections', 'view_analytics', 'manage_tutors',
      'manage_model_settings'
    );
  elsif v_role = 'qc' then
    v_default := p_permission in (
      'view_dashboard', 'create_evaluation', 'view_reviews', 'publish_reviews',
      'view_objections', 'review_objections'
    );
  elsif v_role = 'tutor' then
    v_default := p_permission in ('view_dashboard', 'view_reviews', 'view_objections');
  end if;

  if v_role = 'super_admin' and p_permission = 'manage_access' then
    return true;
  end if;

  if coalesce(v_permissions, '{}'::jsonb) ? p_permission then
    return coalesce((v_permissions ->> p_permission)::boolean, v_default);
  end if;

  return v_default;
end;
$$;

grant execute on function public.has_permission(text) to authenticated;

create or replace function public.protect_profile_permission_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.permissions, '{}'::jsonb) <> '{}'::jsonb
      and public.current_role() <> 'super_admin' then
      raise exception 'Only the Super Admin can assign custom permissions.';
    end if;
  elsif new.permissions is distinct from old.permissions
    and public.current_role() <> 'super_admin' then
    raise exception 'Only the Super Admin can change custom permissions.';
  end if;

  if new.role = 'super_admin' then
    new.permissions := coalesce(new.permissions, '{}'::jsonb) - 'manage_access';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_permission_changes on public.profiles;
create trigger profiles_protect_permission_changes
before insert or update of permissions, role on public.profiles
for each row execute procedure public.protect_profile_permission_changes();

create or replace function public.publish_review_to_tutor(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_review public.reviews%rowtype;
begin
  v_role := public.current_role();

  if v_role not in ('super_admin', 'admin', 'qtl', 'qc')
    or not public.has_permission('publish_reviews') then
    raise exception 'Publish to Tutor is not enabled for this account.';
  end if;

  select *
  into v_review
  from public.reviews
  where id = p_review_id
  for update;

  if not found then
    raise exception 'Review not found.';
  end if;

  if v_role = 'qc' and v_review.evaluator_id <> auth.uid() then
    raise exception 'Quality Control can publish only reviews they created.';
  end if;

  if v_review.status not in ('submitted', 'awaiting_approval', 'returned', 'reopened') then
    raise exception 'This review is not ready to publish.';
  end if;

  update public.reviews
  set
    status = 'published',
    published_at = now(),
    published_by = auth.uid(),
    updated_at = now()
  where id = p_review_id;
end;
$$;

grant execute on function public.publish_review_to_tutor(uuid) to authenticated;

commit;
