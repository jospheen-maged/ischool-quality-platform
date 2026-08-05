begin;

create or replace function public.can_submit_tutor_objection(
  p_review_id uuid,
  p_tutor_id uuid,
  p_object_type public.objection_target,
  p_target_score_id uuid,
  p_target_flag_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_tutor_id = public.current_tutor_id()
    and exists (
      select 1
      from public.reviews r
      where r.id = p_review_id
        and r.tutor_id = public.current_tutor_id()
        and r.status = 'published'
    )
    and (
      (
        p_object_type = 'flag'
        and p_target_flag_id is not null
        and p_target_score_id is null
        and exists (
          select 1
          from public.review_flags rf
          where rf.id = p_target_flag_id
            and rf.review_id = p_review_id
            and rf.tutor_id = public.current_tutor_id()
            and rf.is_active = true
            and rf.level in ('yellow', 'red')
        )
      )
      or
      (
        p_object_type = 'criterion_score'
        and p_target_score_id is not null
        and p_target_flag_id is null
        and exists (
          select 1
          from public.review_scores rs
          join public.evaluation_criteria ec on ec.id = rs.criterion_id
          where rs.id = p_target_score_id
            and rs.review_id = p_review_id
            and ec.criterion_type = 'rating'
            and rs.is_observed = true
            and rs.numeric_score <= 1
        )
      )
    ),
    false
  );
$$;

grant execute on function public.can_submit_tutor_objection(uuid, uuid, public.objection_target, uuid, uuid) to authenticated;

drop policy if exists "tutors submit objections to own published reviews" on public.objections;
drop policy if exists "tutors submit eligible objections to own published reviews" on public.objections;

create policy "tutors submit eligible objections to own published reviews"
on public.objections
for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and public.can_submit_tutor_objection(
    review_id,
    tutor_id,
    object_type,
    target_score_id,
    target_flag_id
  )
);

commit;
