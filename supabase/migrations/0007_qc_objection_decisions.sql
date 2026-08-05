-- QC decides the objection and proposes the review edit.
-- Super Admin or QTL only approves the QC decision or returns it for revision.

begin;

alter table public.objections
  add column if not exists reviewer_recommendation public.objection_decision,
  add column if not exists reviewer_notes text,
  add column if not exists proposed_score numeric(6,2)
    check (proposed_score is null or proposed_score between 1 and 5),
  add column if not exists proposed_flag_action text
    check (proposed_flag_action is null or proposed_flag_action in ('remove', 'downgrade_to_yellow')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists approval_status text
    check (approval_status is null or approval_status in ('pending', 'approved', 'declined')),
  add column if not exists approval_notes text,
  add column if not exists approval_at timestamptz;

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
            and rs.numeric_score = 1
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

-- Management sees all objections. A QC sees only cases assigned to them or
-- unassigned cases created against a different evaluator.
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
        and r.evaluator_id <> auth.uid()
    )
  )
);

-- Workflow changes are available only through the controlled functions below.
drop policy if exists "assigned quality staff update objections" on public.objections;
drop policy if exists "staff workflow updates objections" on public.objections;

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

  if v_evaluator = auth.uid() then
    raise exception 'The original evaluator cannot review their own objection.';
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

  if v_review_evaluator = auth.uid() then
    raise exception 'The original evaluator cannot review their own objection.';
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

create or replace function public.approve_objection_recommendation(
  p_objection_id uuid,
  p_approve boolean,
  p_approval_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_objection public.objections%rowtype;
  v_old_score numeric;
  v_flag public.review_flags%rowtype;
  v_score_changed boolean := false;
  v_flag_changed boolean := false;
  v_final_status public.objection_status;
begin
  v_role := public.current_role();

  if v_role not in ('super_admin', 'qtl')
    or not public.has_permission('review_objections') then
    raise exception 'Only Super Admin or QTL can approve QC decisions.';
  end if;

  if not p_approve and char_length(trim(coalesce(p_approval_notes, ''))) < 3 then
    raise exception 'Write a short reason before returning the decision to QC.';
  end if;

  select *
  into v_objection
  from public.objections
  where id = p_objection_id
  for update;

  if not found then
    raise exception 'Objection not found.';
  end if;

  if v_objection.status <> 'awaiting_qtl' or v_objection.reviewer_recommendation is null then
    raise exception 'This objection is not waiting for approval.';
  end if;

  if not p_approve then
    update public.objections
    set
      approval_status = 'declined',
      approval_notes = trim(p_approval_notes),
      approval_at = now(),
      qtl_approved_by = auth.uid(),
      status = 'under_review',
      updated_at = now()
    where id = p_objection_id;
    return;
  end if;

  if v_objection.reviewer_recommendation in ('accepted', 'partially_accepted') then
    if v_objection.object_type = 'criterion_score' then
      if v_objection.target_score_id is null or v_objection.proposed_score is null then
        raise exception 'The approved score change is incomplete.';
      end if;

      select numeric_score
      into v_old_score
      from public.review_scores
      where id = v_objection.target_score_id
        and review_id = v_objection.review_id
      for update;

      if not found then
        raise exception 'The target score is no longer available.';
      end if;

      update public.review_scores
      set
        numeric_score = v_objection.proposed_score,
        is_observed = true,
        updated_at = now()
      where id = v_objection.target_score_id;

      v_score_changed := v_old_score is distinct from v_objection.proposed_score;

    elsif v_objection.object_type = 'flag' then
      if v_objection.target_flag_id is null or v_objection.proposed_flag_action is null then
        raise exception 'The approved flag change is incomplete.';
      end if;

      select *
      into v_flag
      from public.review_flags
      where id = v_objection.target_flag_id
        and review_id = v_objection.review_id
      for update;

      if not found then
        raise exception 'The target flag is no longer available.';
      end if;

      if v_objection.proposed_flag_action = 'remove' then
        if v_flag.source_score_id is not null then
          update public.review_scores
          set
            compliance_result = 'clear',
            is_applicable = true,
            is_external = false,
            external_details = null,
            severity_reason = null,
            updated_at = now()
          where id = v_flag.source_score_id;
        end if;

        update public.review_flags
        set
          is_active = false,
          removal_reason = coalesce(nullif(trim(p_approval_notes), ''), trim(v_objection.reviewer_notes)),
          removal_approved_by = auth.uid(),
          removed_at = now(),
          updated_at = now()
        where id = v_objection.target_flag_id;

        v_flag_changed := true;

      elsif v_objection.proposed_flag_action = 'downgrade_to_yellow' then
        if v_flag.level <> 'red' then
          raise exception 'Only a red flag can be downgraded to yellow.';
        end if;

        if v_flag.source_score_id is not null then
          update public.review_scores
          set
            compliance_result = 'yellow_flag',
            severity_reason = trim(v_objection.reviewer_notes),
            updated_at = now()
          where id = v_flag.source_score_id;
        end if;

        update public.review_flags
        set
          level = 'yellow',
          severity_reason = trim(v_objection.reviewer_notes),
          updated_at = now()
        where id = v_objection.target_flag_id;

        v_flag_changed := true;
      end if;
    end if;
  end if;

  v_final_status := case
    when v_objection.reviewer_recommendation = 'more_evidence_required'
      then 'evidence_required'::public.objection_status
    else 'decision_issued'::public.objection_status
  end;

  update public.objections
  set
    approval_status = 'approved',
    approval_notes = nullif(trim(coalesce(p_approval_notes, '')), ''),
    approval_at = now(),
    qtl_approved_by = auth.uid(),
    decision = reviewer_recommendation,
    decision_notes = reviewer_notes,
    decision_at = now(),
    score_changed = v_score_changed,
    flag_changed = v_flag_changed,
    status = v_final_status,
    updated_at = now()
  where id = p_objection_id;
end;
$$;

grant execute on function public.approve_objection_recommendation(uuid, boolean, text) to authenticated;

drop function if exists public.resolve_objection(uuid, public.objection_decision, text, numeric, text);

commit;
