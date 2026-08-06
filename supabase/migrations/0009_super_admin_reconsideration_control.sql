-- Super Admin always sees all Evaluation Re-consideration cases and can resolve them directly.

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

  -- Super Admin access cannot be disabled by a stored override.
  if v_role = 'super_admin' then
    return true;
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

  if coalesce(v_permissions, '{}'::jsonb) ? p_permission then
    return coalesce((v_permissions ->> p_permission)::boolean, v_default);
  end if;

  return v_default;
end;
$$;

grant execute on function public.has_permission(text) to authenticated;

-- Super Admin visibility is unconditional. Other roles keep their scoped access.
drop policy if exists "role scoped objection visibility" on public.objections;

create policy "role scoped objection visibility"
on public.objections
for select
to authenticated
using (
  public.current_role() = 'super_admin'
  or (
    public.current_role() in ('admin', 'qtl')
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

create or replace function public.super_admin_resolve_reconsideration(
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
  v_objection public.objections%rowtype;
  v_old_score numeric;
  v_flag public.review_flags%rowtype;
  v_score_changed boolean := false;
  v_flag_changed boolean := false;
  v_final_status public.objection_status;
begin
  if public.current_role() <> 'super_admin' then
    raise exception 'Only Super Admin can issue a direct Evaluation Re-consideration decision.';
  end if;

  if p_decision not in ('accepted', 'partially_accepted', 'rejected', 'more_evidence_required') then
    raise exception 'Unsupported decision.';
  end if;

  if char_length(trim(coalesce(p_decision_notes, ''))) < 5 then
    raise exception 'Decision rationale must contain at least 5 characters.';
  end if;

  select *
  into v_objection
  from public.objections
  where id = p_objection_id
  for update;

  if not found then
    raise exception 'Evaluation Re-consideration case not found.';
  end if;

  if v_objection.status in ('decision_issued', 'closed') then
    raise exception 'This case already has a final decision.';
  end if;

  if p_decision in ('accepted', 'partially_accepted') then
    if v_objection.object_type = 'criterion_score' then
      if v_objection.target_score_id is null then
        raise exception 'The case is not linked to a score.';
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
      p_flag_action := null;

    elsif v_objection.object_type = 'flag' then
      if v_objection.target_flag_id is null then
        raise exception 'The case is not linked to a flag.';
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

      p_new_score := null;
    end if;
  else
    p_new_score := null;
    p_flag_action := null;
  end if;

  v_final_status := case
    when p_decision = 'more_evidence_required'
      then 'evidence_required'::public.objection_status
    else 'decision_issued'::public.objection_status
  end;

  update public.objections
  set
    assigned_reviewer_id = auth.uid(),
    reviewer_recommendation = null,
    reviewer_notes = null,
    proposed_score = p_new_score,
    proposed_flag_action = p_flag_action,
    reviewed_at = now(),
    approval_status = 'approved',
    approval_notes = 'Direct Super Admin decision',
    approval_at = now(),
    qtl_approved_by = auth.uid(),
    decision = p_decision,
    decision_notes = trim(p_decision_notes),
    decision_at = now(),
    score_changed = v_score_changed,
    flag_changed = v_flag_changed,
    status = v_final_status,
    updated_at = now()
  where id = p_objection_id;
end;
$$;

grant execute on function public.super_admin_resolve_reconsideration(
  uuid,
  public.objection_decision,
  text,
  numeric,
  text
) to authenticated;

commit;
