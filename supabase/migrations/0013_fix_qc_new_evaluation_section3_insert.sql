-- Fix New Evaluation saves after granular Edit Review permissions were introduced.
-- Creating child records for a newly-created review must depend on Create Evaluation,
-- not on Edit Reviews. Edit permissions remain required for modifying existing reviews.

begin;

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

-- A new evaluation may create Section 3 rows even when Edit Reviews is disabled.
-- Existing-review editing still works through can_edit_review().
drop policy if exists "quality staff insert project evaluations" on public.review_project_evaluations;
create policy "quality staff insert project evaluations"
on public.review_project_evaluations
for insert
to authenticated
with check (
  public.can_create_review_children(review_id)
  or public.can_edit_review(review_id)
);

commit;
