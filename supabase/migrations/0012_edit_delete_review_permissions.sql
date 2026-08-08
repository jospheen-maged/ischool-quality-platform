-- Granular review editing and deletion.
-- Super Admin always has both actions. Other roles follow Access Control.

begin;

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
    return true;
  elsif v_role = 'admin' then
    v_default := p_permission in (
      'view_dashboard', 'create_evaluation', 'view_reviews', 'publish_reviews',
      'edit_reviews', 'view_objections', 'review_objections', 'view_analytics',
      'manage_tutors', 'manage_model_settings', 'manage_people'
    );
  elsif v_role = 'qtl' then
    v_default := p_permission in (
      'view_dashboard', 'create_evaluation', 'view_reviews', 'publish_reviews',
      'edit_reviews', 'view_objections', 'review_objections', 'view_analytics',
      'manage_tutors', 'manage_model_settings'
    );
  elsif v_role = 'qc' then
    v_default := p_permission in (
      'view_dashboard', 'create_evaluation', 'view_reviews', 'publish_reviews',
      'view_objections', 'review_objections'
    );
  elsif v_role = 'tutor' then
    v_default := p_permission in ('view_dashboard', 'view_reviews', 'view_objections');
  end if;

  if coalesce(v_permissions, '{}'::jsonb) ? p_permission then
    return coalesce((v_permissions ->> p_permission)::boolean, v_default);
  end if;

  return v_default;
end;
$$;

grant execute on function public.has_permission(text) to authenticated;

create or replace function public.can_edit_review(p_review_id uuid)
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
      and (
        public.current_role() = 'super_admin'
        or (
          public.current_role() in ('admin', 'qtl')
          and public.has_permission('edit_reviews')
        )
        or (
          public.current_role() = 'qc'
          and public.has_permission('edit_reviews')
          and r.evaluator_id = auth.uid()
        )
      )
  ), false);
$$;

grant execute on function public.can_edit_review(uuid) to authenticated;

create or replace function public.can_delete_review(p_review_id uuid)
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
      and (
        public.current_role() = 'super_admin'
        or (
          public.current_role() in ('admin', 'qtl')
          and public.has_permission('delete_reviews')
        )
        or (
          public.current_role() = 'qc'
          and public.has_permission('delete_reviews')
          and r.evaluator_id = auth.uid()
        )
      )
  ), false);
$$;

grant execute on function public.can_delete_review(uuid) to authenticated;

drop policy if exists "admins delete reviews" on public.reviews;
drop policy if exists "permission scoped review deletion" on public.reviews;
create policy "permission scoped review deletion"
on public.reviews
for delete
to authenticated
using (public.can_delete_review(id));

-- Section 3 records use the same edit permission as the rest of the review.
drop policy if exists "quality staff insert project evaluations" on public.review_project_evaluations;
create policy "quality staff insert project evaluations"
on public.review_project_evaluations
for insert
to authenticated
with check (public.can_edit_review(review_id));

drop policy if exists "quality staff update project evaluations" on public.review_project_evaluations;
create policy "quality staff update project evaluations"
on public.review_project_evaluations
for update
to authenticated
using (public.can_edit_review(review_id))
with check (public.can_edit_review(review_id));

drop policy if exists "quality staff delete project evaluations" on public.review_project_evaluations;
create policy "quality staff delete project evaluations"
on public.review_project_evaluations
for delete
to authenticated
using (public.can_edit_review(review_id));

create or replace function public.delete_review_secure(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_delete_review(p_review_id) then
    raise exception 'Delete Review is not enabled for this account or review.';
  end if;

  if not exists (select 1 from public.reviews where id = p_review_id) then
    raise exception 'Review not found.';
  end if;

  -- Related scores, Section 3 evaluations, feedback, flags, reconsiderations,
  -- and attachment metadata are removed by their ON DELETE CASCADE keys.
  -- Immutable audit log rows remain available.
  delete from public.reviews where id = p_review_id;
end;
$$;

grant execute on function public.delete_review_secure(uuid) to authenticated;

commit;
