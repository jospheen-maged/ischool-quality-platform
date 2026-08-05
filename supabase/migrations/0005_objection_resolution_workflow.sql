-- Full objection workflow for Super Admin, Admin, QTL, and QC.
-- Staff can claim objections, issue decisions, and apply approved score/flag changes.

begin;

-- Re-state visibility explicitly so management always sees every objection.
drop policy if exists "role scoped objection visibility" on public.objections;

create policy "role scoped objection visibility"
on public.objections
for select
to authenticated
using (
  public.current_role() in ('super_admin', 'admin', 'qtl')
  or tutor_id = public.current_tutor_id()
  or assigned_reviewer_id = auth.uid()
  or (
    public.current_role() = 'qc'
    and assigned_reviewer_id is null
    and exists (
      select 1
      from public.reviews r
      where r.id = review_id
        and r.evaluator_id <> auth.uid()
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
  v_role public.user_role;
  v_assigned uuid;
  v_evaluator uuid;
  v_status public.objection_status;
begin
  v_role := public.current_role();

  if v_role not in ('super_admin', 'admin', 'qtl', 'qc') then
    raise exception 'You do not have permission to review objections.';
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

  if v_status in ('decision_issued', 'closed') then
    raise exception 'This objection already has a final decision.';
  end if;

  if v_role = 'qc' and v_evaluator = auth.uid() then
    raise exception 'The original evaluator cannot review this objection.';
  end if;

  if v_assigned is not null and v_assigned <> auth.uid() and v_role = 'qc' then
    raise exception 'This objection is already assigned to another reviewer.';
  end if;

  update public.objections
  set
    assigned_reviewer_id = auth.uid(),
    status = 'under_review',
    updated_at = now()
  where id = p_objection_id;
end;
$$;

create or replace function public.resolve_objection(
  p_objection_id uuid,
  p_decision public.objection_decision,
  p_decision_notes text,
  p_new_score numeric default null,
  p_flag_action text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_objection public.objections%rowtype;
  v_review_evaluator uuid;
  v_old_score numeric;
  v_flag public.review_flags%rowtype;
  v_score_changed boolean := false;
  v_flag_changed boolean := false;
  v_final_status public.objection_status;
begin
  v_role := public.current_role();

  if v_role not in ('super_admin', 'admin', 'qtl', 'qc') then
    raise exception 'You do not have permission to resolve objections.';
  end if;

  if p_decision not in ('accepted', 'partially_accepted', 'rejected', 'more_evidence_required') then
    raise exception 'Unsupported objection decision.';
  end if;

  if char_length(trim(coalesce(p_decision_notes, ''))) < 5 then
    raise exception 'Decision notes must contain at least 5 characters.';
  end if;

  select o.*
  into v_objection
  from public.objections o
  where o.id = p_objection_id
  for update;

  if not found then
    raise exception 'Objection not found.';
  end if;

  select evaluator_id
  into v_review_evaluator
  from public.reviews
  where id = v_objection.review_id;

  if v_objection.status in ('decision_issued', 'closed') then
    raise exception 'This objection already has a final decision.';
  end if;

  if v_role = 'qc' then
    if v_review_evaluator = auth.uid() then
      raise exception 'The original evaluator cannot resolve this objection.';
    end if;

    if v_objection.assigned_reviewer_id is null then
      update public.objections
      set assigned_reviewer_id = auth.uid(), status = 'under_review'
      where id = p_objection_id;
      v_objection.assigned_reviewer_id := auth.uid();
    elsif v_objection.assigned_reviewer_id <> auth.uid() then
      raise exception 'This objection is assigned to another reviewer.';
    end if;
  end if;

  if p_decision in ('accepted', 'partially_accepted') then
    if v_objection.object_type = 'criterion_score' then
      if v_objection.target_score_id is null then
        raise exception 'The objection is not linked to a score.';
      end if;

      if p_new_score is null or p_new_score < 1 or p_new_score > 5 then
        raise exception 'Enter a new score between 1 and 5.';
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
        numeric_score = p_new_score,
        is_observed = true,
        updated_at = now()
      where id = v_objection.target_score_id;

      v_score_changed := v_old_score is distinct from p_new_score;

    elsif v_objection.object_type = 'flag' then
      if v_objection.target_flag_id is null then
        raise exception 'The objection is not linked to a flag.';
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

      if p_flag_action = 'remove' then
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
          removal_reason = trim(p_decision_notes),
          removal_approved_by = auth.uid(),
          removed_at = now(),
          updated_at = now()
        where id = v_objection.target_flag_id;

        v_flag_changed := true;

      elsif p_flag_action = 'downgrade_to_yellow' then
        if v_flag.level <> 'red' then
          raise exception 'Only a red flag can be downgraded to yellow.';
        end if;

        if v_flag.source_score_id is not null then
          update public.review_scores
          set
            compliance_result = 'yellow_flag',
            severity_reason = trim(p_decision_notes),
            updated_at = now()
          where id = v_flag.source_score_id;
        end if;

        update public.review_flags
        set
          level = 'yellow',
          severity_reason = trim(p_decision_notes),
          updated_at = now()
        where id = v_objection.target_flag_id;

        v_flag_changed := true;
      else
        raise exception 'Choose whether to remove or downgrade the flag.';
      end if;
    else
      raise exception 'Only score and flag objections can modify a review.';
    end if;
  end if;

  v_final_status := case
    when p_decision = 'more_evidence_required' then 'evidence_required'::public.objection_status
    else 'decision_issued'::public.objection_status
  end;

  update public.objections
  set
    assigned_reviewer_id = coalesce(assigned_reviewer_id, auth.uid()),
    status = v_final_status,
    decision = p_decision,
    decision_notes = trim(p_decision_notes),
    score_changed = v_score_changed,
    flag_changed = v_flag_changed,
    decision_at = now(),
    updated_at = now()
  where id = p_objection_id;
end;
$$;

grant execute on function public.claim_objection(uuid) to authenticated;
grant execute on function public.resolve_objection(uuid, public.objection_decision, text, numeric, text) to authenticated;

commit;
