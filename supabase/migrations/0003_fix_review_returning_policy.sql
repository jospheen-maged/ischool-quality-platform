-- Allow staff to receive the newly created review row from INSERT ... RETURNING.
-- The existing can_view_review(id) helper re-queries reviews, so a newly inserted
-- row may not be visible to that helper during the same statement.

begin;

drop policy if exists "role scoped review visibility" on public.reviews;

create policy "role scoped review visibility"
on public.reviews
for select
to authenticated
using (
  public.is_admin_like()
  or evaluator_id = auth.uid()
  or public.can_view_review(id)
);

commit;
