-- Repair live review RLS helpers and policies.
-- Safe to run more than once in Supabase SQL Editor.

begin;

create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and is_active = true;
$$;

create or replace function public.current_tutor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tutor_id
  from public.profiles
  where id = auth.uid()
    and is_active = true;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role() in ('super_admin', 'admin', 'qtl', 'qc'),
    false
  );
$$;

create or replace function public.is_admin_like()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_role() in ('super_admin', 'admin', 'qtl'),
    false
  );
$$;

create or replace function public.can_create_review(p_evaluator_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_evaluator_id = auth.uid()
    and public.current_role() in ('super_admin', 'admin', 'qtl', 'qc'),
    false
  );
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
        or (
          r.status = 'published'
          and r.tutor_id = public.current_tutor_id()
        )
        or exists (
          select 1
          from public.objections o
          where o.review_id = r.id
            and o.assigned_reviewer_id = auth.uid()
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

revoke all on function public.current_role() from public;
revoke all on function public.current_tutor_id() from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin_like() from public;
revoke all on function public.can_create_review(uuid) from public;
revoke all on function public.can_view_review(uuid) from public;
revoke all on function public.can_edit_review(uuid) from public;

grant execute on function public.current_role() to authenticated;
grant execute on function public.current_tutor_id() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin_like() to authenticated;
grant execute on function public.can_create_review(uuid) to authenticated;
grant execute on function public.can_view_review(uuid) to authenticated;
grant execute on function public.can_edit_review(uuid) to authenticated;

drop policy if exists "quality staff create reviews" on public.reviews;
create policy "quality staff create reviews"
on public.reviews
for insert
to authenticated
with check (public.can_create_review(evaluator_id));

drop policy if exists "role scoped review visibility" on public.reviews;
create policy "role scoped review visibility"
on public.reviews
for select
to authenticated
using (public.can_view_review(id));

drop policy if exists "review owner or admin updates editable reviews" on public.reviews;
create policy "review owner or admin updates editable reviews"
on public.reviews
for update
to authenticated
using (public.can_edit_review(id))
with check (public.can_edit_review(id));

drop policy if exists "admins delete reviews" on public.reviews;
create policy "admins delete reviews"
on public.reviews
for delete
to authenticated
using (public.is_admin_like());

commit;
