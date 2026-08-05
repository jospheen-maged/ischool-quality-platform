-- Single-QC fallback:
-- When there is no other active QC with Review Objections permission,
-- the original evaluator may review the objection, but the decision still
-- requires Super Admin or QTL approval before any review change is applied.

begin;

create or replace function public.other_eligible_qc_exists(p_current_qc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.role = 'qc'
      and p.is_active = true
      and p.id <> p_current_qc
      and coalesce(
        case
          when coalesce(p.permissions, '{}'::jsonb) ? 'review_objections'
            then (p.permissions ->> 'review_objections')::boolean
          else true
        end,
        true
      )
  );
$$;

grant execute on function public.other_eligible_qc_exists(uuid) to authenticated;

drop policy if exists "role scoped objection visibility" on public.objections;

create policy "role scoped objection visibility"
on public.objections
for select
to authenticated
using (
  (
    public.current_role() in ('super_admin', 'admin', 'qtl')
    and public.has_permission('view_objections')
  )
  or tutor_id = public.current_tutor_id()
  or assigned_reviewer_id = auth.uid()
  or (
    public.current_role() = 'qc'
    and public.has_permission('view_objections')
    and public.has_permission('review_objections')
    and assigned_reviewer_id is null
    and exists (
      select 1
      from public.reviews r
      where r.id = review_id
        and (
          r.evaluator_id <> auth.uid()
          or not public.other_eligible_qc_exists(auth.uid())
        )
    )
  )
);

create or replace function public.claim_objection(p_objection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assigned uuid;
  v_evaluator uuid;
  v_status public.objection_status;
  v_has_other_qc boolean;
begin
  if public.current_role() <> 'qc'
    or not public.has_permission('review_objections') then
    raise exception 'Review Objections is not enabled for this QC account.';
  end if;

  select o.assigned_reviewer_id, r.evaluator_id, o.status
  into v_assigned, v_evaluator, v_status
  from public.objections o
  join public.reviews r on r.id = o.review_id
  where o.id = p_objection_id
  for update of o;

  if not found then
    raise exception 'Objection not found.';
  end if;

  if v_status in ('decision_issued', 'closed', 'awaiting_qtl') then
    raise exception 'This objection cannot be taken in its current status.';
  end if;

  v_has_other_qc := public.other_eligible_qc_exists(auth.uid());

  if v_evaluator = auth.uid() and v_has_other_qc then
    raise exception 'Another active QC must review this objection.';
  end if;

  if v_assigned is not null and v_assigned <> auth.uid() then
    raise exception 'This objection is already assigned to another QC.';
  end if;

  update public.objections
  set
    assigned_reviewer_id = auth.uid(),
    status = 'under_review',
    updated_at = now()
  where id = p_objection_id;
end;
$$;

grant execute on function public.claim_objection(uuid) to authenticated;

create or replace function public.submit_objection_recommendation(
  p_objection_id uuid,
  p_recommendation public.objection_decision,
  p_reviewer_notes text,
  p_proposed_score numeric default null,
  p_proposed_flag_action text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_objection public.objections%rowtype;
  v_review_evaluator uuid;
  v_flag_level public.flag_level;
  v_has_other_qc boolean;
begin
  if public.current_role() <> 'qc'
    or not public.has_permission('review_objections') then
    raise exception 'Only an enabled QC reviewer can issue the objection decision.';
  end if;

  if p_recommendation not in ('accepted', 'partially_accepted', 'rejected', 'more_evidence_required') then
    raise exception 'Unsupported QC decision.';
  end if;

  if char_length(trim(coalesce(p_reviewer_notes, ''))) < 5 then
    raise exception 'QC decision notes must contain at least 5 characters.';
  end if;

  select *
  into v_objection
  from public.objections
  where id = p_objection_id
  for update;

  if not found then
    raise exception 'Objection not found.';
  end if;

  select evaluator_id
  into v_review_evaluator
  from public.reviews
  where id = v_objection.review_id;

  v_has_other_qc := public.other_eligible_qc_exists(auth.uid());

  if v_review_evaluator = auth.uid() and v_has_other_qc then
    raise exception 'Another active QC must review this objection.';
  end if;

  if v_objection.assigned_reviewer_id <> auth.uid() then
    raise exception 'Take this objection before issuing a decision.';
  end if;

  if v_objection.status not in ('under_review', 'evidence_required') then
    raise exception 'This objection is not ready for a QC decision.';
  end if;

  if p_recommendation in ('accepted', 'partially_accepted') then
    if v_objection.object_type = 'criterion_score' then
      if v_objection.target_score_id is null then
        raise exception 'The objection is not linked to a score.';
      end if;

      if p_proposed_score is null or p_proposed_score < 1 or p_proposed_score > 5 then
        raise exception 'Enter the proposed score between 1 and 5.';
      end if;

      p_proposed_flag_action := null;
    elsif v_objection.object_type = 'flag' then
      if v_objection.target_flag_id is null then
        raise exception 'The objection is not linked to a flag.';
      end if;

      select level
      into v_flag_level
      from public.review_flags
      where id = v_objection.target_flag_id
        and review_id = v_objection.review_id;

      if not found then
        raise exception 'The target flag is no longer available.';
      end if;

      if p_proposed_flag_action not in ('remove', 'downgrade_to_yellow') then
        raise exception 'Choose whether to remove or downgrade the flag.';
      end if;

      if p_proposed_flag_action = 'downgrade_to_yellow' and v_flag_level <> 'red' then
        raise exception 'Only a red flag can be downgraded to yellow.';
      end if;

      p_proposed_score := null;
    end if;
  else
    p_proposed_score := null;
    p_proposed_flag_action := null;
  end if;

  update public.objections
  set
    reviewer_recommendation = p_recommendation,
    reviewer_notes = trim(p_reviewer_notes),
    proposed_score = p_proposed_score,
    proposed_flag_action = p_proposed_flag_action,
    reviewed_at = now(),
    approval_status = 'pending',
    approval_notes = null,
    approval_at = null,
    qtl_approved_by = null,
    decision = null,
    decision_notes = null,
    decision_at = null,
    score_changed = false,
    flag_changed = false,
    status = 'awaiting_qtl',
    updated_at = now()
  where id = p_objection_id;
end;
$$;

grant execute on function public.submit_objection_recommendation(uuid, public.objection_decision, text, numeric, text) to authenticated;

commit;
