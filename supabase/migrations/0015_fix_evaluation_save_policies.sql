-- Fix evaluation save regressions and align DB requirements with the current form.
-- Session date and session format are optional in the UI, so they must be nullable.
-- Newly-created review child rows should use Create Evaluation permission; edits still use Edit Reviews.

begin;

alter table public.reviews alter column session_date drop not null;
alter table public.reviews alter column session_type drop not null;

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

drop policy if exists "scores follow review editing" on public.review_scores;
create policy "scores follow review editing"
on public.review_scores
for insert
to authenticated
with check (
  public.can_create_review_children(review_id)
  or public.can_edit_review(review_id)
);

drop policy if exists "feedback follows review editing" on public.review_feedback;
create policy "feedback follows review editing"
on public.review_feedback
for insert
to authenticated
with check (
  public.can_create_review_children(review_id)
  or public.can_edit_review(review_id)
);

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
